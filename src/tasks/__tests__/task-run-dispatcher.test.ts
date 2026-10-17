import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, ensureSessionRecord, appendTranscriptEntry } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { TaskApplicationService } from '../task-application-service.js';
import { TaskRunDispatcher } from '../task-run-dispatcher.js';
import { TaskRunRepository } from '../task-run-repository.js';
import { TaskContextRepository } from '../task-context-repository.js';
import { TaskRepository } from '../task-repository.js';
import { createDataBatchTool, withDataToolPermissions } from '../../agent/tools/dataBatch.js';
import { getDelegationScope, withDelegationScope } from '../../agent/orchestration/delegation-scope.js';
import { getEmbeddedExecutionSession, runWithEmbeddedExecutionSession } from '../../agent/embedded/execution-context.js';

const contract = { objective: 'Do work', expectedOutputs: [], acceptanceCriteria: [], constraints: [],
  approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'verified_auto' as const,
  outputDestinations: [] };

describe('TaskRunDispatcher', () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-dispatcher-'));
    resetXopcDatabaseSingletonForTest();
    seedTestDatabase(join(stateDir, 'xopc.db'));
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function queue(key: string, locale?: 'en' | 'zh') {
    const created = new TaskApplicationService().create({ idempotencyKey: key, title: key, locale,
      priority: 'normal', contract, dependencies: [], context: [], authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } } });
    if (!created.ok || !created.runId) throw new Error('Expected queued TaskRun');
    return created.runId;
  }

  it('starts initial and subsequently queued Tasks outside the caller tool scope', async () => {
    const search = { name: 'web_search', label: 'Search', description: 'Search', parameters: {},
      execute: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'Found' }], details: {} })) };
    const batch = createDataBatchTool(stateDir, () => new Set(['web_search']), { getTools: () => [search] });
    const runAgent = vi.fn(async () => {
      expect(getDelegationScope()).toBeUndefined();
      expect(getEmbeddedExecutionSession()).toBeUndefined();
      const result = await batch.execute('batch', { operations: [{ id: 's', kind: 'web_search', query: 'exhibitions' }] });
      expect(result.details).toMatchObject({ status: 'completed', sourceRequests: 1 });
    });
    const ensureSession = vi.fn(async () => {
      expect(getEmbeddedExecutionSession()).toBeUndefined();
      return 'target-conversation';
    });
    const dispatcher = new TaskRunDispatcher({ workerId: 'independent', maxConcurrency: 1, ensureSession, runAgent });
    await runWithEmbeddedExecutionSession('origin', () => withDelegationScope({ tools: [] }, () =>
      withDataToolPermissions(new Set(), async () => {
        queue('initial-independent');
        await dispatcher.drain();
        queue('later-independent');
        await dispatcher.drain();
        expect(getEmbeddedExecutionSession()).toBe('origin');
        expect(getDelegationScope()?.tools).toEqual([]);
      })));
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(search.execute).toHaveBeenCalledTimes(2);
  });

  it('clears orphan waits of an already cancelled Run after restart without changing a new Run or its waits', async () => {
    const oldId = queue('cancelled-orphan-waits');
    const runs = new TaskRunRepository();
    const old = runs.require(oldId);
    runs.finalize({ runId: old.id, expectedVersion: old.version, receipt: { status: 'cancelled', summary: 'Cancelled',
      changes: [], evidence: [], verification: { status: 'unverified', checks: [] }, remainingWork: [], needsUser: false, completionVerdict: 'not_achieved' } });
    const task = new TaskRepository().require(old.taskId);
    expect(new TaskApplicationService().execute({ taskId: task.id, expectedVersion: task.version, actor: { kind: 'user' },
      idempotencyKey: 'new-after-cancelled', command: { type: 'start', executor: { kind: 'agent', agentId: 'main' } } }).ok).toBe(true);
    const next = runs.getActiveRoot(task.id)!;
    // Model the residual rows written by a legacy process or a late wait writer.
    const first = runs.createWait({ taskId: task.id, taskRunId: old.id, kind: 'user_input', reason: 'Old question', condition: { type: 'fixture' } });
    const second = runs.createWait({ taskId: task.id, taskRunId: old.id, kind: 'user_input', reason: 'Old authorization', condition: { type: 'connection', connectionWaitId: 'old-orphan-connection' } });
    const current = runs.createWait({ taskId: task.id, taskRunId: next.id, kind: 'user_input', reason: 'New question', condition: { type: 'fixture' } });
    const oldReceipt = runs.getReceipt(old.id);
    const oldVersion = runs.require(old.id).version;
    closeXopcDatabase(); openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    expect(runs.reconcileCancelledRuns()).toBe(1);
    expect(runs.getWait(first.id)?.status).toBe('resolved');
    expect(runs.getWait(second.id)?.status).toBe('resolved');
    expect(runs.getWait(current.id)?.status).toBe('active');
    expect(runs.getReceipt(old.id)).toEqual(oldReceipt);
    expect(runs.require(old.id).version).toBe(oldVersion);
    expect(runs.getActiveRoot(task.id)).toEqual(next);
    expect(runs.reconcileCancelledRuns()).toBe(0);
    const runAgent = vi.fn(async (id: string) => {
      const run = runs.require(id);
      runs.finalize({ runId: run.id, expectedVersion: run.version, receipt: { status: 'succeeded', summary: 'New work',
        changes: [], evidence: [], verification: { status: 'passed', checks: [] }, remainingWork: [], needsUser: false, completionVerdict: 'achieved' } });
    });
    runs.resolveWait({ waitId: current.id, actor: { kind: 'user' } });
    const dispatcher = new TaskRunDispatcher({ workerId: 'restarted-worker', ensureSession: async () => 'new-conversation', runAgent });
    await dispatcher.drain(); await dispatcher.drain(); dispatcher.stop();
    expect(runAgent).toHaveBeenCalledOnce();
    expect(runAgent).toHaveBeenCalledWith(next.id, 'new-conversation', expect.any(String));
    expect(runs.require(old.id).status).toBe('cancelled');
  });

  it.each([false, true])('reconciles a legacy Task cancellation receipt before dispatch (leased=%s)', async leased => {
    const runId = queue('legacy-cancel');
    const runs = new TaskRunRepository();
    const run = runs.require(runId);
    const task = new TaskRepository().require(run.taskId);
    const closed = new TaskApplicationService().execute({ taskId: run.taskId, expectedVersion: task.version,
      actor: { kind: 'user' }, idempotencyKey: 'personal-cancel:legacy', command: { type: 'close', resolution: 'cancelled' } });
    expect(closed.ok).toBe(true);
    getSqliteDatabase().prepare(`UPDATE command_deduplication SET result_json = json_set(result_json, '$.cancellationRunId', ?)
      WHERE idempotency_key = 'personal-cancel:legacy'`).run(runId);
    getSqliteDatabase().prepare(`UPDATE task_runs SET status = 'running', lease_owner = ?, lease_expires_at = ?,
      policy_snapshot_json = '{}' WHERE run_id = ?`).run(leased ? 'old-worker' : null, leased ? Date.now()-1000 : null, runId);
    closeXopcDatabase(); openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    const runAgent = vi.fn(async () => {});
    const dispatcher = new TaskRunDispatcher({ workerId: 'restarted-worker', ensureSession: vi.fn(), runAgent });
    await dispatcher.drain(); await dispatcher.drain(); dispatcher.stop();
    expect(runs.require(runId).status).toBe('cancelled');
    expect(runs.getReceipt(runId)?.status).toBe('cancelled');
    expect(runs.reconcileCancelledRuns()).toBe(0);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('stops leases and database access when an active Agent later %ss', async (outcome) => {
    const runId = queue('shutdown');
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const runAgent = vi.fn(() => {
      const runs = new TaskRunRepository();
      const run = runs.require(runId);
      runs.setStatus({ runId, expectedVersion: run.version, from: ['queued'], to: 'running' });
      return pending;
    });
    const dispatcher = new TaskRunDispatcher({ workerId: 'test', maxConcurrency: 1,
      ensureSession: async () => 'conversation', runAgent });
    vi.useFakeTimers();
    const draining = dispatcher.drain();
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledOnce());
    const get = vi.spyOn(TaskRunRepository.prototype, 'get');
    const claimNext = vi.spyOn(TaskRunRepository.prototype, 'claimNext');
    const heartbeat = vi.spyOn(TaskRunRepository.prototype, 'heartbeat');
    dispatcher.stop();
    closeXopcDatabase();
    await vi.advanceTimersByTimeAsync(60_000);
    if (outcome === 'reject') fail(new Error('Agent interrupted during shutdown'));
    else finish();
    await draining;
    await dispatcher.drain();
    expect(get).not.toHaveBeenCalled();
    expect(claimNext).not.toHaveBeenCalled();
    expect(heartbeat).not.toHaveBeenCalled();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    expect(new TaskRunRepository().require(runId).status).toBe('running');
  });

  it('does not start an Agent if shutdown occurs while preparing its session', async () => {
    queue('preparing');
    let finish!: (conversationId: string) => void;
    const ensureSession = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const runAgent = vi.fn(async () => {});
    const dispatcher = new TaskRunDispatcher({ workerId: 'test', maxConcurrency: 1, ensureSession, runAgent });
    const draining = dispatcher.drain();
    expect(ensureSession).toHaveBeenCalledOnce();
    dispatcher.stop();
    closeXopcDatabase();
    finish('conversation');
    await draining;
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('executes two independent TaskRuns concurrently within its limit', async () => {
    queue('one'); queue('two');
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let peak = 0;
    const runAgent = vi.fn(async () => { active += 1; peak = Math.max(peak, active); await barrier; active -= 1; });
    const dispatcher = new TaskRunDispatcher({ workerId: 'test', maxConcurrency: 2,
      ensureSession: async (_taskId, runId) => runId, runAgent });
    const draining = dispatcher.drain();
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(2));
    expect(peak).toBe(2);
    release();
    await draining;
  });

  it.each(['en', 'zh'] as const)('finalizes an expired leased run with %s recovery instructions', async (locale) => {
    const runId = queue('interrupted', locale);
    const runs = new TaskRunRepository();
    const claimed = runs.claimNext({ owner: 'old-process', leaseMs: 60_000, executorKind: 'agent' })!;
    runs.setStatus({ runId, expectedVersion: claimed.version, from: ['queued'], to: 'running' });
    getSqliteDatabase().prepare('UPDATE task_runs SET lease_expires_at = ? WHERE run_id = ?')
      .run(Date.now() - 1, runId);
    const runAgent = vi.fn(async () => {});
    await new TaskRunDispatcher({ workerId: 'new-process', ensureSession: async () => 'unused', runAgent }).drain();
    expect(runAgent).not.toHaveBeenCalled();
    expect(runs.require(runId).status).toBe('failed');
    expect(runs.getReceipt(runId)?.failure?.code).toBe('execution_interrupted');
    expect(runs.getReceipt(runId)?.summary).toBe(locale === 'zh' ? '执行已中断；重试前请检查外部操作的影响' : 'Execution interrupted; verify external effects before retrying');
    expect(runs.getReceipt(runId)?.failure?.recoveryAction).toBe(locale === 'zh' ? '重试前检查执行影响' : 'Inspect effects before retrying');
  });

  it('renews a lease without invalidating the version held by a running Agent', () => {
    const runId = queue('long-running');
    const runs = new TaskRunRepository();
    const claimed = runs.claimNext({ owner: 'worker', leaseMs: 60_000, executorKind: 'agent' })!;
    const running = runs.setStatus({ runId, expectedVersion: claimed.version, from: ['queued'], to: 'running' })!;
    const renewed = runs.heartbeat({ runId, owner: 'worker', leaseMs: 60_000 })!;
    expect(renewed.version).toBe(running.version);
    const completed = new TaskApplicationService().completeRun({
      runId,
      expectedRunVersion: running.version,
      receipt: { status: 'succeeded', summary: 'Done', changes: [], evidence: [],
        verification: { status: 'unverified', checks: [] }, remainingWork: [], needsUser: false,
        completionVerdict: 'partial' },
    });
    expect(completed.ok).toBe(true);
    expect(runs.require(runId).status).toBe('succeeded');
  });

  it.each(['confirmed', 'missing', 'failed', 'cancelled'] as const)('recovers only confirmed operation outcomes after a process restart (%s)', async outcome => {
    const runId = queue('restart-safety');const runs = new TaskRunRepository();const conversationId = crypto.randomUUID();
    ensureSessionRecord(conversationId, stateDir, { agentId: 'main' });
    const claimed = runs.claimNext({ owner: 'dead-worker', leaseMs: 60_000 })!;
    const snapshot = new TaskContextRepository().captureSnapshot({ ownerKind: 'task_run', ownerId: runId, query: 'resume' });
    runs.start({ runId, expectedVersion: claimed.version, conversationId, contextSnapshotId: snapshot.id,
      policySnapshot: {}, timeoutAt: Date.now() + 60_000 });
    appendTranscriptEntry(conversationId, { role: 'user', content: 'Send once', timestamp: 1 });
    appendTranscriptEntry(conversationId, { role: 'assistant', content: [{ type: 'toolCall', id: 'effect', name: 'send_message', arguments: {} }], stopReason: 'toolUse', timestamp: 2 } as any);
    if (outcome !== 'missing') appendTranscriptEntry(conversationId, { role: 'toolResult', toolName: 'send_message', toolCallId: 'effect', content: [], isError: outcome === 'failed', timestamp: 3 } as any);
    if (outcome === 'cancelled') appendTranscriptEntry(conversationId, { role: 'assistant', content: [], stopReason: 'aborted', timestamp: 4 } as any);
    getSqliteDatabase().prepare('UPDATE task_runs SET lease_expires_at = ? WHERE run_id = ?').run(Date.now() - 1, runId);
    const runAgent = vi.fn(async () => {});
    const dispatcher = new TaskRunDispatcher({ workerId: 'new-worker', maxConcurrency: 1, ensureSession: async () => conversationId, runAgent });
    await dispatcher.drain();dispatcher.stop();
    if (outcome === 'confirmed') {
      expect(runAgent).toHaveBeenCalledOnce();
      expect(runs.require(runId)).toMatchObject({ status: 'running', policySnapshot: { continuationAttempts: 1 } });
    } else {
      expect(runAgent).not.toHaveBeenCalled();expect(runs.require(runId).status).toBe('failed');
      expect(runs.getReceipt(runId)?.needsUser).toBe(true);
    }
  });

  it('bounds continuation attempts and preserves the original deadline', () => {
    const runId = queue('continuation-budget');const runs = new TaskRunRepository();const conversationId = crypto.randomUUID();
    ensureSessionRecord(conversationId, stateDir, { agentId: 'main' });
    const queued = runs.require(runId);const snapshot = new TaskContextRepository().captureSnapshot({ ownerKind: 'task_run', ownerId: runId, query: 'resume' });
    const deadline = Date.now() + 60_000;
    runs.start({ runId, expectedVersion: queued.version, conversationId, contextSnapshotId: snapshot.id, policySnapshot: {}, timeoutAt: deadline });
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = runs.require(runId);
      expect(runs.scheduleContinuation({ runId, expectedVersion: current.version, reason: 'acceptance_incomplete', message: 'Finish remaining criteria' })).toBe(attempt < 2);
      expect(runs.require(runId).timeoutAt).toBe(deadline);
      if (attempt < 2) { const waiting = runs.require(runId);runs.setStatus({ runId, expectedVersion: waiting.version, from: ['waiting'], to: 'running' }); }
    }
    expect(runs.listByTask(queued.taskId)).toHaveLength(1);
    const current = runs.require(runId);
    expect(runs.scheduleContinuation({ runId, expectedVersion: current.version, reason: 'model_failure', message: 'resume', now: deadline + 1 })).toBe(false);
  });
});
