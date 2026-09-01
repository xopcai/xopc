import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as bundleMcpGateway from '../../agent/mcp/bundle-mcp-gateway.js';
import type { CredentialResolver } from '../../auth/credentials.js';
import type { Config } from '../../config/schema.js';
import { getConnectorDefinition, listConnectorCatalog } from '../catalog.js';
import { BUILTIN_CONNECTORS } from '../builtin-catalog.js';
import { installConnector, installConnectorDefinition, uninstallConnector, updateConnectorConfig } from '../install.js';
import { previewConnectorDefinition } from '../health.js';
import { setConnectorEnabled } from '../lifecycle.js';
import { listConnectorInstances } from '../instances.js';
import { createConnectorSetupSecretRequest, submitConnectorSetupSecret } from '../setup-secrets.js';
import {
  canUseComposioAction,
  getConfiguredComposioAuthConfigs,
  getComposioToolkitScope,
  inspectComposioConnectorHealth,
  setComposioToolkitScope,
} from '../composio.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.XOPC_COMPOSIO_API_KEY;
  delete process.env.COMPOSIO_API_KEY;
});

describe('connectors catalog', () => {
  it('exposes connector-only built-ins without secret values', () => {
    const ids = listConnectorCatalog().map((connector) => connector.id);

    expect(ids).toContain('filesystem');
    expect(ids).not.toEqual(expect.arrayContaining([
      'brave-search', 'fetch', 'memory', 'playwright', 'sequential-thinking', 'time',
    ]));
    expect(ids).toEqual(expect.arrayContaining([
      'composio-gmail',
      'composio-googlecalendar',
      'composio-googledrive',
      'composio-github',
      'composio-notion',
    ]));
    expect(JSON.stringify(listConnectorCatalog())).not.toContain('ghp_');
  });

  it('exposes one product entry per application', () => {
    const connectors = listConnectorCatalog();
    const notion = connectors.filter((connector) => connector.displayName === 'Notion');
    const googleDrive = connectors.filter((connector) => connector.displayName === 'Google Drive');
    const github = connectors.filter((connector) => connector.displayName === 'GitHub');

    expect(notion.map((connector) => connector.id)).toEqual(['composio-notion']);
    expect(googleDrive.map((connector) => connector.id)).toEqual(['composio-googledrive']);
    expect(github.map((connector) => connector.id)).toEqual(['composio-github']);
  });

  it('ships a local logo for every core built-in connector', () => {
    for (const connector of BUILTIN_CONNECTORS) {
      expect(connector.branding).toMatchObject({
        logoUrl: `/connector-icons/${connector.id}.svg`,
        source: 'builtin',
      });
      const logoPath = resolve(process.cwd(), 'web/public', connector.branding!.logoUrl!.slice(1));
      expect(existsSync(logoPath), `missing logo asset for ${connector.id}: ${logoPath}`).toBe(true);
    }
  });
});

describe('connector install and instances', () => {
  it('installs, lists, and uninstalls managed connectors', async () => {
    const config = { mcp: { servers: {} } } as Config;

    const instance = await installConnector(config, 'filesystem', { config: { rootPath: '/tmp/files' } });

    expect(instance).toMatchObject({
      instanceId: 'filesystem',
      connectorId: 'filesystem',
      materialized: { type: 'mcp', serverId: 'filesystem' },
    });
    expect(listConnectorInstances(config)).toHaveLength(1);
    expect(config.mcp?.servers?.filesystem).toMatchObject({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/files'],
      xopcConnector: { managed: true, connectorId: 'filesystem' },
    });

    const disabled = setConnectorEnabled(config, 'filesystem', false);
    expect(disabled.enabled).toBe(false);
    expect(disabled.status).toBe('disabled');
    expect(config.mcp?.servers?.filesystem?.xopcConnector?.enabled).toBe(false);

    const removed = uninstallConnector(config, 'filesystem');

    expect(removed.connectorId).toBe('filesystem');
    expect(config.mcp?.servers?.filesystem).toBeUndefined();
  });

  it('updates config-only MCP connectors without reinstalling secrets', async () => {
    const config = { mcp: { servers: {} } } as Config;

    await installConnector(config, 'filesystem', { config: { rootPath: '/tmp/one' } });
    const updated = updateConnectorConfig(config, 'filesystem', { config: { rootPath: '/tmp/two' } });

    expect(updated.config).toEqual({ rootPath: '/tmp/two' });
    expect(config.mcp?.servers?.filesystem).toMatchObject({
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/two'],
      xopcConnector: {
        managed: true,
        connectorId: 'filesystem',
        config: { rootPath: '/tmp/two' },
      },
    });
  });

  it('keeps an immutable Store definition snapshot for restart-safe lifecycle operations', async () => {
    const config = { mcp: { servers: {} } } as Config;
    const definition = {
      id: 'store-demo',
      version: '1.2.3',
      displayName: 'Store Demo',
      description: 'Store connector snapshot test.',
      category: 'docs',
      kind: 'mcp',
      source: 'store',
      capabilities: ['tools', 'runtime.mcp.streamableHttp'],
      auth: { mode: 'none' },
      setup: {},
      runtime: {
        type: 'mcp',
        serverId: 'store_demo',
        serverTemplate: { url: 'https://mcp.example.com/mcp', transport: 'streamable-http' },
      },
    } as const;

    await installConnectorDefinition(config, definition, {});
    expect(config.mcp?.servers?.store_demo?.xopcConnector?.definition).toEqual(definition);
    expect(uninstallConnector(config, 'store_demo')).toMatchObject({ connectorId: 'store-demo' });
    expect(config.mcp?.servers?.store_demo).toBeUndefined();
  });

  it('installs and updates the native local-files memory source', async () => {
    const config = {} as Config;

    const installed = await installConnector(config, 'local-files', { config: { rootPath: '/tmp/notes' } });
    expect(installed).toMatchObject({
      connectorId: 'local-files',
      config: { rootPath: '/tmp/notes' },
      materialized: { type: 'memorySource' },
    });

    const updated = updateConnectorConfig(config, 'local-files', { config: { rootPath: '/tmp/vault' } });
    expect(updated.config).toEqual({ rootPath: '/tmp/vault' });
  });

  it('blocks unmanaged MCP server conflicts without listing them as connectors', async () => {
    const config = {
      mcp: {
        servers: {
          filesystem: { command: 'node', args: ['manual-filesystem.js'] },
        },
      },
    } as Config;

    await expect(installConnector(config, 'filesystem', { config: { rootPath: '/tmp/files' } })).rejects.toThrow(/not managed by Connectors/);
    expect(() => uninstallConnector(config, 'filesystem')).toThrow(/not managed by Connectors/);
    expect(listConnectorInstances(config)).toEqual([]);
  });

  it('previews MCP connector capabilities without saving the server config', async () => {
    const config = { mcp: { servers: {} } } as Config;
    const filesystem = getConnectorDefinition('filesystem');
    expect(filesystem).toBeDefined();
    const capabilitySpy = vi
      .spyOn(bundleMcpGateway, 'listBundleMcpServerCapabilitiesForGateway')
      .mockResolvedValue({
        serverId: 'filesystem',
        toolCount: 1,
        resourceCount: 0,
        promptCount: 0,
        tools: [{ name: 'read_file', shortName: 'read_file', description: 'Read a file.' }],
        resources: [],
        prompts: [],
      });

    const preview = await previewConnectorDefinition(config, filesystem!, { config: { rootPath: '/tmp/files' } });

    expect(preview).toMatchObject({
      serverId: 'filesystem',
      ok: true,
      status: 'ok',
      toolCount: 1,
      tools: [{ name: 'read_file', shortName: 'read_file', description: 'Read a file.' }],
    });
    expect(capabilitySpy).toHaveBeenCalledWith(expect.objectContaining({
      serverId: 'filesystem',
      cfg: expect.objectContaining({
        mcp: expect.objectContaining({
          servers: expect.objectContaining({
            filesystem: expect.objectContaining({
              xopcConnector: expect.objectContaining({ managed: true, connectorId: 'filesystem' }),
            }),
          }),
        }),
      }),
    }));
    expect(config.mcp?.servers?.filesystem).toBeUndefined();
    expect(listConnectorInstances(config)).toEqual([]);
  });

  it('stores connector setup secret refs without exposing raw values to config', async () => {
    const request = createConnectorSetupSecretRequest({ key: 'COMPOSIO_API_KEY' });
    expect(request.ref).toMatch(/^secret:\/\//);
    expect(submitConnectorSetupSecret(request.ref, 'brave_secret')).toBe(true);
    const config = { mcp: { servers: {} } } as Config;
    const resolver = { saveApiKey: vi.fn() } as unknown as CredentialResolver;

    await installConnector(config, 'composio-api-key', { secrets: { COMPOSIO_API_KEY: request.ref } }, resolver);

    expect(resolver.saveApiKey).toHaveBeenCalledWith('connector-composio-api-key', 'brave_secret', { profileName: 'default' });
    expect(JSON.stringify(config)).not.toContain('brave_secret');
  });

  it('installs a non-MCP Composio connector instance with scoped action gates', async () => {
    const config = {} as Config;
    const resolver = { resolveApiKey: vi.fn().mockResolvedValue('composio_test') } as unknown as CredentialResolver;

    const instance = await installConnector(config, 'composio-gmail', {
      config: { authConfigId: 'ac_gmail' },
    }, resolver);

    expect(instance).toMatchObject({
      instanceId: 'composio-gmail',
      connectorId: 'composio-gmail',
      materialized: { type: 'composio', id: 'composio-gmail', toolkit: 'gmail', role: 'toolkit' },
    });
    expect(config.connectors?.instances?.['composio-gmail']).toMatchObject({
      runtime: { type: 'composio', toolkit: 'gmail', role: 'toolkit' },
      scope: 'read',
      xopcConnector: {
        managed: true,
        connectorId: 'composio-gmail',
        config: { authConfigId: 'ac_gmail' },
      },
    });
    expect(instance.config).toEqual({ authConfigId: 'ac_gmail' });
    expect(getConfiguredComposioAuthConfigs(config, ['gmail'])).toEqual({ gmail: 'ac_gmail' });
    const updated = updateConnectorConfig(config, instance.instanceId, {
      config: { authConfigId: 'ac_gmail_next' },
    });
    expect(updated.config).toEqual({ authConfigId: 'ac_gmail_next' });
    expect(getConfiguredComposioAuthConfigs(config, ['gmail'])).toEqual({ gmail: 'ac_gmail_next' });
    expect(getComposioToolkitScope(config, 'gmail')).toBe('read');
    expect(canUseComposioAction(config, 'GMAIL_FETCH_EMAILS').ok).toBe(true);
    expect(canUseComposioAction(config, 'GMAIL_SEND_EMAIL').ok).toBe(false);
    setComposioToolkitScope(config, 'gmail', 'write');
    expect(canUseComposioAction(config, 'GMAIL_SEND_EMAIL').ok).toBe(true);
  });

  it('requires the Composio credential before installing a SaaS toolkit', async () => {
    const config = {} as Config;
    const resolver = { resolveApiKey: vi.fn().mockResolvedValue(null) } as unknown as CredentialResolver;

    await expect(installConnector(config, 'composio-gmail', {}, resolver))
      .rejects.toThrow('Install the "Composio API Key" connector first');
    expect(config.connectors?.instances).toBeUndefined();
  });

  it('installs a SaaS toolkit through managed Composio when XOPC Cloud is signed in', async () => {
    const config = {} as Config;
    const resolver = {
      resolveApiKey: vi.fn(async (provider: string) => provider === 'xopc-cloud' ? 'cloud-token' : null),
    } as unknown as CredentialResolver;

    await expect(installConnector(config, 'composio-gmail', {}, resolver)).resolves.toMatchObject({
      connectorId: 'composio-gmail',
      materialized: { type: 'composio', toolkit: 'gmail', role: 'toolkit' },
    });
    expect(resolver.resolveApiKey).toHaveBeenCalledWith('connector-composio-api-key');
    expect(resolver.resolveApiKey).toHaveBeenCalledWith('xopc-cloud');
  });

  it('requires a non-empty key when installing the Composio credential connector', async () => {
    const config = {} as Config;
    const resolver = { saveApiKey: vi.fn() } as unknown as CredentialResolver;

    await expect(installConnector(config, 'composio-api-key', {}, resolver))
      .rejects.toThrow('Composio API key is required');
    expect(config.connectors?.instances).toBeUndefined();
  });

  it('classifies a missing Composio credential in connector health', async () => {
    const resolver = { resolveApiKey: vi.fn().mockResolvedValue(null) } as unknown as CredentialResolver;

    await expect(inspectComposioConnectorHealth('notion', resolver)).resolves.toMatchObject({
      status: 'degraded',
      recovery: 'retry',
      errorCode: 'missing_credential',
    });
  });

  it('keeps native channels separate while installing GitHub through Composio', async () => {
    const config = {} as Config;
    const resolver = { resolveApiKey: vi.fn().mockResolvedValue('composio-key') } as unknown as CredentialResolver;

    await expect(installConnector(config, 'composio-telegram', {}))
      .rejects.toThrow('native telegram channel');
    await expect(installConnector(config, 'composio-github', {}, resolver)).resolves.toMatchObject({
      connectorId: 'composio-github',
      materialized: { type: 'composio', toolkit: 'github', role: 'toolkit' },
    });
    expect(config.connectors?.instances?.['composio-github']).toMatchObject({
      scope: 'read',
      runtime: { type: 'composio', toolkit: 'github', role: 'toolkit' },
    });
    expect(canUseComposioAction(config, 'GITHUB_GET_AN_ISSUE').ok).toBe(true);
    expect(canUseComposioAction(config, 'GITHUB_CREATE_AN_ISSUE').ok).toBe(false);
    setComposioToolkitScope(config, 'github', 'admin');
    expect(canUseComposioAction(config, 'GITHUB_DELETE_A_REPOSITORY').ok).toBe(true);
    expect(canUseComposioAction(config, 'GITHUB_LIST_WORKFLOWS')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not in the curated github action catalog'),
    });
  });

});
