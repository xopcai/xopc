import { describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { loadMergedBundleMcpConfig } from '../bundle-mcp-config.js';

describe('bundle-mcp-config', () => {
  it('includes custom configured MCP servers in the agent runtime config', () => {
    const config = {
      mcp: {
        servers: {
          teambition: {
            url: 'https://open.teambition.com/api/mcp',
            transport: 'streamable-http',
            connectionTimeoutMs: 60_000,
          },
          fetch: {
            command: 'uvx',
            args: ['mcp-server-fetch'],
            xopcConnector: { managed: true, connectorId: 'fetch', version: '1.0.0' },
          },
        },
      },
    } as Config;

    const merged = loadMergedBundleMcpConfig({
      workspaceDir: '/tmp/xopc-test-workspace',
      cfg: config,
    });

    expect(merged.config.mcpServers.teambition).toMatchObject({
      url: 'https://open.teambition.com/api/mcp',
      transport: 'streamable-http',
      connectionTimeoutMs: 60_000,
    });
    expect(merged.config.mcpServers.fetch).toMatchObject({
      command: 'uvx',
      xopcConnector: { managed: true, connectorId: 'fetch' },
    });
  });

  it('maps configured MCP servers before exposing them to the runtime', () => {
    const config = {
      mcp: {
        servers: {
          demo: { command: 'configured-demo' },
        },
      },
    } as Config;

    const merged = loadMergedBundleMcpConfig({
      workspaceDir: '/tmp/xopc-test-workspace',
      cfg: config,
      mapConfiguredServer: (server, name) =>
        name === 'demo' ? { command: 'mapped-demo', original: server.command } : server,
    });

    expect(merged.config.mcpServers.demo).toEqual({
      command: 'mapped-demo',
      original: 'configured-demo',
    });
  });

  it('does not expose disabled managed connectors to the agent runtime', () => {
    const config = {
      mcp: {
        servers: {
          disabled: {
            command: 'disabled-connector',
            xopcConnector: { managed: true, connectorId: 'disabled', enabled: false },
          },
          custom: {
            command: 'custom-server',
            enabled: false,
          },
        },
      },
    } as Config;

    const merged = loadMergedBundleMcpConfig({
      workspaceDir: '/tmp/xopc-test-workspace',
      cfg: config,
    });

    expect(merged.config.mcpServers.disabled).toBeUndefined();
    expect(merged.config.mcpServers.custom).toMatchObject({ command: 'custom-server' });
  });

  it('uses only configured MCP servers and never Extension-owned raw MCP config', () => {
    const merged = loadMergedBundleMcpConfig({
      workspaceDir: '/tmp/xopc-test-workspace',
      cfg: { mcp: { servers: { configured: { command: 'configured' } } } } as Config,
    });
    expect(merged.config.mcpServers).toEqual({ configured: { command: 'configured' } });
  });
});
