import { describe, expect, it } from 'vitest';

import { buildMcpServerConfigFromRow, emptyMcpServerRow, normalizeMcpAddress, normalizeMcpSettingsFromConfig, parseMcpConfigImport, suggestMcpServerId } from '../mcp-config-api';

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

  it('fills an address scheme and generates a unique name without asking the user', () => {
    const row = { ...emptyMcpServerRow(), url: normalizeMcpAddress('mcp.example.com/tools') };
    expect(row.url).toBe('https://mcp.example.com/tools');
    expect(suggestMcpServerId(row, new Set(['mcp-example-com', 'mcp_example_com_2']))).toBe('mcp_example_com_3');
    expect(normalizeMcpAddress('localhost:9000/mcp')).toBe('http://localhost:9000/mcp');
    expect(normalizeMcpAddress('example.com:9000/mcp')).toBe('https://example.com:9000/mcp');
    expect(() => normalizeMcpAddress('file:///etc/passwd')).toThrow('HTTP');
  });

  it('imports published MCP JSON without losing argument boundaries or advanced fields', () => {
    const raw = { command: 'node', args: ['server.js', '--path', '/a folder/', '', 'a"b'], env: { TOKEN: '${TOKEN}' }, exposure: 'deferred' };
    const [row] = parseMcpConfigImport(JSON.stringify({ mcpServers: { docs: raw } }));
    expect(row.id).toBe('docs');
    expect(buildMcpServerConfigFromRow(row)).toEqual({ ...raw, type: 'stdio' });
    expect(parseMcpConfigImport('{"url":"example.com/mcp"}')[0].url).toBe('https://example.com/mcp');
    expect(() => parseMcpConfigImport('{"mcpServers":{"bad":{"args":[]}}}')).toThrow('URL or command');
  });

  it('parses quoted local arguments without running shell substitutions', () => {
    const row = { ...emptyMcpServerRow(), transport: 'stdio' as const, command: 'node', argsText: `--path "/a folder" '' '$(whoami)'` };
    expect(buildMcpServerConfigFromRow(row).args).toEqual(['--path', '/a folder', '', '$(whoami)']);
    expect(() => buildMcpServerConfigFromRow({ ...row, argsText: "'unterminated" })).toThrow('unclosed quote');
  });
});

it('preserves Windows paths and empty arguments when editing a pasted argument list', () => {
  const row = { ...emptyMcpServerRow(), transport: 'stdio' as const, command: 'node', argsText: '"C:\\work\\docs" ""' };
  expect(buildMcpServerConfigFromRow(row).args).toEqual(['C:\\work\\docs', '']);
});

it('round-trips environment references and rejects duplicate variable names before saving', () => {
  const reference = { xopcSecretRef: { provider: 'vault', fieldKey: 'TOKEN' } };
  const row = normalizeMcpSettingsFromConfig({ mcp: { servers: { local: { command: 'node', env: { TOKEN: reference, MODE: 'test' } } } } }).servers[0];
  expect(buildMcpServerConfigFromRow(row).env).toEqual({ TOKEN: reference, MODE: 'test' });
  expect(() => buildMcpServerConfigFromRow({ ...row, envEntries: [{ clientKey: '1', key: 'TOKEN', value: 'one' }, { clientKey: '2', key: 'TOKEN', value: 'two' }] })).toThrow('unique');
});

it('stores display names separately from stable IDs and rejects invalid import containers', () => {
  const row = normalizeMcpSettingsFromConfig({ mcp: { servers: { stable_id: { command: 'node', displayName: '团队知识库' } } } }).servers[0];
  expect(row.id).toBe('stable_id'); expect(buildMcpServerConfigFromRow(row).displayName).toBe('团队知识库');
  expect(() => parseMcpConfigImport('{"mcpServers":[]}')).toThrow('object');
});

it('preserves legacy SSE and secret references through a management edit', () => {
  const server = { type: 'sse', url: 'https://legacy.example/sse', headers: { 'X-API-Key': { xopcSecretRef: { provider: 'fixture', fieldKey: 'key', prefix: '' } } }, exposure: 'codemode' };
  const row = normalizeMcpSettingsFromConfig({ mcp: { servers: { legacy: server } } }).servers[0];
  expect(row.transport).toBe('sse');
  expect(buildMcpServerConfigFromRow(row)).toEqual(server);
});
