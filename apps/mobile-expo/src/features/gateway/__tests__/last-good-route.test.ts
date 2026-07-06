import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('../../../storage/mmkv', () => ({
  KEYS: {
    routeWinnerPrefix: 'gateway.routeWinner:',
  },
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string | number | boolean) => {
      memory.set(key, String(value));
    },
    delete: (key: string) => {
      memory.delete(key);
    },
  },
}));

import {
  __INTERNAL,
  clearLastGoodRoute,
  readAnyNetworkLastGoodRoute,
  readLastGoodRoute,
  writeLastGoodRoute,
} from '../last-good-route';

describe('last-good-route cache', () => {
  beforeEach(() => {
    memory.clear();
  });

  it('round-trips a write and read for the same network', () => {
    writeLastGoodRoute('p1', 'wifi:abc', {
      url: 'http://192.168.1.10:18790',
      kind: 'lan',
      latencyMs: 87,
    });

    const entry = readLastGoodRoute('p1', 'wifi:abc');
    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe('lan');
    expect(entry?.url).toBe('http://192.168.1.10:18790');
    expect(entry?.latencyMs).toBe(87);
    expect(entry?.networkKey).toBe('wifi:abc');
  });

  it('writes the any-network fallback so hydrate can read without a network key', () => {
    writeLastGoodRoute('p1', 'wifi:abc', { url: 'https://gw.example.com', kind: 'tunnel' });
    const fallback = readAnyNetworkLastGoodRoute('p1');
    expect(fallback?.url).toBe('https://gw.example.com');
    expect(fallback?.kind).toBe('tunnel');
  });

  it('returns null for stale entries past MAX_AGE_MS', () => {
    writeLastGoodRoute('p1', 'wifi:abc', { url: 'http://lan', kind: 'lan' });
    // Forge a stale recordedAt timestamp.
    const stale = JSON.stringify({
      url: 'http://lan',
      kind: 'lan',
      recordedAt: Date.now() - __INTERNAL.MAX_AGE_MS - 1000,
      networkKey: 'wifi:abc',
    });
    memory.set('gateway.routeWinner:p1:wifi:abc', stale);

    expect(readLastGoodRoute('p1', 'wifi:abc')).toBeNull();
  });

  it('returns null for malformed entries', () => {
    memory.set('gateway.routeWinner:p1:wifi:abc', 'not json');
    expect(readLastGoodRoute('p1', 'wifi:abc')).toBeNull();
  });

  it('clears entries by network or any-network', () => {
    writeLastGoodRoute('p1', 'wifi:abc', { url: 'http://lan', kind: 'lan' });
    clearLastGoodRoute('p1', 'wifi:abc');
    expect(readLastGoodRoute('p1', 'wifi:abc')).toBeNull();
    // any-network entry remains
    expect(readAnyNetworkLastGoodRoute('p1')).not.toBeNull();
    clearLastGoodRoute('p1');
    expect(readAnyNetworkLastGoodRoute('p1')).toBeNull();
  });
});
