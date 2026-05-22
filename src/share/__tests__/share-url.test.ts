import { describe, expect, it, vi } from 'vitest';

vi.mock('../../tunnel/tunnel-state.js', () => ({
  loadTunnelState: vi.fn(() => null),
}));

import { loadTunnelState } from '../../tunnel/tunnel-state.js';
import { resolveShareUrl } from '../share-url.js';

const mockedLoadTunnelState = vi.mocked(loadTunnelState);

describe('resolveShareUrl', () => {
  it('returns public and lan URLs when tunnel is active', () => {
    mockedLoadTunnelState.mockReturnValue({
      publicUrl: 'https://abc123.frp.xopc.ai',
      subdomain: 'abc123',
      registeredAt: '2026-01-01T00:00:00.000Z',
    });

    const resolved = resolveShareUrl('token123', { gatewayHost: '192.168.1.10', gatewayPort: 18790 });

    expect(resolved.reachability).toBe('public');
    expect(resolved.shareUrl).toBe('https://abc123.frp.xopc.ai/s/token123');
    expect(resolved.lanUrl).toBe('http://192.168.1.10:18790/s/token123');
  });

  it('returns lan reachability for non-loopback gateway without tunnel', () => {
    mockedLoadTunnelState.mockReturnValue(null);

    const resolved = resolveShareUrl('token123', { gatewayHost: '192.168.1.10', gatewayPort: 18790 });

    expect(resolved.reachability).toBe('lan');
    expect(resolved.shareUrl).toBe('http://192.168.1.10:18790/s/token123');
    expect(resolved.lanUrl).toBeNull();
  });

  it('returns local-only for loopback gateway without tunnel', () => {
    mockedLoadTunnelState.mockReturnValue(null);

    const resolved = resolveShareUrl('token123', { gatewayHost: '127.0.0.1', gatewayPort: 18790 });

    expect(resolved.reachability).toBe('local-only');
    expect(resolved.shareUrl).toBe('http://localhost:18790/s/token123');
    expect(resolved.lanUrl).toBeNull();
    expect(resolved.reachabilityHint).toContain('隧道');
  });
});
