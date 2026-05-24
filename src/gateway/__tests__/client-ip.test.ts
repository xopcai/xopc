import { describe, expect, it } from 'vitest';

import {
  isIpInCidr,
  isTrustedProxyAddress,
  normalizeIpAddress,
  resolveClientIp,
} from '../client-ip.js';

describe('client-ip', () => {
  it('normalizes IPv4-mapped IPv6 addresses', () => {
    expect(normalizeIpAddress('::ffff:127.0.0.1')).toBe('127.0.0.1');
  });

  it('matches IPv4 CIDR ranges', () => {
    expect(isIpInCidr('10.0.0.5', '10.0.0.0/8')).toBe(true);
    expect(isIpInCidr('11.0.0.5', '10.0.0.0/8')).toBe(false);
  });

  it('matches exact proxy IPs', () => {
    expect(isTrustedProxyAddress('10.0.0.1', ['10.0.0.1'])).toBe(true);
    expect(isTrustedProxyAddress('10.0.0.2', ['10.0.0.1'])).toBe(false);
  });

  it('returns direct remote when source is not a trusted proxy', () => {
    expect(
      resolveClientIp({
        remoteAddr: '203.0.113.10',
        forwardedFor: '198.51.100.1',
        trustedProxies: ['10.0.0.1'],
      }),
    ).toBe('203.0.113.10');
  });

  it('walks X-Forwarded-For from the right for trusted proxy hops', () => {
    expect(
      resolveClientIp({
        remoteAddr: '10.0.0.1',
        forwardedFor: '198.51.100.1, 10.0.0.2',
        trustedProxies: ['10.0.0.0/8'],
      }),
    ).toBe('198.51.100.1');
  });

  it('fails closed without forwarded chain when remote is trusted proxy', () => {
    expect(
      resolveClientIp({
        remoteAddr: '10.0.0.1',
        trustedProxies: ['10.0.0.1'],
        allowRealIpFallback: false,
      }),
    ).toBeUndefined();
  });

  it('uses X-Real-IP fallback only when explicitly enabled', () => {
    expect(
      resolveClientIp({
        remoteAddr: '10.0.0.1',
        realIp: '198.51.100.9',
        trustedProxies: ['10.0.0.1'],
        allowRealIpFallback: true,
      }),
    ).toBe('198.51.100.9');
  });
});
