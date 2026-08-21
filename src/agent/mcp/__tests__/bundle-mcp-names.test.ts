import { describe, expect, it } from 'vitest';

import { sanitizeServerName } from '../bundle-mcp-names.js';

describe('bundle-mcp-names', () => {
  it('builds deterministic server namespaces for catalogs', () => {
    expect(sanitizeServerName('my server!', new Set<string>())).toBe('my-server-');
  });

  it('dedupes colliding server namespaces', () => {
    const reserved = new Set<string>(['demo']);
    expect(sanitizeServerName('demo', reserved)).toBe('demo-2');
  });
});
