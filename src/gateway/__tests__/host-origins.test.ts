import { describe, expect, it } from 'vitest';

import {
  buildDefaultCorsOrigins,
  enumerateLanGatewayCandidates,
  originFromGatewayPublicUrl,
  resolveAllowedBrowserOrigins,
  resolveGatewayCorsOrigins,
} from '../host.js';

describe('originFromGatewayPublicUrl', () => {
  it('extracts origin from tunnel root URL', () => {
    expect(originFromGatewayPublicUrl('https://wxfy4i.frp.xopc.ai/')).toBe(
      'https://wxfy4i.frp.xopc.ai',
    );
  });
});

describe('resolveAllowedBrowserOrigins', () => {
  it('merges tunnel public URL into the allowlist', () => {
    const origins = resolveAllowedBrowserOrigins({
      configuredOrigins: ['http://localhost:18790'],
      port: 18790,
      tunnelPublicUrl: 'https://abc.frp.xopc.ai',
    });
    expect(origins).toContain('http://localhost:18790');
    expect(origins).toContain('https://abc.frp.xopc.ai');
  });

  it('keeps gateway-owned origins when custom origins are configured', () => {
    const origins = resolveGatewayCorsOrigins({
      configuredOrigins: ['https://console.example.com'],
      port: 18790,
      bindHost: '127.0.0.1',
    });
    expect(origins).toEqual(expect.arrayContaining([
      'https://console.example.com',
      'http://localhost:18790',
      'http://127.0.0.1:18790',
    ]));
  });

  it('adds detected LAN origins when listening on all interfaces', () => {
    const origins = buildDefaultCorsOrigins({ port: 28790, bindHost: '0.0.0.0' });
    for (const candidate of enumerateLanGatewayCandidates(28790)) {
      expect(origins).toContain(candidate.url);
    }
  });
});
