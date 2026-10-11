import { expect, it } from 'vitest';
import { McpConfigSchema, McpServerSchema } from '../schema.js';
it('accepts native OAuth options, exposure and seconds-based timeout', () => {
  expect(McpServerSchema.safeParse({ type: 'http', url: 'https://mcp.example.com', oauth: { clientId: 'registered', callbackPort: 8765 }, timeout: 30, exposure: 'deferred' }).success).toBe(true);
});
it.each([{ type: 'sse', url: 'https://example.com' }, { url: 'https://example.com', transport: 'sse' },
  { url: 'https://example.com', auth: { type: 'oauth' } }, { command: 'node', requestTimeoutMs: 3000 },
  { command: 'node', url: 'https://example.com' }])('rejects removed or conflicting configuration %o', value => {
  expect(McpServerSchema.safeParse(value).success).toBe(false);
});
it('rejects names colliding under native pi normalization', () => {
  expect(McpConfigSchema.safeParse({ servers: { 'a-b': { command: 'node' }, a_b: { command: 'node' } } }).success).toBe(false);
});
