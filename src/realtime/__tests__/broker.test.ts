import { describe, expect, it, vi } from 'vitest';

import { RealtimeBroker } from '../broker.js';

describe('RealtimeBroker', () => {
  it('multicasts one ordered event to every subscriber', () => {
    const broker = new RealtimeBroker();
    const left = vi.fn();
    const right = vi.fn();
    broker.subscribe('run:r1', undefined, left);
    broker.subscribe('run:r1', undefined, right);

    const event = broker.publish('run:r1', 'assistant.delta', { delta: 'hi' });

    expect(event.payload.seq).toBe(1);
    expect(left).toHaveBeenCalledWith(event);
    expect(right).toHaveBeenCalledWith(event);
  });

  it('isolates subscriber failures', () => {
    const onListenerError = vi.fn();
    const broker = new RealtimeBroker(undefined, onListenerError);
    const healthy = vi.fn();
    broker.subscribe('run:r1', undefined, () => {
      throw new Error('closed');
    });
    broker.subscribe('run:r1', undefined, healthy);

    const event = broker.publish('run:r1', 'assistant.delta', {});

    expect(onListenerError).toHaveBeenCalledWith(expect.any(Error), 'run:r1');
    expect(healthy).toHaveBeenCalledWith(event);
  });

  it('validates server-authored topics and event names', () => {
    const broker = new RealtimeBroker();
    expect(() => broker.publish('', 'config.reload', {})).toThrow();
    expect(() => broker.publish('gateway', 'INVALID EVENT', {})).toThrow();
  });

  it('replays events strictly after the supplied cursor', () => {
    const broker = new RealtimeBroker();
    broker.publish('run:r1', 'run.start', {});
    broker.publish('run:r1', 'assistant.delta', { delta: 'a' });
    broker.publish('run:r1', 'assistant.delta', { delta: 'b' });

    const sub = broker.subscribe('run:r1', 1, vi.fn());

    expect(sub.initial.map((event) => event.kind === 'realtime.event' ? event.payload.seq : -1)).toEqual([2, 3]);
  });

  it('reports a gap instead of silently skipping compacted events', () => {
    const broker = new RealtimeBroker(() => ({ replayCapacity: 2 }));
    broker.publish('run:r1', 'assistant.delta', { delta: 'a' });
    broker.publish('run:r1', 'assistant.delta', { delta: 'b' });
    broker.publish('run:r1', 'assistant.delta', { delta: 'c' });

    const sub = broker.subscribe('run:r1', 0, vi.fn());

    expect(sub.initial[0]).toMatchObject({
      kind: 'realtime.gap',
      payload: { requestedSeq: 0, earliestSeq: 2 },
    });
    expect(sub.initial.slice(1).map((event) => event.kind === 'realtime.event' ? event.payload.seq : -1)).toEqual([2, 3]);
  });

  it('replays gateway broadcasts after reconnect', () => {
    const broker = new RealtimeBroker();
    broker.publish('gateway', 'config.reload', {});

    const sub = broker.subscribe('gateway', 0, vi.fn());

    expect(sub.initial).toMatchObject([{ kind: 'realtime.event', payload: { seq: 1 } }]);
  });

  it('reports a gap when a cursor belongs to an earlier gateway process', () => {
    const broker = new RealtimeBroker();

    const sub = broker.subscribe('gateway', 42, vi.fn());

    expect(sub.cursor).toBe(0);
    expect(sub.initial).toMatchObject([{
      kind: 'realtime.gap',
      payload: { requestedSeq: 42, earliestSeq: 1 },
    }]);
  });
});
