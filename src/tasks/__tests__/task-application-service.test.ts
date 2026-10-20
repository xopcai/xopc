import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seedTestDatabase } from '../../../test/sqlite-fixture.js';

import {
  closeXopcDatabase,
  getSqliteDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { TaskApplicationService } from '../task-application-service.js';
import { TaskContextRepository } from '../task-context-repository.js';
import { DomainOutboxDispatcher } from '../../infra/domain-outbox-dispatcher.js';
import { listAutomationEvents } from '../../automations/events/index.js';
import { TaskRepository } from '../task-repository.js';
import { TaskRunRepository } from '../task-run-repository.js';
import { TaskReadModelProjector } from '../task-read-model-projector.js';
import { TaskRunCoordinator } from '../task-run-coordinator.js';
import { buildTaskRunMessage } from '../task-run-dispatcher.js';
import { getTaskExecutionBrief } from '../task-context-assembler.js';
import { decisionFromTask } from '../home-query-service.js';
import { TaskSignalService } from '../task-signal-service.js';
import { TaskOriginRepository } from '../task-origin-repository.js';
import { TaskCollaborationRepository } from '../task-collaboration-repository.js';
import { TaskCriterionReviewRepository } from '../task-criterion-review-repository.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';

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
    seedTestDatabase(join(stateDir, 'xopc.db'));
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function createRunningTask(key: string, locale?: 'en' | 'zh') {
    const service = new TaskApplicationService();
    const created = service.create({
      idempotencyKey: key, title: key, locale, priority: 'normal', contract,
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

  it('allows every phase pair and atomically records actor, source, and resolutions', () => {
    const tasks = new TaskRepository();
    const phases = ['backlog', 'ready', 'active', 'review', 'closed'] as const;
    for (const from of phases) for (const to of phases) {
      if (from === to) continue;
      const { service, task, run, runs } = createRunningTask(`move-${from}-${to}`);
      if (from !== 'active') tasks.setLifecycle({ taskId: task.id, expectedVersion: task.version,
        phase: from, ...(from === 'closed' ? { resolution: 'cancelled' as const } : {}) });
      runs.createWait({ taskId: task.id, kind: 'user_input', reason: 'Await answer', condition: {} });
      const before = tasks.require(task.id);
      const result = service.execute({ taskId: task.id, expectedVersion: before.version,
        idempotencyKey: `drag-${from}-${to}`, source: 'board', actor: { kind: 'user', id: 'owner' },
        command: { type: 'move', phase: to } });
      expect(result).toMatchObject({ ok: true, model: { task: { phase: to } } });
      const change = tasks.phaseChanges(task.id).at(-1)!;
      expect(change).toMatchObject({ fromPhase: from, toPhase: to, source: 'board',
        actor: { kind: 'user', id: 'owner' }, operationId: `drag-${from}-${to}` });
      expect(change.toResolution).toBe(to === 'closed' ? 'done' : undefined);
      expect(tasks.require(task.id).resolution).toBe(to === 'closed' ? 'done' : undefined);
      expect(runs.require(run.id).status).toBe('running');
      const count = tasks.phaseChanges(task.id).length;
      expect(service.execute({ taskId: task.id, expectedVersion: before.version,
        idempotencyKey: 'stale-command', command: { type: 'move', phase: from } }).ok).toBe(false);
      expect(tasks.phaseChanges(task.id)).toHaveLength(count);
    }
  });

  it.each(['backlog', 'ready', 'review', 'closed', 'active'] as const)(
    'preserves manual %s after a late successful run, including moving away and back', phase => {
      const { service, task, run, runs } = createRunningTask(`manual-${phase}`);
      const tasks = new TaskRepository();
      for (const target of phase === 'active' ? ['ready', 'active'] as const : [phase]) {
        const current = tasks.require(task.id);
        expect(service.execute({ taskId: task.id, expectedVersion: current.version,
          idempotencyKey: `manual-${phase}-${target}`, command: { type: 'move', phase: target } }).ok).toBe(true);
      }
      const count = tasks.phaseChanges(task.id).length;
      expect(service.completeRun({ runId: run.id, expectedRunVersion: run.version, receipt }))
        .toMatchObject({ ok: true, model: { task: { phase } } });
      expect(tasks.phaseChanges(task.id)).toHaveLength(count);
      expect(runs.getReceipt(run.id)?.status).toBe('succeeded');
      expect(new TaskCollaborationRepository().recent(task.id).some(entry => entry.taskRunId === run.id && entry.kind === 'result')).toBe(true);
    });

  it('retains the manual phase fence after reopening the database', () => {
    const { service, task, run } = createRunningTask('durable-phase');
    service.execute({ taskId: task.id, expectedVersion: task.version, idempotencyKey: 'durable-move',
      source: 'mobile', command: { type: 'move', phase: 'ready' } });
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    expect(new TaskApplicationService().completeRun({ runId: run.id, expectedRunVersion: run.version, receipt }))
      .toMatchObject({ ok: true, model: { task: { phase: 'ready' } } });
    expect(new TaskRepository().phaseChanges(task.id).at(-1)).toMatchObject({ source: 'mobile', toPhase: 'ready' });
  });

  it('resumes automatic completion only for a new explicit execution', () => {
    const { service, task, run } = createRunningTask('explicit-restart');
    const tasks = new TaskRepository();
    service.execute({ taskId: task.id, expectedVersion: task.version, idempotencyKey: 'manual-ready',
      command: { type: 'move', phase: 'ready' } });
    service.completeRun({ runId: run.id, expectedRunVersion: run.version, receipt });
    const current = tasks.require(task.id);
    expect(service.execute({ taskId: task.id, expectedVersion: current.version, idempotencyKey: 'background-restart',
      actor: { kind: 'system', id: 'task-signal' }, command: { type: 'start', executor: { kind: 'agent', agentId: 'main' } } }))
      .toMatchObject({ ok: false, reason: 'blocked' });
    const next = service.execute({ taskId: task.id, expectedVersion: current.version, idempotencyKey: 'explicit-restart-2',
      command: { type: 'start', executor: { kind: 'agent', agentId: 'main' } } });
    expect(next.ok).toBe(true);
    if (!next.ok || !next.runId) throw new Error('Expected explicit run');
    const newRun = new TaskRunRepository().require(next.runId);
    expect(service.completeRun({ runId: newRun.id, expectedRunVersion: newRun.version, receipt }))
      .toMatchObject({ ok: true, model: { task: { phase: 'closed', resolution: 'done' } } });
  });

  it('keeps no duplicate log for an idempotent replay and rolls back failed log writes', () => {
    const { service, task } = createRunningTask('audit-atomic');
    const tasks = new TaskRepository();
    const command = { type: 'move', phase: 'closed' } as const;
    service.execute({ taskId: task.id, expectedVersion: task.version, idempotencyKey: 'audit-close', command });
    const current = tasks.require(task.id);
    const count = tasks.phaseChanges(task.id).length;
    expect(service.execute({ taskId: task.id, expectedVersion: current.version, idempotencyKey: 'audit-close', command }).ok).toBe(true);
    expect(tasks.phaseChanges(task.id)).toHaveLength(count);
    getSqliteDatabase().exec(`CREATE TRIGGER reject_phase_audit BEFORE INSERT ON task_phase_changes
      BEGIN SELECT RAISE(ABORT, 'audit write failed'); END`);
    expect(() => service.execute({ taskId: task.id, expectedVersion: current.version, idempotencyKey: 'audit-failure',
      command: { type: 'move', phase: 'ready' } })).toThrow('audit write failed');
    expect(tasks.require(task.id)).toEqual(current);
  });

  it.each(['heartbeat', 'automation', 'workflow', 'internal', 'task_update', undefined] as const)(
    'does not let a %s input clear manual phase protection even when session metadata says user', source => {
      const service = new TaskApplicationService();
      const created = service.create({ idempotencyKey: 'origin-fence', title: 'Origin fence', priority: 'normal',
        contract, dependencies: [], context: [], authorityGrants: [], activation: { mode: 'capture', phase: 'ready' } });
      if (!created.ok) throw new Error('Expected Task');
      const taskId = created.model.task.id;
      service.execute({ taskId, expectedVersion: created.model.task.version, idempotencyKey: 'origin-move',
        command: { type: 'move', phase: 'backlog' } });
      const tasks = new TaskRepository();
      const before = tasks.require(taskId);
      const changes = tasks.phaseChanges(taskId);
      expect(TaskRunCoordinator.start({ runId: 'background-origin', fallbackObjective: contract.objective,
        ...(source ? { inputOrigin: { type: 'system' as const, source } } : {}),
        context: { runId: 'background-origin', taskId, conversationId: createConversation({ agentId: 'main' }).key,
          agentId: 'main', channel: 'webchat', origin: 'task', triggerKind: 'user' } })).toBeUndefined();
      expect(tasks.require(taskId)).toEqual(before);
      expect(tasks.automaticStartAllowed(taskId)).toBe(false);
      expect(tasks.phaseChanges(taskId)).toEqual(changes);
      expect(new TaskRunRepository().listByTask(taskId)).toEqual([]);
    });

  it.each([
    { type: 'endpoint', endpointId: 'mobile' }, { type: 'channel', channel: 'webchat' },
    { type: 'system', source: 'cli' },
  ] as const)('allows an explicit user input through $type to start new work after a manual move', inputOrigin => {
    const service = new TaskApplicationService();
    const created = service.create({ idempotencyKey: 'user-origin', title: 'User origin', priority: 'normal', contract,
      dependencies: [], context: [], authorityGrants: [], activation: { mode: 'capture', phase: 'ready' } });
    if (!created.ok) throw new Error('Expected Task');
    const taskId = created.model.task.id;
    service.execute({ taskId, expectedVersion: created.model.task.version, idempotencyKey: 'user-origin-move',
      command: { type: 'move', phase: 'backlog' } });
    const coordinator = TaskRunCoordinator.start({ runId: 'explicit-origin', fallbackObjective: contract.objective,
      inputOrigin, context: { runId: 'explicit-origin', taskId, channel: 'webchat', origin: 'task',
        conversationId: createConversation({ agentId: 'main' }).key, agentId: 'main', triggerKind: 'heartbeat' } });
    expect(coordinator).toBeDefined();
    const tasks = new TaskRepository();
    expect(tasks.require(taskId).phase).toBe('active');
    expect(tasks.automaticStartAllowed(taskId)).toBe(true);
    const run = new TaskRunRepository().require('explicit-origin');
    expect(service.completeRun({ runId: run.id, expectedRunVersion: run.version, receipt }))
      .toMatchObject({ ok: true, model: { task: { phase: 'closed', resolution: 'done' } } });
  });

  it.each(['ready', 'closed'] as const)('continues an existing queued run on a manually chosen %s phase', phase => {
    const service = new TaskApplicationService();
    const created = service.create({ idempotencyKey: 'queued-origin', title: 'Queued work', priority: 'normal', contract,
      dependencies: [], context: [], authorityGrants: [], activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } } });
    if (!created.ok || !created.runId) throw new Error('Expected queued run');
    const taskId = created.model.task.id;
    service.execute({ taskId, expectedVersion: created.model.task.version, idempotencyKey: 'queued-origin-move',
      command: { type: 'move', phase } });
    const tasks = new TaskRepository();
    const before = tasks.require(taskId);
    const coordinator = TaskRunCoordinator.start({ runId: created.runId, fallbackObjective: contract.objective,
      inputOrigin: { type: 'system', source: 'workflow' }, context: { runId: created.runId, taskId,
        conversationId: createConversation({ agentId: 'main' }).key, agentId: 'main', channel: 'webchat',
        origin: 'task', triggerKind: 'user' } });
    expect(coordinator).toBeDefined();
    expect(tasks.require(taskId)).toEqual(before);
    expect(tasks.automaticStartAllowed(taskId)).toBe(false);
    expect(new TaskRunRepository().require(created.runId).status).toBe('running');
  });

  it.each(['paused', 'user_input', 'approval'] as const)(
    'resolves an existing %s wait on a manually completed task without reopening it', kind => {
      const { service, task, run, runs } = createRunningTask(`closed-${kind}`);
      const waiting = service.execute({ taskId: task.id, expectedVersion: task.version, idempotencyKey: 'add-closed-wait',
        command: { type: 'add_wait', wait: { kind, reason: 'Wait', condition: kind === 'approval' ? { capability: 'publish' } : {} } } });
      if (!waiting.ok) throw new Error('Expected wait');
      const closed = service.execute({ taskId: task.id, expectedVersion: waiting.model.task.version,
        idempotencyKey: 'close-with-wait', command: { type: 'move', phase: 'closed' } });
      if (!closed.ok) throw new Error('Expected closed task');
      expect(closed.model.allowedCommands).toContain('resolve_wait');
      expect(closed.model.operationalState).toBe('waiting');
      const tasks = new TaskRepository();
      const count = tasks.phaseChanges(task.id).length;
      const wait = runs.listActiveWaits(task.id)[0];
      const resolution = kind === 'user_input' ? { kind: 'user_answer', answer: 'Continue with source A' }
        : kind === 'approval' ? { kind: 'task_approval', decision: 'approve' } : undefined;
      if (resolution) {
        for (const malformed of [undefined, kind === 'approval'
          ? { kind: 'task_approval', decision: 'maybe' } : { kind: 'user_answer', answer: ' ' }]) {
          expect(service.execute({ taskId: task.id, expectedVersion: closed.model.task.version,
            idempotencyKey: `invalid-response-${JSON.stringify(malformed)}`,
            command: { type: 'resolve_wait', waitId: wait.id, resolution: malformed } }))
            .toMatchObject({ ok: false, reason: 'invalid_transition' });
          expect(runs.requireWait(wait.id).status).toBe('active');
        }
        expect(service.execute({ taskId: task.id, expectedVersion: closed.model.task.version,
          idempotencyKey: 'invalid-responder', actor: { kind: 'agent', id: 'worker' },
          command: { type: 'resolve_wait', waitId: wait.id, resolution } }))
          .toMatchObject({ ok: false, reason: 'invalid_transition' });
        expect(runs.requireWait(wait.id).status).toBe('active');
      }
      expect(service.execute({ taskId: task.id, expectedVersion: closed.model.task.version,
        idempotencyKey: 'resolve-closed-wait', command: { type: 'resolve_wait', waitId: wait.id, resolution } }))
        .toMatchObject({ ok: true, model: { task: { phase: 'closed', resolution: 'done' } } });
      expect(runs.requireWait(wait.id).status).toBe('resolved');
      expect(runs.listByTask(task.id)).toHaveLength(1);
      expect(runs.claimNext({ owner: 'worker', leaseMs: 1000 })?.id).toBe(run.id);
      expect(tasks.phaseChanges(task.id)).toHaveLength(count);
      expect(tasks.automaticStartAllowed(task.id)).toBe(false);
      const currentRun = runs.require(run.id);
      expect(service.completeRun({ runId: run.id, expectedRunVersion: currentRun.version, receipt }))
        .toMatchObject({ ok: true, model: { task: { phase: 'closed', resolution: 'done' } } });
    });

  it('resolves a completed task approval without creating a new execution', () => {
    const tasks = new TaskRepository(), runs = new TaskRunRepository(), service = new TaskApplicationService();
    const task = tasks.create({ title: 'Not started', objective: 'Wait for approval' });
    const wait = runs.createWait({ taskId: task.id, kind: 'approval', reason: 'Publish',
      condition: { capability: 'publish', executor: { kind: 'agent', agentId: 'main' } } });
    const closed = service.execute({ taskId: task.id, expectedVersion: task.version, idempotencyKey: 'closed-before-start',
      command: { type: 'move', phase: 'closed' } });
    if (!closed.ok) throw new Error('Expected closed Task');
    expect(service.execute({ taskId: task.id, expectedVersion: closed.model.task.version, idempotencyKey: 'approve-no-start',
      command: { type: 'resolve_wait', waitId: wait.id, resolution: { kind: 'task_approval', decision: 'approve' } } }))
      .toMatchObject({ ok: true, model: { task: { phase: 'closed', resolution: 'done' }, operationalState: 'idle' } });
    expect(runs.listByTask(task.id)).toEqual([]);
  });

  it.each(['cancelled', 'duplicate', 'wont_do'] as const)('does not resume waits on a task closed as %s', resolution => {
    const { service, task, runs } = createRunningTask(`closed-${resolution}`);
    const wait = runs.createWait({ taskId: task.id, kind: 'paused', reason: 'Pause', condition: {} });
    const closed = service.execute({ taskId: task.id, expectedVersion: task.version, idempotencyKey: 'cancel-wait',
      command: { type: 'close', resolution } });
    if (!closed.ok) throw new Error('Expected closed Task');
    expect(closed.model.allowedCommands).not.toContain('resolve_wait');
    expect(service.execute({ taskId: task.id, expectedVersion: closed.model.task.version, idempotencyKey: 'refuse-resume',
      command: { type: 'resolve_wait', waitId: wait.id } })).toMatchObject({ ok: false, reason: 'invalid_transition' });
    expect(runs.requireWait(wait.id).status).toBe('active');
  });

  it('finalizes a long result without truncating its receipt or rolling back completion', () => {
    const { service, run, runs } = createRunningTask('long-result');
    const summary = `# Report\n${'Evidence '.repeat(1200)}\nFinal conclusion`;
    const result = service.completeRun({ runId: run.id, expectedRunVersion: run.version, receipt: { ...receipt, summary } });
    expect(result.ok).toBe(true);
    expect(runs.getReceipt(run.id)?.summary).toBe(summary);
    expect(runs.require(run.id).status).toBe('succeeded');
    expect(new TaskCollaborationRepository().recent(run.taskId)[0].body.length).toBeLessThanOrEqual(8000);
  });

  it('requires current criterion reviews before an agent completes a task', () => {
    const service = new TaskApplicationService();
    const created = service.create({
      idempotencyKey: 'manual-acceptance', title: 'Review work', priority: 'normal',
      contract: { ...contract, acceptancePolicy: 'manual' },
      dependencies: [], context: [], authorityGrants: [],
      activation: { mode: 'capture', phase: 'ready' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const taskId = created.model.task.id;
    const close = (key: string) => service.execute({ taskId,
      expectedVersion: new TaskRepository().require(taskId).version,
      idempotencyKey: key, actor: { kind: 'agent', id: 'reviewer' }, command: { type: 'close', resolution: 'done' } });
    expect(close('close-before-review')).toMatchObject({ ok: false, reason: 'blocked' });
    const reviews = new TaskCriterionReviewRepository();
    const failedTask = new TaskRepository().require(taskId);
    reviews.set({ task: failedTask, expectedVersion: failedTask.version, criterionIndex: 0,
      status: 'failed', actor: { kind: 'user', id: 'owner' } });
    expect(close('close-after-failure')).toMatchObject({ ok: false, reason: 'blocked' });
    const passedTask = new TaskRepository().require(taskId);
    reviews.set({ task: passedTask, expectedVersion: passedTask.version, criterionIndex: 0,
      status: 'passed', actor: { kind: 'user', id: 'owner' } });
    const beforeRevision = new TaskRepository().require(taskId);
    expect(reviews.allPassed(beforeRevision)).toBe(true);
    const revised = new TaskRepository().reviseContract({
      taskId, expectedVersion: beforeRevision.version, ...contract,
      acceptancePolicy: 'manual', createdBy: { kind: 'user', id: 'owner' },
    });
    expect(revised?.latestContractVersion).toBe(2);
    expect(close('close-after-revision')).toMatchObject({ ok: false, reason: 'blocked' });
    const current = new TaskRepository().require(taskId);
    reviews.set({ task: current, expectedVersion: current.version, criterionIndex: 0,
      status: 'passed', actor: { kind: 'user', id: 'owner' } });
    expect(close('close-after-review')).toMatchObject({ ok: true, model: { task: { phase: 'closed', resolution: 'done' } } });
  });

  it('links a created task to its originating conversation once', () => {
    const conversation = createConversation({ agentId: 'main' });
    const input = {
      idempotencyKey: 'origin-task', title: 'Background work', priority: 'normal' as const,
      originConversationId: conversation.key, contract, dependencies: [], context: [], authorityGrants: [],
      activation: { mode: 'capture' as const, phase: 'backlog' as const },
    };
    const service = new TaskApplicationService();
    const first = service.create(input);
    expect(first.ok).toBe(true);
    expect(service.create(input)).toEqual(first);
    expect(new TaskOriginRepository().list(conversation.key)).toMatchObject({ total: 1,
      items: [{ id: first.ok ? first.model.task.id : undefined, title: 'Background work' }] });
  });

  it('pages delegated tasks by latest update when requested', () => {
    const conversation = createConversation({ agentId: 'main' });
    const tasks = new TaskRepository();
    const db = getSqliteDatabase();
    const ids = ['Older active', 'Newest finished', 'Middle active'].map((title, index) => {
      const task = tasks.create({ title, objective: title });
      db.prepare('INSERT INTO task_origin_links (task_id, conversation_id, created_at) VALUES (?, ?, ?)')
        .run(task.id, conversation.key, index + 1);
      db.prepare('UPDATE tasks SET phase = ?, resolution = ?, updated_at = ? WHERE task_id = ?')
        .run(index === 1 ? 'closed' : 'active', index === 1 ? 'done' : null,
          (index === 0 ? 1 : index === 1 ? 3 : 2) * 1000, task.id);
      return task.id;
    });

    const origin = new TaskOriginRepository();
    expect(origin.list(conversation.key, 2, { order: 'recent' })).toMatchObject({
      total: 3, items: [{ id: ids[1] }, { id: ids[2] }],
    });
    expect(origin.list(conversation.key, 2, { order: 'recent', offset: 2 })).toMatchObject({
      total: 3, items: [{ id: ids[0] }],
    });
    expect(origin.list(conversation.key, 2).items.map(item => item.id)).toEqual([ids[2], ids[0]]);
  });

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
    expect(buildTaskRunMessage('Handle the source event', run.trigger, 'Use the linked brief and preserve all facts'))
      .toContain('<task_brief>\nUse the linked brief and preserve all facts\n</task_brief>');
  });

  it('does not mark an empty TaskRun as succeeded', () => {
    const { task, run, runs } = createRunningTask('empty-result');
    const coordinator = TaskRunCoordinator.start({
      runId: run.id,
      context: { taskId: task.id, conversationId: createConversation({ agentId: 'main' }).key,
        agentId: 'main', triggerKind: 'user' },
      fallbackObjective: contract.objective,
    });
    expect(coordinator).toBeDefined();
    coordinator!.finalize({ status: 'succeeded', summary: 'Message processed', assistantText: '' });
    expect(runs.require(run.id).status).toBe('failed');
    expect(runs.getReceipt(run.id)).toMatchObject({ failure: { code: 'empty_agent_run' } });
  });

  it('localizes system evidence and completion summaries for Chinese tasks', () => {
    const { task, run, runs } = createRunningTask('chinese-evidence', 'zh');
    const coordinator = TaskRunCoordinator.start({ runId: run.id,
      context: { taskId: task.id, conversationId: createConversation({ agentId: 'main' }).key, agentId: 'main', triggerKind: 'user' },
      fallbackObjective: contract.objective,
    })!;
    coordinator.capturePatch(2, 1);
    coordinator.capturePlan([{ title: 'Review API', status: 'completed' }]);
    coordinator.finalize({ status: 'succeeded', summary: 'Message processed', assistantText: '已完成。' });
    expect(runs.getReceipt(run.id)).toMatchObject({ summary: '消息已处理', evidence: expect.arrayContaining([
      expect.objectContaining({ title: '已应用变更', summary: '新增 2 处，删除 1 处' }),
      expect.objectContaining({ title: '计划项已完成：Review API', summary: '助手已完成此计划项。' }),
    ]) });
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

  it('records a final board result from the TaskRun receipt once', () => {
    const { service, task, run } = createRunningTask('receipt-board');
    expect(service.completeRun({ runId: run.id, expectedRunVersion: run.version, receipt }))
      .toMatchObject({ ok: true });
    expect(new TaskCollaborationRepository().list(task.id)).toMatchObject([
      { kind: 'result', body: 'Result', taskRunId: run.id },
    ]);
  });

  it('projects a failed run as failed and returns to queued when retried', () => {
    const { service, task, run } = createRunningTask('failed-then-retry');
    expect(new TaskReadModelProjector().get(task.id)).toMatchObject({
      task: { phase: 'active' }, operationalState: 'running',
    });
    const failed = service.completeRun({
      runId: run.id, expectedRunVersion: run.version,
      receipt: { ...receipt, status: 'failed', verification: { status: 'failed', checks: [] },
        completionVerdict: 'not_achieved', remainingWork: ['tests pass'] },
    });
    expect(failed).toMatchObject({ ok: true, model: {
      task: { phase: 'active' }, operationalState: 'failed',
      attention: [expect.objectContaining({ kind: 'verification_failed' })],
    } });
    const current = new TaskRepository().require(task.id);
    expect(service.execute({ taskId: task.id, expectedVersion: current.version,
      idempotencyKey: 'retry-failed', command: { type: 'start', executor: { kind: 'agent', agentId: 'main' } },
    })).toMatchObject({ ok: true, model: { operationalState: 'queued' } });
  });

  it('projects a cancelled run as cancelled without closing the task', () => {
    const { service, task, run } = createRunningTask('cancelled-run');
    expect(service.completeRun({ runId: run.id, expectedRunVersion: run.version,
      receipt: { ...receipt, status: 'cancelled', verification: { status: 'unverified', checks: [] },
        completionVerdict: 'not_achieved', remainingWork: ['tests pass'] },
    })).toMatchObject({ ok: true, model: {
      task: { phase: 'active' }, operationalState: 'cancelled',
    } });
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
    new DomainOutboxDispatcher().drain();
    const events = listAutomationEvents();
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
    new DomainOutboxDispatcher().drain();
    const events = listAutomationEvents();
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
    new DomainOutboxDispatcher().drain();
    const events = listAutomationEvents();
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
      idempotencyKey: 'signal-dependency', title: 'Dependency', priority: 'normal', contract: { ...contract, acceptancePolicy: 'manual' },
      dependencies: [], context: [], authorityGrants: [], activation: { mode: 'capture', phase: 'ready' },
    });
    const blocked = service.create({
      idempotencyKey: 'signal-blocked', title: 'Blocked task', priority: 'normal', contract,
      dependencies: [dependency.ok ? dependency.model.task.id : 'missing'], context: [], authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } },
    });
    expect(blocked).toMatchObject({ ok: false, reason: 'blocked' });
    if (!dependency.ok || blocked.ok || !blocked.model) return;
    const review = new TaskCriterionReviewRepository().set({
      task: dependency.model.task,
      expectedVersion: dependency.model.task.version,
      criterionIndex: 0,
      status: 'passed',
      actor: { kind: 'user', id: 'owner' },
    });
    expect(review?.status).toBe('passed');
    const closed = service.execute({
      taskId: dependency.model.task.id,
      expectedVersion: new TaskRepository().require(dependency.model.task.id).version,
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
    new DomainOutboxDispatcher().drain();

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
    new DomainOutboxDispatcher().drain();
    const events = listAutomationEvents();
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
    const dispatcher = new DomainOutboxDispatcher();
    expect(dispatcher.drain()).toBe(2);
    expect(dispatcher.drain()).toBe(0);
    const events = listAutomationEvents();
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
