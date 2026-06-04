import { describe, expect, it, vi } from 'vitest';

vi.mock('../../tunnel/tunnel-state.js', () => ({
  loadTunnelState: vi.fn(() => null),
}));

import { loadTunnelState } from '../../tunnel/tunnel-state.js';
import {
  resolveReachabilityForList,
  resolveShareUrl,
  resolveSiteShareUrl,
} from '../share-url.js';

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

  it('reports public via the user-configured reverse-proxy URL when no tunnel is up', () => {
    mockedLoadTunnelState.mockReturnValue(null);

    const resolved = resolveShareUrl('token123', {
      gatewayHost: '127.0.0.1',
      gatewayPort: 18790,
      reverseProxyPublicUrl: 'https://gateway.example.com',
    });

    expect(resolved.reachability).toBe('public');
    expect(resolved.shareUrl).toBe('https://gateway.example.com/s/token123');
    expect(resolved.reachabilityHint).toBeNull();
  });

  it('strips a trailing slash on the reverse-proxy URL before joining the share path', () => {
    mockedLoadTunnelState.mockReturnValue(null);

    const resolved = resolveShareUrl('token123', {
      gatewayHost: '127.0.0.1',
      gatewayPort: 18790,
      reverseProxyPublicUrl: 'https://gateway.example.com/',
    });

    expect(resolved.shareUrl).toBe('https://gateway.example.com/s/token123');
  });

  it('prefers the FRP tunnel over the reverse-proxy URL when both are present', () => {
    mockedLoadTunnelState.mockReturnValue({
      publicUrl: 'https://abc123.frp.xopc.ai',
      subdomain: 'abc123',
      registeredAt: '2026-01-01T00:00:00.000Z',
    });

    const resolved = resolveShareUrl('token123', {
      gatewayHost: '127.0.0.1',
      gatewayPort: 18790,
      reverseProxyPublicUrl: 'https://gateway.example.com',
    });

    expect(resolved.reachability).toBe('public');
    expect(resolved.shareUrl).toBe('https://abc123.frp.xopc.ai/s/token123');
  });
});

describe('resolveReachabilityForList', () => {
  it('reports public when only the reverse-proxy URL is configured', () => {
    mockedLoadTunnelState.mockReturnValue(null);

    const reachability = resolveReachabilityForList({
      gatewayHost: '127.0.0.1',
      gatewayPort: 18790,
      reverseProxyPublicUrl: 'https://gateway.example.com',
    });

    expect(reachability).toBe('public');
  });

  it('falls through to lan / local-only when reverse-proxy URL is empty', () => {
    mockedLoadTunnelState.mockReturnValue(null);

    expect(
      resolveReachabilityForList({
        gatewayHost: '192.168.1.10',
        gatewayPort: 18790,
        reverseProxyPublicUrl: '',
      }),
    ).toBe('lan');

    expect(
      resolveReachabilityForList({
        gatewayHost: '127.0.0.1',
        gatewayPort: 18790,
        reverseProxyPublicUrl: null,
      }),
    ).toBe('local-only');
  });
});

describe('resolveSiteShareUrl', () => {
  const baseCtx = {
    gatewayHost: '127.0.0.1',
    gatewayPort: 18790,
    token: 'sitetok',
    subdomainLabel: 'sitelabel',
    publicHostSuffix: 'share.xopc.ai',
  };

  it('uses the wildcard subdomain when an FRP tunnel is up', () => {
    mockedLoadTunnelState.mockReturnValue({
      publicUrl: 'https://abc123.frp.xopc.ai',
      subdomain: 'abc123',
      registeredAt: '2026-01-01T00:00:00.000Z',
    });

    const resolved = resolveSiteShareUrl(baseCtx);

    expect(resolved.reachability).toBe('public');
    expect(resolved.shareUrl).toBe('https://sitelabel.share.xopc.ai/');
    expect(resolved.thumbnailUrl).toBe('https://sitelabel.share.xopc.ai/site/sitetok/thumbnail');
  });

  it('falls back to the reverse-proxy subpath when no tunnel is up', () => {
    mockedLoadTunnelState.mockReturnValue(null);

    const resolved = resolveSiteShareUrl({
      ...baseCtx,
      reverseProxyPublicUrl: 'https://gateway.example.com',
    });

    expect(resolved.reachability).toBe('public');
    expect(resolved.shareUrl).toBe('https://gateway.example.com/site/sitetok/');
    expect(resolved.thumbnailUrl).toBe('https://gateway.example.com/site/sitetok/thumbnail');
  });

  it('falls back to the bind host with local-only / lan when nothing public is configured', () => {
    mockedLoadTunnelState.mockReturnValue(null);

    const local = resolveSiteShareUrl(baseCtx);
    expect(local.reachability).toBe('local-only');
    expect(local.shareUrl).toBe('http://127.0.0.1:18790/site/sitetok/');
    expect(local.thumbnailUrl).toBe('http://127.0.0.1:18790/site/sitetok/thumbnail');

    const lan = resolveSiteShareUrl({ ...baseCtx, gatewayHost: '192.168.1.10' });
    expect(lan.reachability).toBe('lan');
    expect(lan.shareUrl).toBe('http://192.168.1.10:18790/site/sitetok/');
  });
});
