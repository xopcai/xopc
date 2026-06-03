import { describe, it, expect } from 'vitest';

import { checkBrowserOrigin } from '../origin-check.js';

describe('checkBrowserOrigin — allowlist & host-header fallback', () => {
  it('allows when Origin exactly matches an allowlisted entry', () => {
    const result = checkBrowserOrigin({
      requestHost: 'gateway.example.com',
      origin: 'https://gateway.example.com',
      allowedOrigins: ['https://gateway.example.com'],
    });
    expect(result).toEqual({ ok: true, matchedBy: 'allowlist' });
  });

  it('rejects when Origin is not in the allowlist and no fallbacks enabled', () => {
    const result = checkBrowserOrigin({
      requestHost: 'gateway.example.com',
      origin: 'https://evil.example.com',
      allowedOrigins: ['https://gateway.example.com'],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an empty / null Origin string', () => {
    expect(checkBrowserOrigin({ origin: '' }).ok).toBe(false);
    expect(checkBrowserOrigin({ origin: 'null' }).ok).toBe(false);
    expect(checkBrowserOrigin({ origin: 'not-a-url' }).ok).toBe(false);
  });
});

describe('checkBrowserOrigin — autoAllowSameHostFromTrustedProxy', () => {
  it('allows Origin === scheme://Host when caller asserts trusted proxy', () => {
    const result = checkBrowserOrigin({
      requestHost: 'gateway.example.com',
      origin: 'https://gateway.example.com',
      allowedOrigins: [],
      autoAllowSameHostFromTrustedProxy: true,
    });
    expect(result).toEqual({ ok: true, matchedBy: 'trusted-proxy-same-host' });
  });

  it('allows Origin === Host with explicit port', () => {
    const result = checkBrowserOrigin({
      requestHost: 'gateway.example.com:8443',
      origin: 'https://gateway.example.com:8443',
      allowedOrigins: [],
      autoAllowSameHostFromTrustedProxy: true,
    });
    expect(result.ok).toBe(true);
  });

  it('REJECTS when caller does not assert trusted proxy, even if Origin matches Host', () => {
    const result = checkBrowserOrigin({
      requestHost: 'gateway.example.com',
      origin: 'https://gateway.example.com',
      allowedOrigins: [],
      autoAllowSameHostFromTrustedProxy: false,
    });
    expect(result.ok).toBe(false);
  });

  it('REJECTS when Origin host differs from Host even when trusted-proxy hop', () => {
    // Attacker controls Origin (e.g. via XSS on a third-party page) but the
    // request goes through the same trusted reverse proxy. The same-host
    // bypass must NOT kick in because Origin !== Host.
    const result = checkBrowserOrigin({
      requestHost: 'gateway.example.com',
      origin: 'https://evil.example.com',
      allowedOrigins: [],
      autoAllowSameHostFromTrustedProxy: true,
    });
    expect(result.ok).toBe(false);
  });

  it('REJECTS when Host header is missing even with trusted proxy', () => {
    const result = checkBrowserOrigin({
      requestHost: undefined,
      origin: 'https://gateway.example.com',
      allowedOrigins: [],
      autoAllowSameHostFromTrustedProxy: true,
    });
    expect(result.ok).toBe(false);
  });

  it('REJECTS Origin host part not matching when port differs', () => {
    const result = checkBrowserOrigin({
      requestHost: 'gateway.example.com:8443',
      origin: 'https://gateway.example.com:443',
      allowedOrigins: [],
      autoAllowSameHostFromTrustedProxy: true,
    });
    expect(result.ok).toBe(false);
  });

  it('still prefers allowlist match over same-host fallback', () => {
    const result = checkBrowserOrigin({
      requestHost: 'gateway.example.com',
      origin: 'https://gateway.example.com',
      allowedOrigins: ['https://gateway.example.com'],
      autoAllowSameHostFromTrustedProxy: true,
    });
    expect(result).toEqual({ ok: true, matchedBy: 'allowlist' });
  });
});

describe('checkBrowserOrigin — interaction with legacy host-header fallback', () => {
  it('autoAllowSameHostFromTrustedProxy takes effect even if dangerously-allow flag is off', () => {
    const result = checkBrowserOrigin({
      requestHost: 'gateway.example.com',
      origin: 'https://gateway.example.com',
      allowedOrigins: [],
      allowHostHeaderOriginFallback: false,
      autoAllowSameHostFromTrustedProxy: true,
    });
    expect(result.ok).toBe(true);
  });

  it('does NOT bypass dangerously-allow flag from untrusted source', () => {
    const result = checkBrowserOrigin({
      requestHost: 'gateway.example.com',
      origin: 'https://gateway.example.com',
      allowedOrigins: [],
      allowHostHeaderOriginFallback: false,
      autoAllowSameHostFromTrustedProxy: false,
    });
    expect(result.ok).toBe(false);
  });
});
