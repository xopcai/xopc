import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as bundleMcpMaterialize from '../../agent/mcp/bundle-mcp-materialize.js';
import type { CredentialResolver } from '../../auth/credentials.js';
import type { Config } from '../../config/schema.js';
import { getConnectorDefinition, listConnectorCatalog } from '../catalog.js';
import { BUILTIN_CONNECTORS } from '../builtin-catalog.js';
import { installConnector, uninstallConnector, updateConnectorConfig } from '../install.js';
import { previewConnectorDefinition } from '../health.js';
import { setConnectorEnabled } from '../lifecycle.js';
import { listConnectorInstances } from '../instances.js';
import { createConnectorSetupSecretRequest, submitConnectorSetupSecret } from '../setup-secrets.js';
import {
  canUseComposioAction,
  getComposioToolkitScope,
  inspectComposioConnectorHealth,
  setComposioToolkitScope,
} from '../composio.js';
import { searchConnectorRegistries } from '../registries/search.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.XOPC_SMITHERY_API_KEY;
  delete process.env.SMITHERY_API_KEY;
  delete process.env.XOPC_COMPOSIO_API_KEY;
  delete process.env.COMPOSIO_API_KEY;
});

describe('connectors catalog', () => {
  it('exposes connector-only built-ins without secret values', () => {
    const ids = listConnectorCatalog().map((connector) => connector.id);

    expect(ids).toEqual(expect.arrayContaining([
      'brave-search',
      'fetch',
      'filesystem',
      'memory',
      'playwright',
      'sequential-thinking',
      'time',
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

describe('connector registry search', () => {
  it('does not hit remote registries for empty discovery queries', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const results = await searchConnectorRegistries({ query: '', page: 1, pageSize: 24 });

    expect(results.map((result) => result.source)).toEqual(['mcp_official', 'smithery', 'modelscope']);
    expect(results.every((result) => result.connectors.length === 0)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('searches Smithery without requiring authorization for install', async () => {
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
    const connector = results[0]?.connectors[0];
    expect(connector).toMatchObject({
      id: 'smithery-weather-example',
      displayName: 'Weather Example',
      auth: { mode: 'none' },
      capabilities: ['tools', 'resources', 'prompts', 'runtime.mcp.streamableHttp'],
      setup: {},
      runtime: {
        type: 'mcp',
        serverTemplate: {
          url: 'https://server.smithery.ai/weather/example/mcp',
        },
      },
    });
    expect(connector?.setup.secrets).toBeUndefined();
    expect(connector?.runtime.type === 'mcp' ? connector.runtime.serverTemplate.headers : undefined).toBeUndefined();
  });

  it('uses configured Smithery API key without prompting for connector secrets', async () => {
    process.env.XOPC_SMITHERY_API_KEY = 'smithery-token';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        servers: [
          {
            qualifiedName: 'weather/example',
            displayName: 'Weather Example',
          },
        ],
      }),
    } as Response);

    const results = await searchConnectorRegistries({ source: 'smithery', query: 'forecast', pageSize: 5 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: { Accept: 'application/json', Authorization: 'Bearer smithery-token' },
      }),
    );
    expect(results[0]?.connectors[0]).toMatchObject({
      auth: { mode: 'apiKey' },
      setup: {},
      runtime: {
        type: 'mcp',
        serverTemplate: {
          url: 'https://server.smithery.ai/weather/example/mcp',
          headers: { Authorization: 'Bearer smithery-token' },
        },
      },
    });
  });

  it('normalizes ModelScope remote MCP configs nested under mcpServers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        Data: {
          Data: {
            Mcp: {
              TotalCount: 4,
              McpServers: [
                {
                  Name: 'xsct-bench',
                  ChineseName: 'XSCT model selector',
                  Path: 'models/xsct-bench',
                  CallVolume: 100,
                  StreamableHTTPServerConfig: [
                    {
                      mcpServers: {
                        'xsct-bench': {
                          url: 'https://xsct.ai/mcp',
                        },
                      },
                    },
                  ],
                },
                {
                  Name: 'supabase-mcp',
                  Path: 'supabase/supabase-mcp',
                  CallVolume: 90,
                  ServerConfig: [
                    {
                      mcpServers: {
                        supabase: {
                          type: 'http',
                          url: 'https://mcp.supabase.com/mcp',
                        },
                      },
                    },
                  ],
                },
                {
                  Name: 'AI_Go_Hotel_MCP',
                  ChineseName: 'Global Hotel Booking',
                  Path: 'travel/AI_Go_Hotel_MCP',
                  CallVolume: 80,
                  StreamableHTTPServerConfig: [
                    {
                      mcpServers: {
                        'aigohotel-mcp': {
                          type: 'streamable_http',
                          url: 'https://mcp.aigohotel.com/mcp',
                        },
                      },
                    },
                  ],
                },
                {
                  Name: 'ChatPPT-MCP',
                  Path: 'slides/ChatPPT-MCP',
                  CallVolume: 70,
                },
              ],
            },
          },
        },
      }),
    } as Response);

    const results = await searchConnectorRegistries({
      source: 'modelscope',
      query: 'modelscope nested remote config',
      page: 1,
      pageSize: 24,
    });

    expect(results[0]?.connectors.map((connector) => connector.id)).toEqual([
      'modelscope-models-xsct-bench-xsct-bench',
      'modelscope-supabase-supabase-mcp-supabase-mcp',
      'modelscope-travel-ai_go_hotel_mcp-ai_go_hotel_mcp',
    ]);
    expect(results[0]?.connectors.map((connector) => (
      connector.runtime.type === 'mcp' ? connector.runtime.serverTemplate : undefined
    ))).toEqual([
      { url: 'https://xsct.ai/mcp', transport: 'streamable-http' },
      { url: 'https://mcp.supabase.com/mcp', transport: 'streamable-http' },
      { url: 'https://mcp.aigohotel.com/mcp', transport: 'streamable-http' },
    ]);
    expect(results[0]?.totalPages).toBe(1);
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

  it('previews MCP connector capabilities without saving the server config', async () => {
    const config = { mcp: { servers: {} } } as Config;
    const fetch = getConnectorDefinition('fetch');
    expect(fetch).toBeDefined();
    const capabilitySpy = vi
      .spyOn(bundleMcpMaterialize, 'listBundleMcpServerCapabilitiesForGateway')
      .mockResolvedValue({
        serverId: 'fetch',
        toolCount: 1,
        resourceCount: 0,
        promptCount: 0,
        tools: [{ name: 'fetch', shortName: 'fetch', description: 'Fetch a URL.' }],
        resources: [],
        prompts: [],
      });

    const preview = await previewConnectorDefinition(config, fetch!, {});

    expect(preview).toMatchObject({
      serverId: 'fetch',
      ok: true,
      status: 'ok',
      toolCount: 1,
      tools: [{ name: 'fetch', shortName: 'fetch', description: 'Fetch a URL.' }],
    });
    expect(capabilitySpy).toHaveBeenCalledWith(expect.objectContaining({
      serverId: 'fetch',
      cfg: expect.objectContaining({
        mcp: expect.objectContaining({
          servers: expect.objectContaining({
            fetch: expect.objectContaining({
              xopcConnector: expect.objectContaining({ managed: true, connectorId: 'fetch' }),
            }),
          }),
        }),
      }),
    }));
    expect(config.mcp?.servers?.fetch).toBeUndefined();
    expect(listConnectorInstances(config)).toEqual([]);
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
    const resolver = { resolveApiKey: vi.fn().mockResolvedValue('composio_test') } as unknown as CredentialResolver;

    const instance = await installConnector(config, 'composio-gmail', {}, resolver);

    expect(instance).toMatchObject({
      instanceId: 'composio-gmail',
      connectorId: 'composio-gmail',
      materialized: { type: 'composio', id: 'composio-gmail', toolkit: 'gmail', role: 'toolkit' },
    });
    expect(config.connectors?.instances?.['composio-gmail']).toMatchObject({
      runtime: { type: 'composio', toolkit: 'gmail', role: 'toolkit' },
      scope: 'read',
      xopcConnector: { managed: true, connectorId: 'composio-gmail' },
    });
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
