import { expect, it } from 'vitest';
import { canonicalizeConfiguredMcpServer, normalizeConfiguredMcpServers } from '../mcp-config-normalize.js';
it('preserves native pi HTTP fields without introducing legacy transport aliases', () => {
  expect(canonicalizeConfiguredMcpServer({ type: 'http', url: 'https://example.com/mcp', timeout: 30 })).toEqual({ type: 'http', url: 'https://example.com/mcp', timeout: 30 });
});
it('filters malformed server containers', () => {
  expect(normalizeConfiguredMcpServers({ good: { command: 'node' }, bad: 'invalid' })).toEqual({ good: { command: 'node' } });
});
