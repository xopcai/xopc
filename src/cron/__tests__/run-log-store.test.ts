import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CronRunLogStore } from '../run-log-store.js';
import type { JobExecution } from '../types.js';

describe('CronRunLogStore', () => {
  let dir: string;
  let store: CronRunLogStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cron-runs-'));
    store = new CronRunLogStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends completed runs and reads per-job history', async () => {
    const j1 = 'job-a';
    const ex1: JobExecution = {
      id: 'e1',
      jobId: j1,
      status: 'success',
      startedAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
      endedAt: new Date('2025-01-01T00:00:01.000Z').toISOString(),
      duration: 1000,
      retryCount: 0,
      summary: 'ok',
    };
    await store.appendCompleted(ex1);

    const hist = await store.readJobHistory(j1, 10);
    expect(hist).toHaveLength(1);
    expect(hist[0].id).toBe('e1');
    expect(hist[0].summary).toBe('ok');
  });

  it('does not persist running status', async () => {
    const ex: JobExecution = {
      id: 'r1',
      jobId: 'j',
      status: 'running',
      startedAt: new Date().toISOString(),
      retryCount: 0,
    };
    await store.appendCompleted(ex);
    const hist = await store.readJobHistory('j', 10);
    expect(hist).toHaveLength(0);
  });

  it('readAllRuns merges jobs and attaches names', async () => {
    const names = new Map<string, string | undefined>([
      ['a', 'Task A'],
      ['b', undefined],
    ]);
    await store.appendCompleted({
      id: '1',
      jobId: 'a',
      status: 'failed',
      startedAt: '2025-06-01T12:00:00.000Z',
      endedAt: '2025-06-01T12:00:02.000Z',
      duration: 2000,
      retryCount: 0,
      error: 'boom',
    });
    await store.appendCompleted({
      id: '2',
      jobId: 'b',
      status: 'success',
      startedAt: '2025-06-02T12:00:00.000Z',
      endedAt: '2025-06-02T12:00:01.000Z',
      duration: 1000,
      retryCount: 0,
    });

    const all = await store.readAllRuns(10, names);
    expect(all).toHaveLength(2);
    expect(all[0].startedAt > all[1].startedAt).toBe(true);
    const bRow = all.find((r) => r.jobId === 'b');
    expect(bRow?.jobName).toBeUndefined();
    const aRow = all.find((r) => r.jobId === 'a');
    expect(aRow?.jobName).toBe('Task A');
  });
});
