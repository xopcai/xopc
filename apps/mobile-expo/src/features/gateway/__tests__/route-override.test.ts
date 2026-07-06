import { afterEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('../../../storage/mmkv', () => ({
  KEYS: { routeOverridePrefix: 'gateway.routeOverride:' },
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
  __resetRouteOverrideListenersForTests,
  readRouteOverride,
  subscribeRouteOverride,
  writeRouteOverride,
} from '../route-override';

afterEach(() => {
  memory.clear();
  __resetRouteOverrideListenersForTests();
});

describe('route-override', () => {
  it('defaults to auto when no value is stored', () => {
    expect(readRouteOverride('p1')).toBe('auto');
  });

  it('round-trips lan and tunnel selections', () => {
    writeRouteOverride('p1', 'lan');
    expect(readRouteOverride('p1')).toBe('lan');
    writeRouteOverride('p1', 'tunnel');
    expect(readRouteOverride('p1')).toBe('tunnel');
  });

  it('clears the entry when set back to auto so storage stays bounded', () => {
    writeRouteOverride('p1', 'lan');
    writeRouteOverride('p1', 'auto');
    expect(memory.size).toBe(0);
    expect(readRouteOverride('p1')).toBe('auto');
  });

  it('falls back to auto for malformed values', () => {
    memory.set('gateway.routeOverride:p1', 'mars');
    expect(readRouteOverride('p1')).toBe('auto');
  });

  it('notifies subscribers on every change', () => {
    const cb = vi.fn();
    const unsub = subscribeRouteOverride(cb);
    writeRouteOverride('p1', 'lan');
    writeRouteOverride('p1', 'tunnel');
    writeRouteOverride('p1', 'auto');
    unsub();
    expect(cb).toHaveBeenCalledTimes(3);
    expect(cb.mock.calls.map((c) => c[1])).toEqual(['lan', 'tunnel', 'auto']);
  });

  it('keeps separate values per profile', () => {
    writeRouteOverride('p1', 'lan');
    writeRouteOverride('p2', 'tunnel');
    expect(readRouteOverride('p1')).toBe('lan');
    expect(readRouteOverride('p2')).toBe('tunnel');
  });
});
