import { describe, expect, it } from 'vitest';
import { TaskScheduler } from '../packages/runner/src/scheduler.js';
import { RequestPool } from '../../control/request-pool.js';
import { validatePlan } from '../../control/campaign.js';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
describe('bounded execution', () => {
  it('runs independent jobs concurrently, preserves result order and serializes shared resources', async () => {
    let active = 0; let peak = 0; let exclusive = 0;
    const scheduler = new TaskScheduler(4);
    const results = await scheduler.run(Array.from({ length: 8 }, (_, i) => ({ id: String(i), ...(i < 3 ? { resource: 'desktop' } : {}), run: async () => {
      active++; peak = Math.max(peak, active);
      if (i < 3) { expect(exclusive).toBe(0); exclusive++; }
      await delay(20);
      if (i < 3) exclusive--;
      active--; return i;
    } })));
    expect(peak).toBe(4); expect(active).toBe(0);
    expect(results).toEqual(Array.from({ length: 8 }, (_, i) => ({ status: 'fulfilled', value: i })));
  });

  it('pauses admission, resumes, and drains cancellation without releasing active work early', async () => {
    const scheduler = new TaskScheduler(1); let started = 0;
    scheduler.pause();
    const work = scheduler.run(Array.from({ length: 3 }, (_, i) => ({ id: String(i), run: async signal => { started++; await delay(30); return signal.aborted; } })));
    await delay(10); expect(started).toBe(0);
    scheduler.resume(); await delay(10); expect(started).toBe(1);
    scheduler.cancel(); const results = await work;
    expect(results[0]).toEqual({ status: 'fulfilled', value: true });
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(2); expect(started).toBe(1);
  });

  it('does not leak queued leases on cancellation and enforces parent as well as role limits', async () => {
    const pool = new RequestPool({ generation: 4, judge: 4 }, 2);
    const signal = new AbortController();
    const a = await pool.acquire('generation', signal.signal);
    const b = await pool.acquire('judge', signal.signal);
    const cancel = new AbortController();
    const waiting = pool.acquire('generation', cancel.signal);
    expect(pool.snapshot()).toMatchObject({ active: 2, queued: 1 });
    cancel.abort(); await expect(waiting).rejects.toThrow('cancelled');
    pool.release(a, true); pool.release(b);
    expect(pool.snapshot()).toMatchObject({ active: 0, queued: 0, targets: { generation: 2, judge: 4 }, peaks: { total: 2 } });
    expect(() => pool.release(a)).toThrow('Unknown'); pool.close();
  });

  it('retains admission failures and continues other jobs', async () => {
    const results = await new TaskScheduler(2).run([{ id: 'bad', run: async () => { throw Error('broken'); } }, { id: 'good', run: async () => 42 }]);
    expect(results[0]!.status).toBe('rejected'); expect(results[1]).toEqual({ status: 'fulfilled', value: 42 });
  });

  it('stops queued admission when the shared physical-request budget is exhausted', async () => {
    const pool = new RequestPool({ generation: 4 }, 1, () => {}, 1);
    const controller = new AbortController();
    const first = await pool.acquire('generation', controller.signal);
    await expect(pool.acquire('generation', controller.signal)).rejects.toThrow('exhausted');
    pool.release(first);
    expect(pool.snapshot()).toMatchObject({ admitted: 1, active: 0, queued: 0 });
    pool.close();
  });

  it('refuses cyclic and unbounded plans', () => {
    expect(() => validatePlan({ id: 'a', concurrency: 0, maxWallMs: 5000, jobs: [] })).toThrow();
    expect(() => validatePlan({ id: 'a', concurrency: 2, maxWallMs: 5000, jobs: [
      { id: 'one', args: ['test'], timeoutMs: 100, dependsOn: ['two'] }, { id: 'two', args: ['test'], timeoutMs: 100, dependsOn: ['one'] },
    ] })).toThrow('Cyclic');
  });
});
