import { describe, expect, it, vi } from 'vitest';

import { createBackgroundTask } from '../background-task.js';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('background task', () => {
  it('contains sync and async failures, reports once, and recovers on the next tick', async () => {
    const run = vi.fn()
      .mockImplementationOnce(() => { throw new Error('sync'); })
      .mockRejectedValueOnce(new Error('async'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('after recovery'));
    const report = vi.fn();
    const tick = createBackgroundTask(run, report);
    expect(() => tick()).not.toThrow();
    await flush();
    tick();
    await flush();
    expect(report).toHaveBeenCalledTimes(1);
    tick();
    await flush();
    tick();
    await flush();
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('does not start overlapping ticks', async () => {
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const tick = createBackgroundTask(run, vi.fn());
    tick();
    tick();
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await flush();
    tick();
    expect(run).toHaveBeenCalledTimes(2);
    finish();
    await flush();
  });
});
