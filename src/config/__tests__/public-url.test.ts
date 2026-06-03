import { describe, it, expect } from 'vitest';

import {
  isPrivateOrLocalHostname,
  normalizePublicUrlOrNull,
  validatePublicUrl,
} from '../public-url.js';

describe('isPrivateOrLocalHostname', () => {
  it('classifies RFC1918 ranges', () => {
    expect(isPrivateOrLocalHostname('10.0.0.5')).toBe(true);
    expect(isPrivateOrLocalHostname('172.16.0.1')).toBe(true);
    expect(isPrivateOrLocalHostname('172.31.255.255')).toBe(true);
    expect(isPrivateOrLocalHostname('192.168.1.1')).toBe(true);
    expect(isPrivateOrLocalHostname('100.64.0.1')).toBe(true); // CGNAT
  });

  it('classifies loopback / link-local / mDNS', () => {
    expect(isPrivateOrLocalHostname('localhost')).toBe(true);
    expect(isPrivateOrLocalHostname('host.local')).toBe(true);
    expect(isPrivateOrLocalHostname('127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalHostname('::1')).toBe(true);
    expect(isPrivateOrLocalHostname('169.254.1.1')).toBe(true);
  });

  it('rejects public hostnames', () => {
    expect(isPrivateOrLocalHostname('gateway.example.com')).toBe(false);
    expect(isPrivateOrLocalHostname('8.8.8.8')).toBe(false);
    expect(isPrivateOrLocalHostname('172.32.0.1')).toBe(false); // just outside 172.16-31
    expect(isPrivateOrLocalHostname('172.15.0.1')).toBe(false);
    expect(isPrivateOrLocalHostname('11.0.0.1')).toBe(false);
  });
});

describe('validatePublicUrl', () => {
  it('accepts a clean https origin', () => {
    const r = validatePublicUrl('https://gateway.example.com');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.url).toBe('https://gateway.example.com');
      expect(r.protocol).toBe('https:');
    }
  });

  it('accepts https with explicit port', () => {
    const r = validatePublicUrl('https://gateway.example.com:8443');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe('https://gateway.example.com:8443');
  });

  it('normalizes trailing slash and uppercase host', () => {
    const r = validatePublicUrl('https://Gateway.Example.com/');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe('https://gateway.example.com');
  });

  it('rejects http for public hostnames', () => {
    const r = validatePublicUrl('http://gateway.example.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('requires_https');
  });

  it('allows http for RFC1918', () => {
    const r = validatePublicUrl('http://192.168.1.5:18790');
    expect(r.ok).toBe(true);
  });

  it('allows http for .local mDNS', () => {
    const r = validatePublicUrl('http://my-mac.local:18790');
    expect(r.ok).toBe(true);
  });

  it('rejects path-containing URLs', () => {
    const r = validatePublicUrl('https://gateway.example.com/api');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('has_path');
  });

  it('rejects query / fragment', () => {
    expect(validatePublicUrl('https://gateway.example.com?x=1').ok).toBe(false);
    expect(validatePublicUrl('https://gateway.example.com#frag').ok).toBe(false);
  });

  it('rejects userinfo', () => {
    const r = validatePublicUrl('https://user:pass@gateway.example.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('has_userinfo');
  });

  it('rejects invalid URLs', () => {
    expect(validatePublicUrl('').ok).toBe(false);
    expect(validatePublicUrl('not-a-url').ok).toBe(false);
    expect(validatePublicUrl('ftp://gateway.example.com').ok).toBe(false);
  });
});

describe('normalizePublicUrlOrNull', () => {
  it('returns normalized URL for valid input', () => {
    expect(normalizePublicUrlOrNull('https://Gateway.example.com/')).toBe('https://gateway.example.com');
  });
  it('returns null for invalid input', () => {
    expect(normalizePublicUrlOrNull('http://gateway.example.com')).toBeNull();
    expect(normalizePublicUrlOrNull(null)).toBeNull();
    expect(normalizePublicUrlOrNull(undefined)).toBeNull();
  });
});
