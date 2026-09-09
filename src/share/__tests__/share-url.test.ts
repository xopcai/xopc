import { describe, expect, it, vi } from 'vitest';

const { mockedGetTunnelStatus } = vi.hoisted(() => ({
  mockedGetTunnelStatus: vi.fn(() => ({ state: 'disconnected', publicUrl: null })),
}));
vi.mock('../../tunnel/tunnel-service.js', () => ({
  getTunnelService: () => ({ getStatus: mockedGetTunnelStatus }),
}));

import {
  resolveReachabilityForList,
  resolveShareUrl,
  resolveSiteShareUrl,
} from '../share-url.js';

describe('resolveShareUrl', () => {
  it('returns public and lan URLs when tunnel is active', () => {
    mockedGetTunnelStatus.mockReturnValue({
      state: 'connected',
      publicUrl: 'https://abc123.frp.xopc.ai',
    });

    const resolved = resolveShareUrl('token123', { gatewayHost: '192.168.1.10', gatewayPort: 18790 });

    expect(resolved.reachability).toBe('public');
    expect(resolved.shareUrl).toBe('https://abc123.frp.xopc.ai/s/token123');
    expect(resolved.lanUrl).toBe('http://192.168.1.10:18790/s/token123');
  });

  it('returns lan reachability for non-loopback gateway without tunnel', () => {
    mockedGetTunnelStatus.mockReturnValue({ state: 'disconnected', publicUrl: null });

    const resolved = resolveShareUrl('token123', { gatewayHost: '192.168.1.10', gatewayPort: 18790 });

    expect(resolved.reachability).toBe('lan');
    expect(resolved.shareUrl).toBe('http://192.168.1.10:18790/s/token123');
    expect(resolved.lanUrl).toBeNull();
  });

  it('returns local-only for loopback gateway without tunnel', () => {
    mockedGetTunnelStatus.mockReturnValue({ state: 'disconnected', publicUrl: null });

    const resolved = resolveShareUrl('token123', { gatewayHost: '127.0.0.1', gatewayPort: 18790 });

    expect(resolved.reachability).toBe('local-only');
    expect(resolved.shareUrl).toBe('http://localhost:18790/s/token123');
    expect(resolved.lanUrl).toBeNull();
    expect(resolved.reachabilityHint).toContain('隧道');
  });

  it('reports public via the user-configured reverse-proxy URL when no tunnel is up', () => {
    mockedGetTunnelStatus.mockReturnValue({ state: 'disconnected', publicUrl: null });

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
    mockedGetTunnelStatus.mockReturnValue({ state: 'disconnected', publicUrl: null });

    const resolved = resolveShareUrl('token123', {
      gatewayHost: '127.0.0.1',
      gatewayPort: 18790,
      reverseProxyPublicUrl: 'https://gateway.example.com/',
    });

    expect(resolved.shareUrl).toBe('https://gateway.example.com/s/token123');
  });

  it('prefers the FRP tunnel over the reverse-proxy URL when both are present', () => {
    mockedGetTunnelStatus.mockReturnValue({
      state: 'connected',
      publicUrl: 'https://abc123.frp.xopc.ai',
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
    mockedGetTunnelStatus.mockReturnValue({ state: 'disconnected', publicUrl: null });

    const reachability = resolveReachabilityForList({
      gatewayHost: '127.0.0.1',
      gatewayPort: 18790,
      reverseProxyPublicUrl: 'https://gateway.example.com',
    });

    expect(reachability).toBe('public');
  });

  it('falls through to lan / local-only when reverse-proxy URL is empty', () => {
    mockedGetTunnelStatus.mockReturnValue({ state: 'disconnected', publicUrl: null });

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

  it('uses the FRP gateway subpath when an FRP tunnel is up', () => {
    mockedGetTunnelStatus.mockReturnValue({
      state: 'connected',
      publicUrl: 'https://abc123.frp.xopc.ai',
    });

    const resolved = resolveSiteShareUrl(baseCtx);

    expect(resolved.reachability).toBe('public');
    expect(resolved.shareUrl).toBe('https://abc123.frp.xopc.ai/site/sitetok/');
    expect(resolved.thumbnailUrl).toBe('https://abc123.frp.xopc.ai/site/sitetok/thumbnail');
  });

  it('does not treat a stopped persisted tunnel as public', () => {
    mockedGetTunnelStatus.mockReturnValue({
      state: 'disconnected',
      publicUrl: 'https://abc123.frp.xopc.ai',
    });

    expect(resolveSiteShareUrl(baseCtx).reachability).toBe('local-only');
    expect(resolveShareUrl('token123', baseCtx).reachability).toBe('local-only');
  });

  it('falls back to the reverse-proxy subpath when no tunnel is up', () => {
    mockedGetTunnelStatus.mockReturnValue({ state: 'disconnected', publicUrl: null });

    const resolved = resolveSiteShareUrl({
      ...baseCtx,
      reverseProxyPublicUrl: 'https://gateway.example.com',
    });

    expect(resolved.reachability).toBe('public');
    expect(resolved.shareUrl).toBe('https://gateway.example.com/site/sitetok/');
    expect(resolved.thumbnailUrl).toBe('https://gateway.example.com/site/sitetok/thumbnail');
  });

  it('falls back to the bind host with local-only / lan when nothing public is configured', () => {
    mockedGetTunnelStatus.mockReturnValue({ state: 'disconnected', publicUrl: null });

    const local = resolveSiteShareUrl(baseCtx);
    expect(local.reachability).toBe('local-only');
    expect(local.shareUrl).toBe('http://127.0.0.1:18790/site/sitetok/');
    expect(local.thumbnailUrl).toBe('http://127.0.0.1:18790/site/sitetok/thumbnail');

    const lan = resolveSiteShareUrl({ ...baseCtx, gatewayHost: '192.168.1.10' });
    expect(lan.reachability).toBe('lan');
    expect(lan.shareUrl).toBe('http://192.168.1.10:18790/site/sitetok/');
  });
});
