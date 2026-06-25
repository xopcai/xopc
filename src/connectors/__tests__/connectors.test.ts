import { afterEach, describe, expect, it, vi } from 'vitest';

import { CredentialResolver } from '../../auth/credentials.js';
import type { Config } from '../../config/schema.js';
import { getConnectorDefinition, listConnectorCatalog } from '../catalog.js';
import { installConnector, uninstallConnector } from '../install.js';
import { listConnectorInstances } from '../instances.js';
import { materializeConnectorMcpServer } from '../materialize.js';
import { completeConnectorOAuth, startConnectorOAuth } from '../oauth.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.XOPC_GITHUB_OAUTH_CLIENT_ID;
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
