import { describe, expect, it } from 'vitest';

import { resolveMcpTransportConfig } from '../mcp-transport-config.js';

describe('mcp-transport-config', () => {
  it('defaults URL MCP servers to streamable HTTP', () => {
    const resolved = resolveMcpTransportConfig('teambition', {
      url: 'https://open.teambition.com/api/mcp',
    });

    expect(resolved).toMatchObject({
      kind: 'http',
      transportType: 'streamable-http',
      url: 'https://open.teambition.com/api/mcp',
      requestTimeoutMs: 30 * 60 * 1000,
    });
  });

  it('keeps explicit SSE transport', () => {
    const resolved = resolveMcpTransportConfig('events', {
      url: 'https://example.com/sse',
      transport: 'sse',
    });

    expect(resolved).toMatchObject({
      kind: 'http',
      transportType: 'sse',
      url: 'https://example.com/sse',
    });
  });

  it('resolves OAuth only for streamable HTTP', () => {
    expect(resolveMcpTransportConfig('private', {
      url: 'https://example.com/mcp',
      auth: { type: 'oauth', clientId: 'public-client' },
    })).toMatchObject({
      kind: 'http',
      transportType: 'streamable-http',
      auth: { type: 'oauth', clientId: 'public-client' },
    });

    expect(resolveMcpTransportConfig('events-with-oauth', {
      url: 'https://example.com/sse',
      transport: 'sse',
      auth: { type: 'oauth' },
    })).toBeNull();
  });

  it('rejects ambiguous OAuth and static bearer configuration', () => {
    expect(resolveMcpTransportConfig('ambiguous', {
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer static' },
      auth: { type: 'oauth' },
    })).toBeNull();
  });
});
