import { describe, expect, it } from 'vitest';

import {
  isMcpCatalogToolDenied,
  mcpToolPolicyId,
  resolveMcpToolPolicy,
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

  it('lets a specific tool policy override its server policy', () => {
    const identity = { serverId: 'fetch', policyToolId: mcpToolPolicyId('fetch', 'get') };
    const policy = {
      servers: { fetch: { mode: 'deny' as const } },
      tools: { 'mcp:fetch:get': { mode: 'allow' as const } },
    };
    expect(resolveMcpToolPolicy(identity, policy)?.mode).toBe('allow');
    expect(isMcpCatalogToolDenied(identity, policy)).toBe(false);
  });

  it('resolves server policies through the normalized MCP namespace', () => {
    const identity = {
      serverId: 'my-server',
      policyToolId: mcpToolPolicyId('my-server', 'read'),
    };
    const policy = {
      servers: { 'my server': { mode: 'confirm' as const } },
    };

    expect(resolveMcpToolPolicy(identity, policy)).toMatchObject({ mode: 'confirm' });
  });
});
