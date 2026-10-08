import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IdleCompactionScheduler } from '../idle-compaction-scheduler.js';

const options = { idleMs: 1000, cooldownMs: 5000, timeoutMs: 3000 };
let scheduler: IdleCompactionScheduler;
function schedule(id: string, job: Parameters<IdleCompactionScheduler['endTurn']>[2]) {
  const generation = scheduler.beginTurn(id);
  scheduler.endTurn(id, generation, job, options);
}
beforeEach(() => { vi.useFakeTimers(); scheduler = new IdleCompactionScheduler(); });
afterEach(() => { scheduler.dispose(); vi.useRealTimers(); });

describe('idle compaction scheduling', () => {
  it('waits for idle and invalidates a provider that ignores cancellation', async () => {
    let resolve!: () => void;
    let mayCommit = true;
    const job = vi.fn(async (_signal, isCurrent) => {
      await new Promise<void>(r => { resolve = r; });
      mayCommit = isCurrent();
      return mayCommit ? 'committed' as const : 'stale' as const;
    });
    schedule('a', job);
    await vi.advanceTimersByTimeAsync(999);
    expect(job).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const generation = scheduler.beginTurn('a');
    expect(job.mock.calls[0]![0].aborted).toBe(true);
    scheduler.endTurn('a', generation);
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(mayCommit).toBe(false);
    expect(scheduler.getMetrics()).toMatchObject({ cancelled: 1, stale: 1 });
  });

  it('serializes background work across conversations and defers work after success', async () => {
    let release!: () => void;
    schedule('a', async () => { await new Promise<void>(r => { release = r; }); return 'committed'; });
    const second = vi.fn(async () => 'committed' as const);
    schedule('b', second);
    await vi.advanceTimersByTimeAsync(1000);
    expect(second).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(second).toHaveBeenCalledTimes(1);
    schedule('b', second);
    await vi.advanceTimersByTimeAsync(4999);
    expect(second).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('times out ignored requests without allowing late commits or overlapping provider requests', async () => {
    let release!: () => void;
    let valid = true;
    schedule('a', async (_signal, isCurrent) => {
      await new Promise<void>(r => { release = r; });
      valid = isCurrent();
      return 'stale';
    });
    const second = vi.fn(async () => 'committed' as const);
    schedule('b', second);
    await vi.advanceTimersByTimeAsync(4000);
    expect(second).not.toHaveBeenCalled();
    const generation = scheduler.beginTurn('a');
    scheduler.endTurn('a', generation);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(valid).toBe(false);
    expect(second).toHaveBeenCalledOnce();
    expect(scheduler.getMetrics().failed).toBe(1);
  });

  it('cancels configuration-era work while retaining the single provider slot', async () => {
    let release!: () => void;
    let valid = true;
    schedule('a', async (_signal, isCurrent) => {
      await new Promise<void>(r => { release = r; });
      valid = isCurrent();
      return 'stale';
    });
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.cancelAll();
    const next = vi.fn(async () => 'committed' as const);
    schedule('b', next);
    await vi.advanceTimersByTimeAsync(1000);
    expect(next).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(valid).toBe(false);
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not schedule an old turn after a queued input, or after disposal', async () => {
    const job = vi.fn(async () => 'committed' as const);
    const generation = scheduler.beginTurn('a');
    scheduler.interrupt('a');
    scheduler.endTurn('a', generation, job, options);
    await vi.advanceTimersByTimeAsync(1000);
    expect(job).not.toHaveBeenCalled();
    schedule('a', job);
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(10000);
    expect(job).not.toHaveBeenCalled();
  });
});
