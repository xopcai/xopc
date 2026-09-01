import { describe, expect, it } from 'vitest';

import { McpServerSchema } from '../schema.js';

describe('McpServerSchema OAuth', () => {
  it('accepts a streamable HTTP OAuth server', () => {
    expect(McpServerSchema.safeParse({
      url: 'https://mcp.example.com/api',
      auth: { type: 'oauth' },
    }).success).toBe(true);
  });

  it.each([
    { command: 'node', auth: { type: 'oauth' } },
    { url: 'https://mcp.example.com/sse', transport: 'sse', auth: { type: 'oauth' } },
    {
      url: 'https://mcp.example.com/api',
      headers: { authorization: 'Bearer static' },
      auth: { type: 'oauth' },
    },
  ])('rejects unsupported or ambiguous OAuth config: %o', (config) => {
    expect(McpServerSchema.safeParse(config).success).toBe(false);
  });
});
