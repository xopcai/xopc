import { describe, expect, it } from 'vitest';

import { authorizeTrustedProxy } from '../trusted-proxy.js';

describe('authorizeTrustedProxy', () => {
  const trustedProxyConfig = {
    userHeader: 'x-forwarded-user',
    allowUsers: ['alice@example.com'],
  };

  it('accepts requests from a trusted proxy with allowed user', () => {
    const result = authorizeTrustedProxy({
      remoteAddress: '10.0.0.1',
      getHeader: (name) => (name === 'x-forwarded-user' ? 'alice@example.com' : undefined),
      trustedProxies: ['10.0.0.0/8'],
      trustedProxyConfig,
    });
    expect(result).toEqual({ ok: true, user: 'alice@example.com' });
  });

  it('rejects untrusted source addresses', () => {
    const result = authorizeTrustedProxy({
      remoteAddress: '203.0.113.1',
      getHeader: (name) => (name === 'x-forwarded-user' ? 'alice@example.com' : undefined),
      trustedProxies: ['10.0.0.0/8'],
      trustedProxyConfig,
    });
    expect(result).toEqual({ ok: false, reason: 'trusted_proxy_untrusted_source' });
  });

  it('rejects loopback sources unless allowLoopback is enabled', () => {
    const result = authorizeTrustedProxy({
      remoteAddress: '127.0.0.1',
      getHeader: (name) => (name === 'x-forwarded-user' ? 'alice@example.com' : undefined),
      trustedProxies: ['127.0.0.1'],
      trustedProxyConfig,
    });
    expect(result).toEqual({ ok: false, reason: 'trusted_proxy_loopback_source' });
  });

  it('rejects users outside allowUsers', () => {
    const result = authorizeTrustedProxy({
      remoteAddress: '10.0.0.1',
      getHeader: (name) => (name === 'x-forwarded-user' ? 'bob@example.com' : undefined),
      trustedProxies: ['10.0.0.0/8'],
      trustedProxyConfig,
    });
    expect(result).toEqual({ ok: false, reason: 'trusted_proxy_user_not_allowed' });
  });

  it('requires configured headers', () => {
    const result = authorizeTrustedProxy({
      remoteAddress: '10.0.0.1',
      getHeader: (name) => (name === 'x-forwarded-user' ? 'alice@example.com' : undefined),
      trustedProxies: ['10.0.0.0/8'],
      trustedProxyConfig: {
        ...trustedProxyConfig,
        requiredHeaders: ['x-auth-request-email'],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('trusted_proxy_missing_header_x-auth-request-email');
    }
  });
});
