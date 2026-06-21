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
});
