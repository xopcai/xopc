import { describe, expect, it } from 'vitest';

import { buildSafeToolName, sanitizeServerName, TOOL_NAME_SEPARATOR } from '../bundle-mcp-names.js';

describe('bundle-mcp-names', () => {
  it('builds server__tool names capped at 64 chars', () => {
    const reserved = new Set<string>();
    const server = sanitizeServerName('my server!', reserved);
    const name = buildSafeToolName({
      serverName: server,
      toolName: 'do_the_thing',
      reservedNames: reserved,
    });
    expect(name).toContain(TOOL_NAME_SEPARATOR);
    expect(name.length).toBeLessThanOrEqual(64);
  });

  it('dedupes colliding safe tool names', () => {
    const reserved = new Set<string>(['demo__tool']);
    const name = buildSafeToolName({
      serverName: 'demo',
      toolName: 'tool',
      reservedNames: reserved,
    });
    expect(name).not.toBe('demo__tool');
  });
});
