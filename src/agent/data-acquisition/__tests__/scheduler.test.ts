import { expect, it } from 'vitest';
import { DataScheduler } from '../scheduler.js';

it('bounds work across batches, releases failed permits and cancels queued work', async () => {
  const scheduler = new DataScheduler(2, 1);
  const started: string[] = [];
  let release!: () => void;
  const first = scheduler.run('workspace-a', undefined, async () => {
    started.push('first');
    await new Promise<void>(resolve => { release = resolve; });
    throw new Error('failed');
  });
  const failure = expect(first).rejects.toThrow('failed');
  const abort = new AbortController();
  const cancelled = scheduler.run('workspace-a', abort.signal, async () => { started.push('cancelled'); });
  const cancellation = expect(cancelled).rejects.toThrow();
  const other = scheduler.run('workspace-b', undefined, async () => { started.push('other'); });
  await other;
  expect(started).toEqual(['first', 'other']);
  abort.abort();
  release();
  await Promise.all([failure, cancellation]);
  await scheduler.run('workspace-a', undefined, async () => { started.push('last'); });
  expect(started).toEqual(['first', 'other', 'last']);
});
