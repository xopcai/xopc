import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { TaskCommandService } from '../task-command-service.js';
import { TaskDependencyService } from '../task-dependency-service.js';
import { TaskRepository } from '../task-repository.js';

describe('TaskCommandService', () => {
  let stateDir: string;
  let tasks: TaskRepository;
  let enqueue: ReturnType<typeof vi.fn>;
  let commands: TaskCommandService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-command-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    tasks = new TaskRepository();
    enqueue = vi.fn(() => ({ id: 'queue-1' }));
    commands = new TaskCommandService(enqueue);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('starts a pending task and queues one execution', () => {
    const task = tasks.create({ objective: 'Ship the release' });
    const result = commands.execute({
      taskId: task.id,
      action: 'run',
      expectedUpdatedAt: task.updatedAt,
    });

    expect(result).toMatchObject({ ok: true, task: { status: 'planning' } });
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('waits without queueing until dependencies are completed', () => {
    const dependency = tasks.create({ objective: 'Prepare source data' });
    const task = tasks.create({ objective: 'Publish the report' });
    new TaskDependencyService().replace({
      taskId: task.id,
      dependsOnTaskIds: [dependency.id],
      expectedUpdatedAt: task.updatedAt,
    });
    const current = tasks.get(task.id)!;

    const result = commands.execute({
      taskId: task.id,
      action: 'run',
      expectedUpdatedAt: current.updatedAt,
    });

    expect(result).toMatchObject({
      ok: true,
      task: { status: 'waiting_dependency' },
      waitingOn: [{ id: dependency.id, status: 'pending' }],
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('restores the previous state when queue persistence fails', () => {
    const task = tasks.create({ objective: 'Do not strand the task' });
    const failed = new TaskCommandService(() => { throw new Error('queue unavailable'); });

    expect(() => failed.execute({
      taskId: task.id,
      action: 'run',
      expectedUpdatedAt: task.updatedAt,
    })).toThrow('queue unavailable');
    expect(tasks.get(task.id)?.status).toBe('pending');
  });

  it('restores the previous state when verification cannot be queued', () => {
    const task = tasks.create({ objective: 'Keep verification retryable' });
    const active = tasks.update(task.id, {
      status: 'blocked',
      blockedReason: 'Waiting for evidence',
    })!;
    const failed = new TaskCommandService(() => { throw new Error('queue unavailable'); });

    expect(() => failed.execute({
      taskId: task.id,
      action: 'verify',
      expectedUpdatedAt: active.updatedAt,
    })).toThrow('queue unavailable');
    expect(tasks.get(task.id)).toMatchObject({
      status: 'blocked',
      execution: { blockedReason: 'Waiting for evidence' },
    });
  });

  it('rejects stale commands without mutating or queueing', () => {
    const task = tasks.create({ objective: 'Keep current state' });
    const changed = tasks.update(task.id, { status: 'planning' })!;
    const result = commands.execute({
      taskId: task.id,
      action: 'run',
      expectedUpdatedAt: task.updatedAt,
    });

    expect(result).toMatchObject({ ok: false, reason: 'conflict', latest: { updatedAt: changed.updatedAt } });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('clears blocker metadata when pausing active work', () => {
    const task = tasks.create({ objective: 'Pause safely' });
    const active = tasks.update(task.id, { status: 'running', blockedReason: 'Old blocker' })!;
    const result = commands.execute({
      taskId: task.id,
      action: 'pause',
      expectedUpdatedAt: active.updatedAt,
    });

    expect(result).toMatchObject({ ok: true, task: { status: 'paused' } });
    expect(tasks.get(task.id)?.execution.blockedReason).toBeUndefined();
  });

  it('requires explicit execution-boundary approval', () => {
    const task = tasks.create({
      objective: 'Deploy release',
      approvalRequired: ['production deploy'],
    });
    const result = commands.execute({
      taskId: task.id,
      action: 'run',
      expectedUpdatedAt: task.updatedAt,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'approval_required',
      requiredBoundaries: ['production deploy'],
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('starts verification without directly completing the task', () => {
    const task = tasks.create({ objective: 'Prove the result', acceptanceCriteria: ['Tests pass'] });
    const active = tasks.update(task.id, { status: 'running' })!;
    const result = commands.execute({
      taskId: task.id,
      action: 'verify',
      expectedUpdatedAt: active.updatedAt,
    });

    expect(result).toMatchObject({ ok: true, task: { status: 'verifying' } });
    expect(tasks.get(task.id)?.status).toBe('verifying');
    expect(enqueue).toHaveBeenCalledWith(task.id, expect.objectContaining({
      userTurn: expect.objectContaining({ text: expect.stringContaining('acceptance criterion') }),
      executionContext: { triggerKind: 'user', strategy: 'verification' },
    }));
  });
});
