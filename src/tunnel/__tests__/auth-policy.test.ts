import { describe, expect, it } from 'vitest';
import { requireTunnelGatewayToken } from '../auth-policy.js';

describe('public tunnel authentication', () => {
  it('rejects disabled auth even when a stale token remains', () => {
    expect(() => requireTunnelGatewayToken({ mode: 'none', token: 'stale' })).toThrow();
    expect(() => requireTunnelGatewayToken({ mode: 'trusted-proxy' })).toThrow();
    expect(() => requireTunnelGatewayToken({ mode: 'token', token: ' ' })).toThrow();
    expect(requireTunnelGatewayToken({ mode: 'token', token: 'active-token' })).toBe('active-token');
  });
});
