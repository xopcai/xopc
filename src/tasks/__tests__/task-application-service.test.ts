import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { TaskApplicationService } from '../task-application-service.js';
import { TaskContextRepository } from '../task-context-repository.js';
import { TaskOutboxDispatcher } from '../task-outbox-dispatcher.js';
import { TaskRunRepository } from '../task-run-repository.js';
import { TaskSignalService } from '../task-signal-service.js';

const contract = {
  objective: 'Ship the TaskRun boundary',
  expectedOutputs: ['implementation'],
  acceptanceCriteria: ['tests pass'],
  constraints: [],
  nonGoals: [],
  risks: [],
  approvalRequired: [],
  acceptancePolicy: 'verified_auto' as const,
  outputDestinations: [],
};

describe('TaskApplicationService', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-application-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('captures durable intent without creating a run', () => {
    const service = new TaskApplicationService();
    const result = service.create({
      idempotencyKey: 'capture-1',
      title: 'Design lifecycle',
      priority: 'normal',
      contract,
      dependencies: [],
      context: [],
      authorityGrants: [],
      activation: { mode: 'capture', phase: 'backlog' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.task.phase).toBe('backlog');
    expect(result.model.operationalState).toBe('idle');
    expect(result.runId).toBeUndefined();
  });

  it('creates one root run idempotently and snapshots before execution', () => {
    const service = new TaskApplicationService();
    const request = {
      idempotencyKey: 'start-1',
      title: 'Execute lifecycle',
      priority: 'high' as const,
      contract,
      dependencies: [],
      context: [],
      authorityGrants: [],
      activation: { mode: 'start' as const, executor: { kind: 'agent' as const, agentId: 'main' } },
    };
    const first = service.create(request);
    const repeated = service.create(request);

    expect(first.ok && first.runId).toBeTruthy();
    expect(repeated.ok && repeated.runId).toBe(first.ok ? first.runId : undefined);
    const runs = new TaskRunRepository();
    const queued = runs.require(first.ok ? first.runId! : 'missing');
    const snapshot = new TaskContextRepository().captureSnapshot({
      ownerKind: 'task_run',
      ownerId: queued.id,
      query: contract.objective,
    });
    const running = runs.start({
      runId: queued.id,
      expectedVersion: queued.version,
      contextSnapshotId: snapshot.id,
      policySnapshot: { tools: ['read'] },
    });
    expect(running).toMatchObject({ status: 'running', contextSnapshotId: snapshot.id });
    expect(runs.listEvents(queued.id).map((event) => event.type))
      .toEqual(['task_run.created', 'task_run.running']);
  });

  it('projects dependency waits instead of starting an ineligible task', () => {
    const service = new TaskApplicationService();
    const dependency = service.create({
      idempotencyKey: 'dependency-1',
      title: 'Dependency',
      priority: 'normal',
      contract,
      dependencies: [],
      context: [],
      authorityGrants: [],
      activation: { mode: 'capture', phase: 'ready' },
    });
    expect(dependency.ok).toBe(true);
    const blocked = service.create({
      idempotencyKey: 'blocked-1',
      title: 'Blocked',
      priority: 'normal',
      contract,
      dependencies: [dependency.ok ? dependency.model.task.id : 'missing'],
      context: [],
      authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } },
    });

    expect(blocked).toMatchObject({ ok: false, reason: 'blocked' });
    if (blocked.ok || !blocked.model) return;
    expect(blocked.model.operationalState).toBe('blocked');
    expect(blocked.model.attention[0]).toMatchObject({ kind: 'dependency_blocked' });
  });

  it('uses the run receipt as the only execution completion boundary', () => {
    const service = new TaskApplicationService();
    const created = service.create({
      idempotencyKey: 'complete-1',
      title: 'Complete once',
      priority: 'normal',
      contract,
      dependencies: [],
      context: [],
      authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } },
    });
    expect(created.ok && created.runId).toBeTruthy();
    const runs = new TaskRunRepository();
    let run = runs.require(created.ok ? created.runId! : 'missing');
    const snapshot = new TaskContextRepository().captureSnapshot({
      ownerKind: 'task_run', ownerId: run.id, query: contract.objective,
    });
    run = runs.start({
      runId: run.id,
      expectedVersion: run.version,
      contextSnapshotId: snapshot.id,
      policySnapshot: {},
    })!;
    const completed = service.completeRun({
      runId: run.id,
      expectedRunVersion: run.version,
      receipt: {
        status: 'succeeded',
        summary: 'Implemented and verified',
        changes: [],
        evidence: [],
        verification: { status: 'passed', checks: [] },
        remainingWork: [],
        needsUser: false,
        completionVerdict: 'achieved',
      },
    });
    expect(completed).toMatchObject({
      ok: true,
      model: { task: { phase: 'closed', resolution: 'done' }, operationalState: 'idle' },
    });
    expect(runs.getReceipt(run.id)?.summary).toBe('Implemented and verified');
  });

  it('rejects reuse of a create idempotency key with different intent', () => {
    const service = new TaskApplicationService();
    const base = {
      idempotencyKey: 'strict-key',
      title: 'Original',
      priority: 'normal' as const,
      contract,
      dependencies: [],
      context: [],
      authorityGrants: [],
      activation: { mode: 'capture' as const, phase: 'backlog' as const },
    };
    service.create(base);
    expect(() => service.create({ ...base, title: 'Different' }))
      .toThrow('Idempotency key was reused with different input');
  });

  it('resumes a blocked start from a dependency signal without a legacy queue item', () => {
    const service = new TaskApplicationService();
    const dependency = service.create({
      idempotencyKey: 'signal-dependency', title: 'Dependency', priority: 'normal', contract,
      dependencies: [], context: [], authorityGrants: [], activation: { mode: 'capture', phase: 'ready' },
    });
    const blocked = service.create({
      idempotencyKey: 'signal-blocked', title: 'Blocked task', priority: 'normal', contract,
      dependencies: [dependency.ok ? dependency.model.task.id : 'missing'], context: [], authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } },
    });
    expect(blocked).toMatchObject({ ok: false, reason: 'blocked' });
    if (!dependency.ok || blocked.ok || !blocked.model) return;
    const closed = service.execute({
      taskId: dependency.model.task.id,
      expectedVersion: dependency.model.task.version,
      idempotencyKey: 'close-dependency',
      command: { type: 'close', resolution: 'done' },
    });
    expect(closed.ok).toBe(true);
    let dispatches = 0;
    const resumed = new TaskSignalService(() => { dispatches += 1; })
      .dependencyClosed(dependency.model.task.id);
    expect(resumed).toBe(1);
    expect(dispatches).toBe(1);
    expect(new TaskRunRepository().getActiveRoot(blocked.model.task.id)?.status).toBe('queued');
  });

  it('resumes the same waiting TaskRun after its wait is resolved', () => {
    const service = new TaskApplicationService();
    const created = service.create({
      idempotencyKey: 'wait-resume', title: 'Pause and resume', priority: 'normal', contract,
      dependencies: [], context: [], authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } },
    });
    if (!created.ok || !created.runId) throw new Error('Expected TaskRun');
    const runs = new TaskRunRepository();
    let run = runs.require(created.runId);
    const snapshot = new TaskContextRepository().captureSnapshot({
      ownerKind: 'task_run', ownerId: run.id, query: contract.objective,
    });
    run = runs.start({
      runId: run.id, expectedVersion: run.version, contextSnapshotId: snapshot.id, policySnapshot: {},
    })!;
    const paused = service.execute({
      taskId: created.model.task.id,
      expectedVersion: created.model.task.version,
      idempotencyKey: 'pause-command',
      command: { type: 'add_wait', wait: { kind: 'paused', reason: 'Pause', condition: {} } },
    });
    expect(paused.ok && paused.model.operationalState).toBe('waiting');
    const waiting = runs.getActiveRoot(created.model.task.id)!;
    expect(waiting).toMatchObject({ id: run.id, status: 'waiting' });
    const wait = runs.listActiveWaits(created.model.task.id)[0]!;
    expect(runs.listEvents(run.id).at(-2)?.type).toBe('task_run.wait_created');
    const resumed = service.execute({
      taskId: created.model.task.id,
      expectedVersion: created.model.task.version,
      idempotencyKey: 'resume-command',
      command: { type: 'resolve_wait', waitId: wait.id },
    });
    expect(resumed.ok).toBe(true);
    expect(runs.listEvents(run.id).at(-1)?.type).toBe('task_run.wait_resolved');
    expect(runs.claimNext({ owner: 'test-worker', leaseMs: 1_000, executorKind: 'agent' }))
      .toMatchObject({ id: run.id, status: 'waiting' });
  });

  it('publishes each transactional task outbox event once', () => {
    const service = new TaskApplicationService();
    service.create({
      idempotencyKey: 'outbox-task', title: 'Publish event', priority: 'normal', contract,
      dependencies: [], context: [], authorityGrants: [], activation: { mode: 'capture', phase: 'backlog' },
    });
    const events: Array<{ type: string }> = [];
    const dispatcher = new TaskOutboxDispatcher((event) => events.push(event));
    expect(dispatcher.drain()).toBe(1);
    expect(dispatcher.drain()).toBe(0);
    expect(events.map((event) => event.type)).toEqual(['task.created.v2']);
  });

  it('records feedback against TaskRun rather than a generic execution receipt', () => {
    const service = new TaskApplicationService();
    const created = service.create({
      idempotencyKey: 'feedback-task', title: 'Rate run', priority: 'normal', contract,
      dependencies: [], context: [], authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } },
    });
    if (!created.ok || !created.runId) throw new Error('Expected TaskRun');
    expect(new TaskRunRepository().recordFeedback({
      runId: created.runId, rating: 'not_helpful', reason: 'Wrong output', now: 123,
    })).toMatchObject({ runId: created.runId, rating: 'not_helpful', reason: 'Wrong output', createdAt: 123 });
  });
});
