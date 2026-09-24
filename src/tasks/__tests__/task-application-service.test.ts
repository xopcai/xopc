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
import { DomainOutboxDispatcher } from '../../infra/domain-outbox-dispatcher.js';
import { TaskRepository } from '../task-repository.js';
import { TaskRunRepository } from '../task-run-repository.js';
import { TaskReadModelProjector } from '../task-read-model-projector.js';
import { TaskRunCoordinator } from '../task-run-coordinator.js';
import { buildTaskRunMessage } from '../task-run-dispatcher.js';
import { getTaskExecutionBrief } from '../task-context-assembler.js';
import { decisionFromTask } from '../home-query-service.js';
import { TaskSignalService } from '../task-signal-service.js';

const contract = {
  objective: 'Ship the TaskRun boundary',
  expectedOutputs: ['implementation'],
  acceptanceCriteria: ['tests pass'],
  constraints: [],
  assumptions: [],
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

  function createRunningTask(key: string) {
    const service = new TaskApplicationService();
    const created = service.create({
      idempotencyKey: key, title: key, priority: 'normal', contract,
      dependencies: [], context: [], authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } },
    });
    if (!created.ok || !created.runId) throw new Error('Expected run');
    const runs = new TaskRunRepository();
    const queued = runs.require(created.runId);
    const snapshot = new TaskContextRepository().captureSnapshot({ ownerKind: 'task_run', ownerId: queued.id, query: key });
    const run = runs.start({ runId: queued.id, expectedVersion: queued.version, contextSnapshotId: snapshot.id, policySnapshot: {} })!;
    return { service, task: created.model.task, run, runs };
  }

  const receipt = {
    status: 'succeeded' as const, summary: 'Result', changes: [],
    evidence: [{ kind: 'test' as const, title: 'Tests', summary: 'Tests pass', provenance: 'tool' as const, strength: 'verified' as const, observedAt: 1 }],
    verification: { status: 'passed' as const, checks: [{ criterion: 'tests pass', status: 'passed' as const, evidenceTitles: ['Tests'] }] }, remainingWork: [],
    needsUser: false, completionVerdict: 'achieved' as const,
  };

  it('persists automation trigger context and includes it in the dispatched message', () => {
    const tasks = new TaskRepository();
    const task = tasks.create({ title: 'Triggered task', objective: 'Handle the source event' });
    const event = { automationTrigger: { type: 'note.created.v1', payload: { noteId: 'note-1' } } };
    const result = new TaskApplicationService().execute({
      taskId: task.id,
      expectedVersion: task.version,
      idempotencyKey: 'automation:event-run',
      command: { type: 'start', executor: { kind: 'agent', agentId: 'main' } },
      actor: { kind: 'system', id: 'automation' },
      triggerContext: event,
    });

    expect(result).toMatchObject({ ok: true, runId: expect.any(String) });
    if (!result.ok || !result.runId) return;
    const run = new TaskRunRepository().require(result.runId);
    expect(run.trigger).toMatchObject({ kind: 'system', context: event });
    expect(buildTaskRunMessage('Handle the source event', run.trigger)).toContain('"noteId":"note-1"');
  });

  it('grants only the reviewed capability and resumes the blocked task', () => {
    const service = new TaskApplicationService();
    const tasks = new TaskRepository();
    const task = tasks.create({ title: 'Publish', objective: 'Publish reviewed result', approvalRequired: ['publish_result'] });
    const runs = new TaskRunRepository();
    const wait = runs.createWait({ taskId: task.id, kind: 'approval', reason: 'Publish the result?', condition: { capability: 'publish_result', executor: { kind: 'agent', agentId: 'main' } } });
    const request = { taskId: task.id, expectedVersion: task.version, idempotencyKey: 'approve-card', command: { type: 'resolve_wait' as const, waitId: wait.id, resolution: { kind: 'task_approval', decision: 'approve', capability: 'unrelated' } } };
    expect(service.execute(request)).toMatchObject({ ok: true, runId: expect.any(String) });
    expect(new TaskContextRepository().listActiveGrants(task.id).map(grant => grant.capability)).toEqual(['publish_result']);
  });

  it('keeps authorization unmet and pauses when the user declines', () => {
    const { service, task, runs } = createRunningTask('decline-card');
    const wait = runs.createWait({ taskId: task.id, kind: 'approval', reason: 'Publish?', condition: { capability: 'publish_result' } });
    expect(service.execute({ taskId: task.id, expectedVersion: task.version, idempotencyKey: 'deny-card', command: { type: 'resolve_wait', waitId: wait.id, resolution: { kind: 'task_approval', decision: 'deny' } } })).toMatchObject({ ok: true, model: { operationalState: 'waiting', attention: [] } });
    expect(runs.requireWait(wait.id).status).toBe('active');
    expect(runs.getActiveRoot(task.id)?.status).toBe('waiting');
    expect(new TaskContextRepository().listActiveGrants(task.id)).toEqual([]);
  });

  it('persists card answers exactly once and rejects stale or blank submissions', () => {
    const { service, task, runs } = createRunningTask('card-answer');
    const wait = runs.createWait({ taskId: task.id, kind: 'user_input', reason: 'Which audience?' });
    const request = { taskId: task.id, expectedVersion: task.version, idempotencyKey: 'answer-once',
      command: { type: 'resolve_wait' as const, waitId: wait.id, resolution: { kind: 'user_answer', answer: 'Product designers' } } };
    expect(service.execute({ ...request, idempotencyKey: 'blank', command: { ...request.command, resolution: { kind: 'user_answer', answer: ' ' } } })).toMatchObject({ ok: false });
    expect(service.execute(request)).toMatchObject({ ok: true });
    expect(service.execute(request)).toMatchObject({ ok: true });
    expect(new TaskContextRepository().list(task.id).filter(edge => edge.metadata.userAnswer === 'Product designers')).toHaveLength(1);
    expect(service.execute({ ...request, idempotencyKey: 'stale' })).toMatchObject({ ok: false });
  });

  it('keeps paused tasks out of attention and execution context even with older input waits', () => {
    const { service, task, run, runs } = createRunningTask('paused-attention');
    runs.createWait({ taskId: task.id, kind: 'user_input', reason: 'Upload footage' });
    service.execute({ taskId: task.id, expectedVersion: task.version, idempotencyKey: 'pause-attention',
      command: { type: 'add_wait', wait: { kind: 'paused', reason: 'Later', condition: {} } } });
    const model = new TaskReadModelProjector().get(task.id)!;
    expect(model.attention).toEqual([]);
    expect(decisionFromTask(model)).toBeNull();
    expect(getTaskExecutionBrief(task.id)).toBeUndefined();
    expect(model.allowedCommands).not.toContain('request_review');
    const currentRun = runs.require(run.id);
    const result = service.completeRun({ runId: run.id, expectedRunVersion: currentRun.version, receipt });
    expect(result).toMatchObject({ ok: true, model: { task: { phase: 'active' }, attention: [] } });
  });

  it('does not reopen a closed task when a late successful run finishes', () => {
    const { service, task, run } = createRunningTask('late-completion');
    service.execute({ taskId: task.id, expectedVersion: task.version, idempotencyKey: 'close-late',
      command: { type: 'close', resolution: 'cancelled' } });
    expect(service.completeRun({ runId: run.id, expectedRunVersion: run.version, receipt }))
      .toMatchObject({ ok: true, model: { task: { phase: 'closed', resolution: 'cancelled' }, attention: [] } });
  });

  it.each([
    { completionVerdict: 'partial' as const },
    { remainingWork: ['Record narration'] },
    { needsUser: true },
    { verification: { status: 'passed' as const, checks: [] } },
  ])('requires an achieved outcome with no pending work for automatic acceptance: %j', (override) => {
    const { service, run } = createRunningTask('partial-completion');
    expect(service.completeRun({ runId: run.id, expectedRunVersion: run.version, receipt: { ...receipt, ...override } }))
      .toMatchObject({ ok: true, model: { task: { phase: 'review' } } });
  });

  it('does not certify a revised contract using an earlier run', () => {
    const { service, task, run } = createRunningTask('revised-contract');
    service.execute({ taskId: task.id, expectedVersion: task.version, idempotencyKey: 'revise-active',
      command: { type: 'revise_contract', contract: { ...contract, acceptanceCriteria: ['New criterion'] } } });
    expect(service.completeRun({ runId: run.id, expectedRunVersion: run.version, receipt }))
      .toMatchObject({ ok: true, model: { task: { phase: 'active' } } });
    expect(getTaskExecutionBrief(task.id)?.remainingCriteria).toEqual(['New criterion']);
  });

  it('rejects an existing run owned by a different task', () => {
    const first = createRunningTask('first-owner');
    const second = createRunningTask('second-owner');
    expect(TaskRunCoordinator.start({ runId: first.run.id, fallbackObjective: 'Other request', context: {
      runId: first.run.id, taskId: second.task.id, conversationId: 'session', channel: 'webchat', origin: 'task', triggerKind: 'user',
    } })).toBeUndefined();
  });

  it('does not use a child result as the task delivery or complete the parent task', () => {
    const { service, task, run, runs } = createRunningTask('parent-delivery');
    const child = runs.create({ taskId: task.id, parentRunId: run.id, executorKind: 'agent', executorRef: { agentId: 'main' },
      trigger: { kind: 'user' }, correlationId: 'child', idempotencyKey: 'child', contractVersion: task.latestContractVersion });
    expect(service.completeRun({ runId: child.id, expectedRunVersion: child.version, receipt }))
      .toMatchObject({ ok: true, model: { task: { phase: 'active' } } });
    expect(runs.listReceipts(task.id)).toEqual([]);
    expect(runs.getReceipt(child.id)).toBeDefined();
  });

  it('does not claim queued runs while the task is paused or closed', () => {
    const tasks = new TaskRepository();
    const runs = new TaskRunRepository();
    const task = tasks.create({ title: 'Queued pause', objective: 'Wait for user' });
    runs.create({ taskId: task.id, executorKind: 'agent', executorRef: { agentId: 'main' },
      trigger: { kind: 'manual' }, correlationId: 'queued-pause', idempotencyKey: 'queued-pause',
      contractVersion: task.latestContractVersion });
    const wait = runs.createWait({ taskId: task.id, kind: 'paused', reason: 'Later' });
    expect(runs.claimNext({ owner: 'test', leaseMs: 1000 })).toBeUndefined();
    runs.resolveWait({ waitId: wait.id, actor: { kind: 'user' } });
    tasks.setLifecycle({ taskId: task.id, expectedVersion: task.version, phase: 'closed', resolution: 'cancelled' });
    expect(runs.claimNext({ owner: 'test', leaseMs: 1000 })).toBeUndefined();
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

  it('starts with the resolved task delegate when creation omits an executor', () => {
    const result = new TaskApplicationService().create({
      idempotencyKey: 'default-executor',
      title: 'Use resolved executor',
      delegateAgentId: 'project-agent',
      priority: 'normal',
      contract,
      dependencies: [],
      context: [],
      authorityGrants: [],
      activation: { mode: 'start' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.runId) throw new Error('Expected TaskRun');
    expect(new TaskRunRepository().get(result.runId)?.executorRef).toEqual({ agentId: 'project-agent' });
  });

  it('moves an idle task between board phases without starting execution', () => {
    const service = new TaskApplicationService();
    const created = service.create({
      idempotencyKey: 'move-1',
      title: 'Move on board',
      priority: 'normal',
      contract,
      dependencies: [],
      context: [],
      authorityGrants: [],
      activation: { mode: 'capture', phase: 'backlog' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const moved = service.execute({
      taskId: created.model.task.id,
      idempotencyKey: 'move-1:active',
      expectedVersion: created.model.task.version,
      command: { type: 'move', phase: 'active' },
    });

    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.model.task.phase).toBe('active');
    expect(moved.model.operationalState).toBe('idle');
    expect(new TaskRunRepository().getActiveRoot(moved.model.task.id)).toBeUndefined();
  });

  it('persists explicit ordering within a board phase', () => {
    const tasks = new TaskRepository();
    const create = (id: string) => tasks.create({
      id,
      title: id,
      phase: 'ready',
      objective: id,
      now: 1,
    });
    const first = create('first');
    create('second');
    const third = create('third');

    expect(tasks.list({ phase: 'ready', order: 'board' }).map((task) => task.id)).toEqual(['first', 'second', 'third']);
    expect(tasks.reorder({ taskId: third.id, expectedVersion: third.version, beforeTaskId: first.id })).toBeDefined();
    expect(tasks.list({ phase: 'ready', order: 'board' }).map((task) => task.id)).toEqual(['third', 'first', 'second']);
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
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    new DomainOutboxDispatcher((event) => events.push(event)).drain();
    expect(events.filter((event) => event.type === 'task.attention_required.v2')).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          sourceEventId: expect.any(String),
          task: { id: blocked.model.task.id, title: 'Blocked' },
          reason: 'blocked',
        }),
      }),
    ]);
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
        evidence: [{ kind: 'test', title: 'Tests', summary: 'Tests passed', provenance: 'tool', strength: 'verified', observedAt: 1 }],
        verification: { status: 'passed', checks: [{ criterion: 'tests pass', status: 'passed', evidenceTitles: ['Tests'] }] },
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
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    new DomainOutboxDispatcher((event) => events.push(event)).drain();
    expect(events).toContainEqual(expect.objectContaining({
      type: 'task.phase_changed.v2',
      payload: expect.objectContaining({
        sourceEventId: expect.any(String),
        task: { id: created.ok ? created.model.task.id : '', title: 'Complete once' },
        to: 'closed',
        resolution: 'done',
      }),
    }));
  });

  it('publishes attention when a TaskRun fails', () => {
    const service = new TaskApplicationService();
    const created = service.create({
      idempotencyKey: 'failed-run', title: 'Deploy release', priority: 'normal', contract,
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
    service.completeRun({
      runId: run.id,
      expectedRunVersion: run.version,
      terminalMessage: 'Deployment command failed',
      receipt: {
        status: 'failed',
        summary: 'Deployment failed',
        changes: [],
        evidence: [],
        verification: { status: 'unverified', checks: [] },
        remainingWork: ['Retry deployment'],
        needsUser: false,
        completionVerdict: 'not_achieved',
        failure: { code: 'deploy_failed', phase: 'execution', recoveryAction: 'Retry the task run' },
      },
    });
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    new DomainOutboxDispatcher((event) => events.push(event)).drain();
    expect(events).toContainEqual(expect.objectContaining({
      type: 'task.attention_required.v2',
      payload: expect.objectContaining({
        task: { id: created.model.task.id, title: 'Deploy release' },
        reason: 'failed',
        detail: 'Deployment command failed',
      }),
    }));
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

  it('publishes one attention event when a run waits for user input', () => {
    const service = new TaskApplicationService();
    const created = service.create({
      idempotencyKey: 'attention-task', title: 'Approve production rollout', priority: 'normal', contract,
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
    const initialEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
    new DomainOutboxDispatcher((event) => initialEvents.push(event)).drain();

    const result = service.execute({
      taskId: created.model.task.id,
      expectedVersion: created.model.task.version,
      idempotencyKey: 'ask-user',
      command: {
        type: 'add_wait',
        wait: { kind: 'user_input', reason: 'Choose a rollout window', condition: {} },
      },
    });
    expect(result.ok).toBe(true);
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    new DomainOutboxDispatcher((event) => events.push(event)).drain();
    const attention = events.filter((event) => event.type === 'task.attention_required.v2');
    expect(attention).toHaveLength(1);
    expect(attention[0]?.payload).toMatchObject({
      sourceEventId: expect.any(String),
      task: { id: created.model.task.id, title: 'Approve production rollout' },
      reason: 'user_input',
      detail: 'Choose a rollout window',
    });
  });

  it('publishes each transactional task outbox event once', () => {
    const service = new TaskApplicationService();
    service.create({
      idempotencyKey: 'outbox-task', title: 'Publish event', priority: 'normal', contract,
      dependencies: [], context: [], authorityGrants: [], activation: { mode: 'capture', phase: 'backlog' },
    });
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const dispatcher = new DomainOutboxDispatcher((event) => events.push(event));
    expect(dispatcher.drain()).toBe(2);
    expect(dispatcher.drain()).toBe(0);
    expect(events.map((event) => event.type).sort()).toEqual(['task.changed.v2', 'task.created.v2']);
    expect(events.find((event) => event.type === 'task.changed.v2')?.payload).toMatchObject({
      taskId: expect.any(String),
      version: 1,
      source: 'user',
      changedFields: expect.arrayContaining(['title', 'phase', 'contract']),
    });
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
