import { describe, expect, it } from 'vitest';

import {
  canonicalizeConfiguredMcpServer,
  normalizeConfiguredMcpServers,
  resolveXopcMcpTransportAlias,
} from '../mcp-config-normalize.js';

describe('mcp-config-normalize', () => {
  it('maps CLI type http to streamable-http transport', () => {
    const next = canonicalizeConfiguredMcpServer({
      type: 'http',
      url: 'https://example.com/mcp',
    });
    expect(next.transport).toBe('streamable-http');
    expect(next.type).toBeUndefined();
  });

  it('resolveXopcMcpTransportAlias accepts sse and streamable-http', () => {
    expect(resolveXopcMcpTransportAlias('sse')).toBe('sse');
    expect(resolveXopcMcpTransportAlias('streamable-http')).toBe('streamable-http');
  });

  it('normalizeConfiguredMcpServers filters non-object entries', () => {
    const servers = normalizeConfiguredMcpServers({
      ok: { command: 'node' },
      bad: 'nope',
    });
    expect(Object.keys(servers)).toEqual(['ok']);
    expect(servers.ok?.command).toBe('node');
  });
});
