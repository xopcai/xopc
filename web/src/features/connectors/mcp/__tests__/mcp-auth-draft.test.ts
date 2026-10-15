import { describe, expect, it } from 'vitest';

import { applyMcpAuthDraft, createMcpAuthDraft, invalidMcpHeaderIndex } from '../mcp-auth-draft';
import { buildMcpServerConfigFromRow, normalizeMcpSettingsFromConfig } from '../mcp-config-api';
import { recordToHeaders } from '../mcp-headers-utils';
import { mcpServerEndpointSummary } from '../mcp-server-endpoint-summary';

function row(raw: Record<string, unknown>) {
  return normalizeMcpSettingsFromConfig({ mcp: { servers: { docs: { url: 'https://example.com/mcp', ...raw } } } }).servers[0];
}

describe('MCP authentication drafts', () => {
  it('recognizes existing bearer credentials and preserves unrelated headers without duplicating the prefix', () => {
    const server = row({ headers: { authorization: 'Bearer original', 'X-Tenant': 'team' } });
    const draft = createMcpAuthDraft(server);
    expect(draft.mode).toBe('bearer');
    const next = applyMcpAuthDraft(server, { ...draft, token: 'Bearer replacement' });
    expect(buildMcpServerConfigFromRow(next).headers).toEqual({ Authorization: 'Bearer replacement', 'X-Tenant': 'team' });
  });

  it('sends only the selected method and clears incompatible provider/OAuth authentication', () => {
    const server = row({ auth: { provider: 'vendor' }, oauth: { clientId: 'client', scope: 'read' }, headers: { Authorization: 'Bearer old' } });
    const draft = { ...createMcpAuthDraft(server), mode: 'apiKey' as const, headerName: 'X-Service-Key', apiKey: 'new-key', token: 'inactive-token' };
    const config = buildMcpServerConfigFromRow(applyMcpAuthDraft(server, draft));
    expect(config.headers).toEqual({ 'X-Service-Key': 'new-key' });
    expect(config).not.toHaveProperty('auth'); expect(config).not.toHaveProperty('oauth');
    expect(JSON.stringify(config)).not.toContain('inactive-token'); expect(JSON.stringify(config)).not.toContain('Bearer old');
    const oauth = buildMcpServerConfigFromRow(applyMcpAuthDraft(server, { ...draft, mode: 'oauth' }));
    expect(oauth.oauth).toEqual({ clientId: 'client', scope: 'read' }); expect(oauth).not.toHaveProperty('headers');
  });

  it('round-trips credential references, disabled state and advanced configuration without revealing or stringifying references', () => {
    const reference = { xopcSecretRef: { provider: 'vault', fieldKey: 'apiKey', prefix: 'Bearer ' } };
    const raw = { url: 'https://example.com/mcp', type: 'http', headers: { Authorization: reference },
      auth: { provider: 'vendor' }, oauth: { clientId: 'client', callbackPort: 8888 }, enabled: false,
      toolExposure: { write: 'hidden' }, exposure: 'deferred', displayName: '团队文档', vendorExtension: { revision: 1 } };
    const server = row(raw); const draft = createMcpAuthDraft(server);
    expect(draft.mode).toBe('existing');
    expect(server.headers[0]).toMatchObject({ value: '', reference });
    expect(buildMcpServerConfigFromRow(applyMcpAuthDraft(server, draft))).toEqual(raw);
  });

  it('validates duplicate names case-insensitively, header syntax and CR/LF values', () => {
    expect(invalidMcpHeaderIndex(recordToHeaders({ Authorization: 'one', authorization: 'two' }))).toBe(1);
    expect(invalidMcpHeaderIndex(recordToHeaders({ 'bad name': 'key' }))).toBe(0);
    expect(invalidMcpHeaderIndex(recordToHeaders({ 'X-Key': 'one\r\nInjected: two' }))).toBe(0);
    expect(invalidMcpHeaderIndex(recordToHeaders({ 'X-Tenant': 'team' }))).toBe(-1);
  });

  it('omits args and sensitive URL components from endpoint previews', () => {
    expect(mcpServerEndpointSummary(row({ url: 'https://user:password@example.com/mcp?api_key=secret#token' }))).toBe('https://example.com/mcp');
    expect(mcpServerEndpointSummary({ ...row({}), transport: 'stdio', command: 'node', argsText: '["--token","secret"]' })).toBe('node');
  });
});

it('preserves OAuth options together with non-Authorization headers on an unrelated edit', () => {
  const server = row({ oauth: { clientId: 'registered', scope: 'read', callbackPort: 8888 }, headers: { 'X-Tenant': 'team' } });
  const draft = createMcpAuthDraft(server);
  expect(draft.mode).toBe('oauth');
  expect(buildMcpServerConfigFromRow(applyMcpAuthDraft(server, draft))).toMatchObject({
    oauth: { clientId: 'registered', scope: 'read', callbackPort: 8888 }, headers: { 'X-Tenant': 'team' },
  });
});
