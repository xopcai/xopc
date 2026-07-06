import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('../../../storage/mmkv', () => ({
  KEYS: { queryCachePrefix: 'gateway.queryCache:' },
  storage: {
    getString: (k: string) => memory.get(k),
    set: (k: string, v: string | number | boolean) => {
      memory.set(k, String(v));
    },
    delete: (k: string) => {
      memory.delete(k);
    },
  },
}));

import {
  clearQueryCache,
  readQueryCache,
  writeQueryCache,
} from '../query-cache';

beforeEach(() => {
  memory.clear();
});

describe('generic query-cache', () => {
  it('round-trips a JSON payload', () => {
    writeQueryCache('sessions', 'p1', undefined, [{ id: 'a' }, { id: 'b' }]);
    expect(readQueryCache<{ id: string }[]>('sessions', 'p1')).toEqual([
      { id: 'a' },
      { id: 'b' },
    ]);
  });

  it('keeps entries scoped per profile', () => {
    writeQueryCache('sessions', 'p1', undefined, ['x']);
    writeQueryCache('sessions', 'p2', undefined, ['y']);
    expect(readQueryCache('sessions', 'p1')).toEqual(['x']);
    expect(readQueryCache('sessions', 'p2')).toEqual(['y']);
  });

  it('keeps entries scoped per scope key', () => {
    writeQueryCache('detail', 'p1', 'session-a', { msg: 'a' });
    writeQueryCache('detail', 'p1', 'session-b', { msg: 'b' });
    expect(readQueryCache('detail', 'p1', 'session-a')).toEqual({ msg: 'a' });
    expect(readQueryCache('detail', 'p1', 'session-b')).toEqual({ msg: 'b' });
  });

  it('returns null for entries past the TTL', () => {
    writeQueryCache('sessions', 'p1', undefined, ['stale']);
    // Forge an old recordedAt
    const key = 'gateway.queryCache:sessions:p1';
    const stale = JSON.stringify({ recordedAt: Date.now() - 24 * 60 * 60 * 1000, data: ['stale'] });
    memory.set(key, stale);
    expect(readQueryCache('sessions', 'p1')).toBeNull();
  });

  it('returns null for malformed payloads', () => {
    memory.set('gateway.queryCache:sessions:p1', '{not valid');
    expect(readQueryCache('sessions', 'p1')).toBeNull();
  });

  it('returns null when profileId is missing', () => {
    writeQueryCache('sessions', '', undefined, ['x']); // no-op
    expect(readQueryCache('sessions', '')).toBeNull();
    expect(readQueryCache('sessions', null)).toBeNull();
  });

  it('clears specific scoped entries', () => {
    writeQueryCache('detail', 'p1', 'session-a', { msg: 'a' });
    writeQueryCache('detail', 'p1', 'session-b', { msg: 'b' });
    clearQueryCache('detail', 'p1', 'session-a');
    expect(readQueryCache('detail', 'p1', 'session-a')).toBeNull();
    expect(readQueryCache('detail', 'p1', 'session-b')).toEqual({ msg: 'b' });
  });
});
