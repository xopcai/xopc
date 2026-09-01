import { describe, expect, it } from 'vitest';

import {
  buildMcpServerConfigFromRow,
  normalizeMcpSettingsFromConfig,
} from '../mcp-config-api';

describe('MCP OAuth config', () => {
  it('round-trips OAuth and an optional public client id', () => {
    const state = normalizeMcpSettingsFromConfig({
      mcp: {
        servers: {
          private: {
            url: 'https://mcp.example.com/api',
            transport: 'streamable-http',
            headers: { 'X-Tenant': 'tenant-a' },
            auth: { type: 'oauth', clientId: 'public-client' },
          },
        },
      },
    });

    expect(state.servers[0]).toMatchObject({
      auth: 'oauth',
      oauthClientId: 'public-client',
    });
    expect(buildMcpServerConfigFromRow(state.servers[0]!)).toMatchObject({
      url: 'https://mcp.example.com/api',
      transport: 'streamable-http',
      headers: { 'X-Tenant': 'tenant-a' },
      auth: { type: 'oauth', clientId: 'public-client' },
    });
  });

  it('does not serialize OAuth for SSE', () => {
    const state = normalizeMcpSettingsFromConfig({
      mcp: {
        servers: {
          events: {
            url: 'https://mcp.example.com/sse',
            transport: 'sse',
          },
        },
      },
    });
    const row = { ...state.servers[0]!, auth: 'oauth' as const };

    expect(buildMcpServerConfigFromRow(row)).not.toHaveProperty('auth');
  });
});
