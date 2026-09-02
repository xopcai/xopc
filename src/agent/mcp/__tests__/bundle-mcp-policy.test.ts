import { describe, expect, it } from 'vitest';

import { mcpToolPolicyId } from '../bundle-mcp-policy.js';

describe('bundle-mcp-policy', () => {
  it('encodes policy identity fragments', () => {
    expect(mcpToolPolicyId('my server', 'read:file')).toBe('mcp:my%20server:read%3Afile');
  });
});
