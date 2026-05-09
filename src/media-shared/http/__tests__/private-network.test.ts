import { describe, expect, it } from 'vitest';

import {
  BlockedPrivateNetworkError,
  assertNotPrivateNetwork,
  classifyHost,
} from '../private-network.js';

describe('classifyHost', () => {
  it.each([
    ['example.com', 'public'],
    ['8.8.8.8', 'public'],
    ['127.0.0.1', 'loopback'],
    ['10.0.0.1', 'private'],
    ['192.168.1.1', 'private'],
    ['172.16.0.1', 'private'],
    ['169.254.1.1', 'link-local'],
    ['0.0.0.0', 'invalid'],
    ['::1', 'loopback'],
    ['fe80::1', 'link-local'],
    ['fd00::1', 'private'],
  ])('%s → %s', (host, expected) => {
    expect(classifyHost(host)).toBe(expected);
  });
});

describe('assertNotPrivateNetwork', () => {
  const strict = { allowLoopback: false, allowPrivate: false };

  it('blocks loopback and private IPs by default policy object', () => {
    expect(() => assertNotPrivateNetwork('http://127.0.0.1:8080/x', strict)).toThrow(BlockedPrivateNetworkError);
    expect(() => assertNotPrivateNetwork('http://10.0.0.5/x', strict)).toThrow(BlockedPrivateNetworkError);
  });

  it('blocks unsupported schemes', () => {
    expect(() => assertNotPrivateNetwork('file:///etc/passwd', strict)).toThrow(BlockedPrivateNetworkError);
    expect(() => assertNotPrivateNetwork('ftp://example.com/x', strict)).toThrow(BlockedPrivateNetworkError);
  });

  it('allows public hosts', () => {
    expect(() => assertNotPrivateNetwork('https://example.com/path', strict)).not.toThrow();
  });

  it('rejects invalid URLs', () => {
    expect(() => assertNotPrivateNetwork('not-a-url', strict)).toThrow(BlockedPrivateNetworkError);
  });
});
