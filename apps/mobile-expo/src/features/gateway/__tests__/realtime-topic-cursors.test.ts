import { describe, expect, it } from 'vitest';

import { RealtimeTopicCursorStore } from '../realtime-topic-cursors';

describe('RealtimeTopicCursorStore', () => {
  it('keeps the latest cursor while the same gateway swaps routes', () => {
    const store = new RealtimeTopicCursorStore();
    store.activateScope('gateway-a');
    store.set('run:1', 3);
    store.advance('run:1', 8);
    store.advance('run:1', 5);

    store.activateScope('gateway-a');

    expect(store.read('run:1')).toBe(8);
  });

  it('does not carry broker sequence numbers into another gateway', () => {
    const store = new RealtimeTopicCursorStore();
    store.activateScope('gateway-a');
    store.advance('sessions', 42);

    store.activateScope('gateway-b');

    expect(store.read('sessions')).toBeUndefined();
  });

  it('rewinds to the earliest retained event after a replay gap', () => {
    const store = new RealtimeTopicCursorStore();
    store.activateScope('gateway-a');
    store.advance('run:1', 100);

    store.resetForGap('run:1', 12);

    expect(store.read('run:1')).toBe(11);
  });
});
