import { describe, expect, it } from 'vitest';

import { buildMcpServerConfigFromRow, normalizeMcpSettingsFromConfig } from '../mcp-config-api';

describe('native MCP config', () => {
  it('round-trips native OAuth, exposure overrides and seconds-based timeout', () => {
    const server = {
      type: 'http', url: 'https://mcp.example.com/api', headers: { 'X-Tenant': 'tenant-a' },
      oauth: { clientId: 'public-client', callbackPort: 8787, scope: 'read' },
      timeout: 30, exposure: 'deferred', toolExposure: { private: 'hidden' }, enabled: false,
    };
    const state = normalizeMcpSettingsFromConfig({ mcp: { servers: { docs: server } } });
    expect(state.servers[0]).toMatchObject({ oauthClientId: 'public-client', timeout: 30, exposure: 'deferred' });
    expect(buildMcpServerConfigFromRow(state.servers[0])).toEqual(server);
  });

  it('removes HTTP OAuth and headers when changing to stdio', () => {
    const state = normalizeMcpSettingsFromConfig({ mcp: { servers: {
      docs: { url: 'https://example.com/mcp', oauth: { clientId: 'client' }, headers: { Authorization: 'secret' } },
    } } });
    expect(buildMcpServerConfigFromRow({ ...state.servers[0], transport: 'stdio', command: 'node' }))
      .toEqual({ type: 'stdio', command: 'node', exposure: 'codemode' });
  });
});
