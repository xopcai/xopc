import { describe, expect, it } from 'vitest';

import { SessionLoadQueue } from '../session/session-load-queue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

describe('session load performance contract', () => {
  it('starts the selected session without waiting for an unrelated slow request', async () => {
    const queue = new SessionLoadQueue();
    const slow = deferred();
    const first = queue.run('A', () => slow.promise);
    // Awaiting B while A is unresolved is a deterministic head-of-line blocking guard.
    expect(await queue.run('B', async () => 'visible')).toBe('visible');
    slow.resolve();
    await first;
  });

  it('preserves order within a session, including after a failed request', async () => {
    const queue = new SessionLoadQueue();
    const slow = deferred();
    const events: number[] = [];
    const first = queue.run('A', async () => { events.push(1); await slow.promise; throw new Error('offline'); });
    const failure = expect(first).rejects.toThrow('offline');
    const second = queue.run('A', async () => { events.push(2); });
    await Promise.resolve();
    expect(events).toEqual([1]);
    slow.resolve();
    await failure;
    await second;
    expect(events).toEqual([1, 2]);
    await queue.run('A', async () => { events.push(3); });
    expect(events).toEqual([1, 2, 3]);
  });
});
