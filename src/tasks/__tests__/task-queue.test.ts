import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { TaskRunner, type TaskQueueItem } from '../task-queue.js';
import { TaskRepository } from '../task-repository.js';

describe('TaskRunner scheduling', () => {
  let stateDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-queue-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('keeps a planned recheck distinct from retries and runs only when due', async () => {
    const task = new TaskRepository().create({ objective: 'Recheck external state' });
    const runTurn = vi.fn(async () => undefined);
    const runner = new TaskRunner({
      ensureSession: async () => 'agent:main:webchat:default:direct:scheduled',
      hasActiveRun: () => false,
      runTurn,
    });
    const notBefore = Date.now() + 10 * 60_000;

    const scheduled = runner.enqueue(task.id, {
      notBefore,
      source: 'system',
      executionContext: { triggerKind: 'schedule', strategy: 'recheck_external_state' },
    });

    expect(scheduled).toMatchObject({ status: 'scheduled', nextRunAt: notBefore, attempts: 0 });
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(runTurn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runTurn).toHaveBeenCalledOnce();
    expect(runner.snapshot().find((item: TaskQueueItem) => item.id === scheduled.id)?.status).toBe('succeeded');
  });

  it('lets a user-triggered action bring a scheduled recheck forward', async () => {
    const task = new TaskRepository().create({ objective: 'Check now' });
    const runTurn = vi.fn(async () => undefined);
    const runner = new TaskRunner({
      ensureSession: async () => 'agent:main:webchat:default:direct:expedited',
      hasActiveRun: () => false,
      runTurn,
    });
    const scheduled = runner.enqueue(task.id, { notBefore: Date.now() + 60 * 60_000, source: 'system' });

    const expedited = runner.enqueue(task.id, {
      source: 'api',
      executionContext: { triggerKind: 'user' },
    });
    expect(expedited).toMatchObject({ id: scheduled.id, status: 'queued' });
    expect(expedited).not.toHaveProperty('nextRunAt');
    await vi.advanceTimersByTimeAsync(0);
    expect(runTurn).toHaveBeenCalledOnce();
  });

  it('does not execute a scheduled item after the task is paused', async () => {
    const tasks = new TaskRepository();
    const task = tasks.create({ objective: 'Stay paused' });
    const runTurn = vi.fn(async () => undefined);
    const runner = new TaskRunner({
      ensureSession: async () => 'agent:main:webchat:default:direct:paused',
      hasActiveRun: () => false,
      runTurn,
    });
    const scheduled = runner.enqueue(task.id, { notBefore: Date.now() + 10 * 60_000, source: 'system' });
    tasks.update(task.id, { status: 'paused' });

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(runTurn).not.toHaveBeenCalled();
    expect(runner.snapshot().find((item) => item.id === scheduled.id)?.status).toBe('skipped');
  });

  it('waits for execution capacity without repeatedly polling an overdue item', async () => {
    const tasks = new TaskRepository();
    const first = tasks.create({ objective: 'Run first' });
    const second = tasks.create({ objective: 'Run after capacity is free' });
    let releaseFirst: (() => void) | undefined;
    const firstRun = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const runTurn = vi.fn()
      .mockImplementationOnce(() => firstRun)
      .mockResolvedValue(undefined);
    const runner = new TaskRunner({
      maxConcurrent: 1,
      ensureSession: async (taskId) => `agent:main:webchat:default:direct:${taskId}`,
      hasActiveRun: () => false,
      runTurn,
    });

    runner.enqueue(first.id);
    await vi.advanceTimersByTimeAsync(0);
    runner.enqueue(second.id, { notBefore: Date.now() + 1_000, source: 'system' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runTurn).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runTurn).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);

    releaseFirst?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(runTurn).toHaveBeenCalledTimes(2);
  });
});
