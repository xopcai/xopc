import { afterEach, describe, expect, it, vi } from 'vitest';

import { CredentialResolver } from '../../auth/credentials.js';
import type { Config } from '../../config/schema.js';
import { getConnectorDefinition, listConnectorCatalog } from '../catalog.js';
import { installConnector, uninstallConnector } from '../install.js';
import { setConnectorEnabled } from '../lifecycle.js';
import { listConnectorInstances } from '../instances.js';
import { materializeConnectorMcpServer } from '../materialize.js';
import { createConnectorSetupSecretRequest, submitConnectorSetupSecret } from '../setup-secrets.js';
import { canUseComposioAction, getComposioToolkitScope, setComposioToolkitScope } from '../composio.js';
import { completeConnectorOAuth, startConnectorOAuth } from '../oauth.js';
import { searchConnectorRegistries } from '../registries/search.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.XOPC_GITHUB_OAUTH_CLIENT_ID;
  delete process.env.XOPC_SMITHERY_API_KEY;
  delete process.env.SMITHERY_API_KEY;
});

describe('connectors catalog', () => {
  it('exposes connector-only built-ins without secret values', () => {
    const ids = listConnectorCatalog().map((connector) => connector.id);

    expect(ids).toEqual(expect.arrayContaining([
      'brave-search',
      'fetch',
      'filesystem',
      'github',
      'google-drive',
      'linear',
      'memory',
      'notion',
      'playwright',
      'sequential-thinking',
      'slack',
      'time',
    ]));
    expect(JSON.stringify(listConnectorCatalog())).not.toContain('ghp_');
  });
});

describe('materializeConnectorMcpServer', () => {
  it('materializes GitHub OAuth to a managed MCP server with secret references only', () => {
    const github = getConnectorDefinition('github');
    expect(github).toBeDefined();
    expect(github?.auth.mode).toBe('oauth');

    const result = materializeConnectorMcpServer(github!, {});

    expect(result.serverId).toBe('github');
    expect(result.server).toMatchObject({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: {
          xopcSecretRef: {
            provider: 'connector-github-github_personal_access_token',
            fieldKey: 'GITHUB_PERSONAL_ACCESS_TOKEN',
          },
        },
      },
      xopcConnector: {
        managed: true,
        connectorId: 'github',
        version: '1.0.0',
      },
    });
    expect(JSON.stringify(result.server)).not.toContain('ghp_demo');
  });
});

describe('connector registry search', () => {
  it('does not hit remote registries for empty discovery queries', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const results = await searchConnectorRegistries({ query: '', page: 1, pageSize: 24 });

    expect(results.map((result) => result.source)).toEqual(['mcp_official', 'smithery', 'modelscope']);
    expect(results.every((result) => result.connectors.length === 0)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('searches Smithery without requiring an API key for discovery', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        servers: [
          {
            qualifiedName: 'weather/example',
            displayName: 'Weather Example',
            description: 'Weather MCP server.',
          },
        ],
      }),
    } as Response);

    const results = await searchConnectorRegistries({ source: 'smithery', query: 'weath', pageSize: 5 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      }),
    );
    expect(results[0]?.connectors[0]).toMatchObject({
      id: 'smithery-weather-example',
      displayName: 'Weather Example',
      setup: {
        secrets: [expect.objectContaining({ key: 'SMITHERY_AUTHORIZATION_HEADER' })],
      },
      runtime: {
        type: 'mcp',
        serverTemplate: {
          url: 'https://server.smithery.ai/weather/example/mcp',
          headers: { Authorization: '{{secrets.SMITHERY_AUTHORIZATION_HEADER}}' },
        },
      },
    });
  });
});

describe('connector OAuth', () => {
  it('starts GitHub device OAuth with connector scopes', async () => {
    process.env.XOPC_GITHUB_OAUTH_CLIENT_ID = 'github-client-id';
    const github = getConnectorDefinition('github');
    expect(github).toBeDefined();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        device_code: 'device-code',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 7,
      }),
    } as Response);

    const result = await startConnectorOAuth(github!);

    expect(result).toMatchObject({
      connectorId: 'github',
      provider: 'github',
      deviceCode: 'device-code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresInSeconds: 900,
      intervalSeconds: 7,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://github.com/login/device/code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          client_id: 'github-client-id',
          scope: 'repo read:user read:org',
        }),
      }),
    );
  });

  it('stores completed GitHub OAuth as the connector secret credential', async () => {
    process.env.XOPC_GITHUB_OAUTH_CLIENT_ID = 'github-client-id';
    const github = getConnectorDefinition('github');
    expect(github).toBeDefined();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'gho_oauth_token',
        scope: 'repo read:user',
      }),
    } as Response);
    const saveOAuthToken = vi.fn();
    const resolver = { saveOAuthToken } as unknown as CredentialResolver;

    await expect(completeConnectorOAuth(github!, { deviceCode: 'device-code' }, resolver)).resolves.toMatchObject({
      connectorId: 'github',
      provider: 'github',
      connected: true,
    });

    expect(saveOAuthToken).toHaveBeenCalledWith(
      'connector-github-github_personal_access_token',
      expect.objectContaining({
        access: 'gho_oauth_token',
        refresh: '',
        scope: ['repo', 'read:user'],
      }),
    );
  });
});

describe('connector install and instances', () => {
  it('installs, lists, and uninstalls managed connectors', async () => {
    const config = { mcp: { servers: {} } } as Config;

    const instance = await installConnector(config, 'fetch', {});

    expect(instance).toMatchObject({
      instanceId: 'fetch',
      connectorId: 'fetch',
      materialized: { type: 'mcp', serverId: 'fetch' },
    });
    expect(listConnectorInstances(config)).toHaveLength(1);
    expect(config.mcp?.servers?.fetch).toMatchObject({
      command: 'uvx',
      args: ['mcp-server-fetch'],
      xopcConnector: { managed: true, connectorId: 'fetch' },
    });

    const disabled = setConnectorEnabled(config, 'fetch', false);
    expect(disabled.enabled).toBe(false);
    expect(disabled.status).toBe('disabled');
    expect(config.mcp?.servers?.fetch?.xopcConnector?.enabled).toBe(false);

    const removed = uninstallConnector(config, 'fetch');

    expect(removed.connectorId).toBe('fetch');
    expect(config.mcp?.servers?.fetch).toBeUndefined();
  });

  it('blocks unmanaged MCP server conflicts without listing them as connectors', async () => {
    const config = {
      mcp: {
        servers: {
          fetch: { command: 'node', args: ['manual-fetch.js'] },
        },
      },
    } as Config;

    await expect(installConnector(config, 'fetch', {})).rejects.toThrow(/not managed by Connectors/);
    expect(() => uninstallConnector(config, 'fetch')).toThrow(/not managed by Connectors/);
    expect(listConnectorInstances(config)).toEqual([]);
  });

  it('blocks GitHub install until OAuth token is connected', async () => {
    const config = { mcp: { servers: {} } } as Config;
    const resolver = { loadOAuthToken: vi.fn().mockResolvedValue(null) } as unknown as CredentialResolver;

    await expect(installConnector(config, 'github', {}, resolver)).rejects.toThrow(/Connect GitHub with OAuth/);
    expect(config.mcp?.servers?.github).toBeUndefined();
  });

  it('stores connector setup secret refs without exposing raw values to config', async () => {
    const request = createConnectorSetupSecretRequest({ key: 'BRAVE_API_KEY' });
    expect(request.ref).toMatch(/^secret:\/\//);
    expect(submitConnectorSetupSecret(request.ref, 'brave_secret')).toBe(true);
    const config = { mcp: { servers: {} } } as Config;
    const resolver = { saveApiKey: vi.fn() } as unknown as CredentialResolver;

    await installConnector(config, 'brave-search', { secrets: { BRAVE_API_KEY: request.ref } }, resolver);

    expect(resolver.saveApiKey).toHaveBeenCalledWith('connector-brave-search-brave_api_key', 'brave_secret', { profileName: 'default' });
    expect(JSON.stringify(config)).not.toContain('brave_secret');
  });

  it('installs a non-MCP Composio connector instance with scoped action gates', async () => {
    const config = {} as Config;

    const instance = await installConnector(config, 'composio-gmail', {});

    expect(instance).toMatchObject({
      instanceId: 'composio-gmail',
      connectorId: 'composio-gmail',
      materialized: { type: 'composio', id: 'composio-gmail' },
    });
    expect(config.connectors?.instances?.['composio-gmail']).toMatchObject({
      runtime: { type: 'composio', toolkit: 'gmail' },
      scope: 'read',
      xopcConnector: { managed: true, connectorId: 'composio-gmail' },
    });
    expect(getComposioToolkitScope(config, 'gmail')).toBe('read');
    expect(canUseComposioAction(config, 'GMAIL_FETCH_EMAILS').ok).toBe(true);
    expect(canUseComposioAction(config, 'GMAIL_SEND_EMAIL').ok).toBe(false);
    setComposioToolkitScope(config, 'gmail', 'write');
    expect(canUseComposioAction(config, 'GMAIL_SEND_EMAIL').ok).toBe(true);
  });

  it('installs GitHub with OAuth token references and no plaintext token in config', async () => {
    const config = { mcp: { servers: {} } } as Config;
    const resolver = {
      loadOAuthToken: vi.fn().mockResolvedValue({ access: 'gho_oauth_token' }),
      saveApiKey: vi.fn(),
    } as unknown as CredentialResolver;

    await installConnector(config, 'github', {}, resolver);

    const [instance] = listConnectorInstances(config);
    expect(instance?.connectorId).toBe('github');
    expect(config.mcp?.servers?.github).toMatchObject({
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: {
          xopcSecretRef: {
            provider: 'connector-github-github_personal_access_token',
            fieldKey: 'GITHUB_PERSONAL_ACCESS_TOKEN',
          },
        },
      },
    });
    expect(JSON.stringify(instance)).not.toContain('ghp_secret');
    expect(JSON.stringify(config)).not.toContain('ghp_secret');
  });
});
