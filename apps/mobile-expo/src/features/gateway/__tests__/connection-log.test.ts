import { afterEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('../../../storage/mmkv', () => ({
  KEYS: {},
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
  __resetConnectionLogForTests,
  clearConnectionEvents,
  readConnectionEvents,
  recordConnectionEvent,
  subscribeConnectionEvents,
} from '../connection-log';

afterEach(() => {
  __resetConnectionLogForTests();
  memory.clear();
});

describe('connection-log', () => {
  it('records events and returns them in chronological order', () => {
    recordConnectionEvent({ kind: 'realtime', ok: true });
    recordConnectionEvent({ kind: 'apiFetch', ok: false, reason: 'no-route' });

    const events = readConnectionEvents();
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe('realtime');
    expect(events[1].reason).toBe('no-route');
    expect(events[0].at).toBeLessThanOrEqual(events[1].at);
  });

  it('caps the buffer at MAX_EVENTS so storage never grows unbounded', () => {
    for (let i = 0; i < 150; i++) {
      recordConnectionEvent({ kind: 'apiFetch', ok: i % 2 === 0 });
    }
    expect(readConnectionEvents().length).toBeLessThanOrEqual(100);
  });

  it('notifies subscribers on every record and clear', () => {
    const fn = vi.fn();
    const unsub = subscribeConnectionEvents(fn);
    recordConnectionEvent({ kind: 'realtime', ok: true });
    recordConnectionEvent({ kind: 'realtime', ok: false, message: 'boom' });
    clearConnectionEvents();
    unsub();
    expect(fn).toHaveBeenCalled();
    const lastCall = fn.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual([]);
  });
});
