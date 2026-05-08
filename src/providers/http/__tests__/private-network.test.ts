import { describe, expect, it } from 'vitest';

import {
  BlockedPrivateNetworkError,
  assertNotPrivateNetwork,
  classifyHost,
} from '../private-network.js';

describe('classifyHost', () => {
  it.each([
    ['8.8.8.8', 'public'],
    ['1.1.1.1', 'public'],
    ['127.0.0.1', 'loopback'],
    ['127.5.6.7', 'loopback'],
    ['10.0.0.5', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.254', 'private'],
    ['172.15.0.1', 'public'],
    ['172.32.0.1', 'public'],
    ['192.168.1.1', 'private'],
    ['169.254.169.254', 'link-local'],
    ['100.64.0.1', 'private'],
    ['100.127.255.254', 'private'],
    ['100.128.0.1', 'public'],
    ['0.0.0.0', 'invalid'],
    ['256.256.256.256', 'public'], // not a parseable v4 → falls back to hostname (treated public)
    ['localhost', 'loopback'],
    ['svc.localhost', 'loopback'],
    ['example.com', 'public'],
    ['::1', 'loopback'],
    ['fe80::1', 'link-local'],
    ['fd12:3456::1', 'private'],
    ['fc00::1', 'private'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:8.8.8.8', 'public'],
    ['::', 'invalid'],
  ])('%s → %s', (host, expected) => {
    expect(classifyHost(host)).toBe(expected);
  });
});

describe('assertNotPrivateNetwork', () => {
  // Tests run with NODE_ENV=test → loopback allowed by default policy.
  // Force a strict policy to validate blocking.
  const strict = { allowLoopback: false, allowPrivate: false };

  it('allows public hosts', () => {
    expect(() => assertNotPrivateNetwork('https://api.openai.com/v1', strict)).not.toThrow();
  });

  it('blocks loopback under strict policy', () => {
    expect(() => assertNotPrivateNetwork('http://127.0.0.1:8080/x', strict)).toThrow(BlockedPrivateNetworkError);
  });

  it('blocks RFC1918', () => {
    expect(() => assertNotPrivateNetwork('http://10.0.0.5/x', strict)).toThrow(BlockedPrivateNetworkError);
  });

  it('blocks AWS metadata service', () => {
    expect(() => assertNotPrivateNetwork('http://169.254.169.254/latest/meta-data/', strict)).toThrow(
      BlockedPrivateNetworkError,
    );
  });

  it('rejects unsupported protocols', () => {
    expect(() => assertNotPrivateNetwork('file:///etc/passwd', strict)).toThrow(BlockedPrivateNetworkError);
    expect(() => assertNotPrivateNetwork('ftp://example.com/x', strict)).toThrow(BlockedPrivateNetworkError);
  });

  it('honours allowHosts allowlist', () => {
    expect(() =>
      assertNotPrivateNetwork('http://localhost:11434/api', { ...strict, allowHosts: ['localhost'] }),
    ).not.toThrow();
  });

  it('rejects malformed URLs', () => {
    expect(() => assertNotPrivateNetwork('not-a-url', strict)).toThrow(BlockedPrivateNetworkError);
  });
});
