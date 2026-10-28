import { expect, it } from 'vitest';
import { McpConfigSchema, McpServerSchema } from '../schema.js';
it('accepts native OAuth options, exposure and seconds-based timeout', () => {
  expect(McpServerSchema.safeParse({ type: 'http', url: 'https://mcp.example.com', oauth: { clientId: 'registered', callbackPort: 8765 }, timeout: 30, exposure: 'deferred' }).success).toBe(true);
});
it('accepts the explicit legacy SSE transport without reviving the retired transport alias', () => {
  expect(McpServerSchema.safeParse({ type: 'sse', url: 'https://example.com/sse' }).success).toBe(true);
});
it.each([{ url: 'https://example.com', transport: 'sse' },
  { url: 'https://example.com', auth: { type: 'oauth' } }, { command: 'node', requestTimeoutMs: 3000 },
  { command: 'node', url: 'https://example.com' }])('rejects removed or conflicting configuration %o', value => {
  expect(McpServerSchema.safeParse(value).success).toBe(false);
});
it('rejects names colliding under native pi normalization', () => {
  expect(McpConfigSchema.safeParse({ servers: { 'a-b': { command: 'node' }, a_b: { command: 'node' } } }).success).toBe(false);
});
it('accepts an optional display name without changing server identity', () => {
  expect(McpConfigSchema.parse({ servers: { stable_id: { command: 'node', displayName: '团队知识库' } } })?.servers?.stable_id.displayName).toBe('团队知识库');
  expect(McpServerSchema.safeParse({ command: 'node', displayName: 123 }).success).toBe(false);
});
