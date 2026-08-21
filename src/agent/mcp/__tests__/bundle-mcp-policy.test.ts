import { describe, expect, it } from 'vitest';

import {
  isMcpCatalogToolDenied,
  mcpToolPolicyId,
} from '../bundle-mcp-policy.js';

describe('bundle-mcp-policy', () => {
  it('applies server and catalog-tool deny policies', () => {
    const identity = { serverId: 'fetch', policyToolId: mcpToolPolicyId('fetch', 'get') };
    expect(isMcpCatalogToolDenied(identity, { servers: { fetch: { mode: 'deny' } } })).toBe(true);
    expect(isMcpCatalogToolDenied(identity, { tools: { 'mcp:fetch:get': { mode: 'deny' } } })).toBe(true);
    expect(isMcpCatalogToolDenied(identity, { servers: { fetch: { mode: 'allow' } } })).toBe(false);
    expect(isMcpCatalogToolDenied(identity, { tools: { 'mcp:other:get': { mode: 'deny' } } })).toBe(false);
  });

  it('encodes policy identity fragments', () => {
    expect(mcpToolPolicyId('my server', 'read:file')).toBe('mcp:my%20server:read%3Afile');
  });
});
