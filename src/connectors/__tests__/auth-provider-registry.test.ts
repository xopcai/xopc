import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import type { ConnectorDefinition } from '../types.js';

const start = vi.fn();

vi.mock('../../agent/mcp/oauth/mcp-oauth-manager.js', () => ({
  getMcpOAuthManager: () => ({ start }),
}));

const { startConnectorAuthorization } = await import('../auth-provider-registry.js');

describe('connector authorization provider', () => {
  beforeEach(() => start.mockReset());

  it('starts OAuth through the installed MCP server instance', async () => {
    const definition: ConnectorDefinition = {
      id: 'store-demo',
      version: '1.0.0',
      displayName: 'Store Demo',
      description: 'OAuth connector.',
      category: 'docs',
      kind: 'mcp',
      source: 'store',
      capabilities: ['tools', 'auth.oauth', 'runtime.mcp.streamableHttp'],
      auth: { mode: 'oauth' },
      setup: {},
      runtime: {
        type: 'mcp',
        serverId: 'store_demo',
        serverTemplate: { url: 'https://mcp.example.com/mcp', transport: 'streamable-http', auth: { type: 'oauth' } },
      },
    };
    const server = { ...definition.runtime.serverTemplate, xopcConnector: { managed: true, connectorId: definition.id } };
    const config = { mcp: { servers: { installed_id: server } } } as Config;
    start.mockResolvedValue({
      configured: true,
      status: 'authorizing',
      session: { authorizationUrl: 'https://accounts.example.com/authorize' },
    });

    await expect(startConnectorAuthorization(definition, config, 'installed_id')).resolves.toEqual({
      connectorId: 'store-demo',
      provider: 'mcp',
      status: 'authorizing',
      authorizationUrl: 'https://accounts.example.com/authorize',
    });
    expect(start).toHaveBeenCalledWith({ serverId: 'installed_id', rawServer: server, cfg: config });
  });

  it('rejects authorization for connectors that do not use OAuth', async () => {
    const definition = {
      id: 'plain',
      auth: { mode: 'none' },
      runtime: { type: 'mcp', serverId: 'plain' },
    } as ConnectorDefinition;
    await expect(startConnectorAuthorization(definition, {} as Config)).rejects.toThrow('does not use OAuth');
  });

  it('does not authorize an unmanaged MCP server with a matching name', async () => {
    const definition: ConnectorDefinition = {
      id: 'store-demo',
      version: '1.0.0',
      displayName: 'Store Demo',
      description: 'OAuth connector.',
      category: 'docs',
      kind: 'mcp',
      source: 'store',
      capabilities: ['tools', 'auth.oauth', 'runtime.mcp.streamableHttp'],
      auth: { mode: 'oauth' },
      setup: {},
      runtime: {
        type: 'mcp',
        serverId: 'store_demo',
        serverTemplate: { url: 'https://mcp.example.com/mcp', transport: 'streamable-http', auth: { type: 'oauth' } },
      },
    };
    const config = {
      mcp: { servers: { store_demo: definition.runtime.serverTemplate } },
    } as Config;

    await expect(startConnectorAuthorization(definition, config)).rejects.toThrow('is not managed');
    expect(start).not.toHaveBeenCalled();
  });
});
