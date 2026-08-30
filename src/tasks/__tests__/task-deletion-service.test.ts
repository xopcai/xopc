import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { TaskContextRepository } from '../task-context-repository.js';
import { TaskDeletionService } from '../task-deletion-service.js';
import { TaskRepository } from '../task-repository.js';
import { TaskRunRepository } from '../task-run-repository.js';

describe('TaskDeletionService', () => {
  let stateDir: string;
  let tasks: TaskRepository;
  let runs: TaskRunRepository;
  let deletion: TaskDeletionService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-deletion-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    tasks = new TaskRepository();
    runs = new TaskRunRepository();
    deletion = new TaskDeletionService(tasks, runs);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('deletes a Task and its Task-owned records', () => {
    const task = tasks.create({ id: 'delete-task', title: 'Delete me', objective: 'Delete this Task' });
    const context = new TaskContextRepository();
    context.add({
      taskId: task.id,
      targetKind: 'document',
      targetId: 'document-1',
      role: 'reference',
      createdBy: { kind: 'user' },
    });
    context.captureSnapshot({ ownerKind: 'task', ownerId: task.id, query: task.title });
    const run = runs.create({
      id: 'completed-run',
      taskId: task.id,
      executorKind: 'agent',
      executorRef: { agentId: 'main' },
      trigger: { kind: 'manual' },
      correlationId: 'completed-run',
      idempotencyKey: 'completed-run',
      contractVersion: task.latestContractVersion,
    });
    const runSnapshot = context.captureSnapshot({
      ownerKind: 'task_run',
      ownerId: run.id,
      query: task.title,
    });
    const running = runs.start({
      runId: run.id,
      expectedVersion: run.version,
      contextSnapshotId: runSnapshot.id,
      policySnapshot: {},
    });
    if (!running) throw new Error('Expected the TaskRun to start');
    runs.finalize({
      runId: running.id,
      expectedVersion: running.version,
      receipt: {
        status: 'succeeded',
        summary: 'Completed before deletion',
        changes: [],
        evidence: [],
        verification: { status: 'unverified', checks: [] },
        remainingWork: [],
        needsUser: false,
        completionVerdict: 'achieved',
      },
    });
    const db = getSqliteDatabase();
    db.prepare(
      `INSERT INTO command_deduplication (
        idempotency_key, command_type, subject_kind, subject_id,
        request_hash, result_json, created_at
      ) VALUES ('delete-task-command', 'task.test', 'task', ?, 'hash', '{}', 1)`,
    ).run(task.id);
    db.prepare(
      `INSERT INTO domain_outbox (
        event_id, event_type, subject_kind, subject_id, correlation_id,
        payload_json, created_at
      ) VALUES ('delete-task-event', 'task.changed.v2', 'task', ?, 'correlation', '{}', 1)`,
    ).run(task.id);

    expect(deletion.delete(task.id)).toMatchObject({ ok: true, task: { id: task.id } });
    expect(tasks.get(task.id)).toBeUndefined();
    expect(runs.get(run.id)).toBeUndefined();
    expect(context.list(task.id)).toEqual([]);
    expect(db.prepare(
      `SELECT COUNT(*) AS count FROM context_snapshots WHERE owner_kind = 'task' AND owner_id = ?`,
    ).get(task.id)).toEqual({ count: 0 });
    expect(db.prepare(
      `SELECT COUNT(*) AS count FROM command_deduplication WHERE subject_kind = 'task' AND subject_id = ?`,
    ).get(task.id)).toEqual({ count: 0 });
    expect(db.prepare(
      `SELECT event_type, payload_json FROM domain_outbox WHERE subject_kind = 'task' AND subject_id = ?`,
    ).all(task.id)).toEqual([{
      event_type: 'task.deleted.v1',
      payload_json: expect.stringContaining(`"taskId":"${task.id}"`),
    }]);
    expect(db.prepare(
      `SELECT COUNT(*) AS count FROM context_snapshots
       WHERE (owner_kind = 'task' AND owner_id = ?)
          OR (owner_kind = 'task_run' AND owner_id = ?)`,
    ).get(task.id, run.id)).toEqual({ count: 0 });
  });

  it('requires an active TaskRun to be cancelled first', () => {
    const task = tasks.create({ id: 'active-task', title: 'Active', objective: 'Keep running' });
    const run = runs.create({
      id: 'active-run',
      taskId: task.id,
      executorKind: 'agent',
      executorRef: { agentId: 'main' },
      trigger: { kind: 'manual' },
      correlationId: 'active-run',
      idempotencyKey: 'active-run',
      contractVersion: task.latestContractVersion,
    });

    expect(deletion.delete(task.id)).toEqual({ ok: false, reason: 'active_run', run });
    expect(tasks.get(task.id)).toBeDefined();
    expect(runs.get(run.id)).toBeDefined();
  });
});
