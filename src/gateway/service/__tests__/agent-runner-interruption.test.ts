import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskCreateRequestSchema } from '@xopcai/gateway-contract';

import type { RunGatewayAgentDeps } from '../run-gateway-agent.js';

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../run-gateway-agent.js', () => ({ runGatewayAgent: mocks.run }));

import { GatewayAgentRunner } from '../agent-runner.js';
import { acquireEmbeddedRunLease, type EmbeddedRunLease } from '../../../agent/embedded/runs.js';
import { seedTestDatabase } from '../../../../test/sqlite-fixture.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { ensureSessionRecord } from '../../../storage/sqlite/session-repository.js';
import { claimNextSessionInput, finishSessionInputRun, insertSessionInput, getSessionInputState } from '../../../storage/sqlite/session-input-repository.js';
import { requireSessionConnection, getConnectionWait, queueConnectionResolution, updateConnectionWait, publishConnectionWait, consumeConnectionResume, cancelConnectionObjective } from '../../../storage/sqlite/connection-wait-repository.js';
import { resolveConnectionCandidate } from '../../../connectors/connection-candidates.js';
import { TaskApplicationService } from '../../../tasks/task-application-service.js';
import { TaskRunRepository } from '../../../tasks/task-run-repository.js';
import { defineTaskContract } from '../../../tasks/task-contract-definition.js';
import { describeActiveExecution } from '../active-execution.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { TaskRunDispatcher } from '../../../tasks/task-run-dispatcher.js';

describe('GatewayAgentRunner interrupted consumption', () => {
  it.each(['immediate', 'unleased', 'leased', 'dispatcher-first'] as const)('reconciles a cancelled consumed recovery after restart (%s)', async mode => {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-cancel-restart-'));
    const key = 'e1a1e856-b952-41bc-b66b-d8a7aa54143f';
    resetXopcDatabaseSingletonForTest(); seedTestDatabase(join(directory, 'xopc.db')); openXopcDatabase({ path: join(directory, 'xopc.db') });
    let runner: GatewayAgentRunner | undefined;
    try {
      ensureSessionRecord(key, directory, { agentId: 'main', sourceChannel: 'webchat' });
      const task = new TaskApplicationService().create(TaskCreateRequestSchema.parse({ idempotencyKey: 'restart-task',
        title: 'Read Slack', body: 'Read Slack', originConversationId: key,
        contract: { ...defineTaskContract('Read Slack'), acceptancePolicy: 'manual', outputDestinations: [] },
        activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } } }));
      if (!task.ok || !task.runId) throw new Error('Fixture must start');
      insertSessionInput({ id: 'restart-origin', conversationId: key, clientMessageId: 'restart-origin', taskRunId: task.runId,
        content: 'Read Slack', requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', origin: { type: 'channel', channel: 'webchat' } });
      claimNextSessionInput(key, 'restart-origin-run');
      const result = requireSessionConnection({ conversationId: key, principalId: 'local-owner', agentId: 'main',
        summary: 'Read Slack', needs: [resolveConnectionCandidate('composio-slack')] });
      finishSessionInputRun(key, 'restart-origin-run', 'suspended');
      const wait = getConnectionWait(result.waitId!)!;
      queueConnectionResolution(updateConnectionWait({ ...wait, intent: { objectiveRevision: wait.objectiveRevision, validUntil: Date.now()+60_000 } }, wait.version), 'continued');
      const input = claimNextSessionInput(key, 'restart-recovery-run')!;
      expect(consumeConnectionResume(input)).toBe(true);
      if (mode === 'immediate') {
        cancelConnectionObjective(key, wait.id, wait.objectiveRevision);
        expect(new TaskRunRepository().get(task.runId)?.status).toBe('cancelled');
      } else {
        // Legacy gateways persisted the cancelled wait before finalizing the running Run.
        const current = getConnectionWait(wait.id)!;
        updateConnectionWait({ ...current, status: 'closed', resolution: 'cancelled', intent: undefined }, current.version);
        if (mode !== 'unleased') getSqliteDatabase().prepare(`UPDATE task_runs SET conversation_id = ?, lease_owner = 'old-worker',
          lease_expires_at = ?, policy_snapshot_json = '{}', retry_policy_json = json_set(retry_policy_json, '$.maxAttempts', 2) WHERE run_id = ?`).run(key, Date.now()-1000, task.runId);
        const runs = new TaskRunRepository();
        const old = runs.require(task.runId);
        expect(runs.scheduleContinuation({ runId: old.id, expectedVersion: old.version, message: 'Do not run', reason: 'process_restart' })).toBe(false);
      }
      insertSessionInput({ id: 'cancel-control', conversationId: key, clientMessageId: 'cancel-control', content: '取消这个目标',
        expectedTranscriptId: wait.transcriptId, requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued',
        origin: { type: 'channel', channel: 'webchat' }, payload: { waitId: wait.id, objectiveRevision: wait.objectiveRevision, connectionAction: 'cancel' } });
      closeXopcDatabase(); openXopcDatabase({ path: join(directory, 'xopc.db') });
      mocks.run.mockClear();
      const rerun = vi.fn(async () => {});
      const dispatcher = new TaskRunDispatcher({ workerId: 'restarted-worker', ensureSession: async () => key, runAgent: rerun });
      if (mode === 'dispatcher-first') await dispatcher.drain();
      runner = new GatewayAgentRunner({ getConfig: () => ({}), getAgentService: () => ({}), emit: () => {}, publishRealtime: () => {} } as never);
      runner.recoverSessionInputs(); await runner.inputs.waitForCompletion(key, 'cancel-control'); await runner.inputs.drain(key);
      await dispatcher.drain(); dispatcher.stop();
      expect(new TaskRunRepository().get(task.runId)?.status).toBe('cancelled');
      expect(getConnectionWait(wait.id)?.resolution).toBe('cancelled');
      expect(getSessionInputState(key).activeRunId).toBeUndefined();
      expect(rerun).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
      expect(new TaskRunRepository().reconcileCancelledRuns()).toBe(0);
      const tasks = new TaskApplicationService();
      const latestTask = task.model.task;
      expect(tasks.execute({ taskId: latestTask.id, expectedVersion: latestTask.version, actor: { kind: 'user' },
        idempotencyKey: 'restart-new-goal', command: { type: 'start', executor: { kind: 'agent', agentId: 'main' } } }).ok).toBe(true);
      const next = new TaskRunRepository().getActiveRoot(latestTask.id)!;
      expect(new TaskRunRepository().reconcileCancelledRuns()).toBe(0);
      expect(new TaskRunRepository().getActiveRoot(latestTask.id)).toEqual(next);
    } finally { runner?.disposeClarifications(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true }); }
  });
  it.each(['late', 'reject'] as const)('stops a Task recovery and delivers the next message when SDK acknowledgement is %s', async acknowledgement => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-task-cancel-'));
    const key = 'e1a1e856-b952-41bc-b66b-d8a7aa54143f';
    let releaseAck!: () => void;
    const ack = new Promise<void>(resolve => { releaseAck = resolve; });
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
    const sdkStop = vi.fn();
    let releaseNext!: () => void;
    const nextGate = new Promise<void>(resolve => { releaseNext = resolve; });
    let controller: AbortController | undefined;
    let nextLease: EmbeddedRunLease | undefined;
    let runner: GatewayAgentRunner | undefined;
    const calls: string[] = [];
    resetXopcDatabaseSingletonForTest();
    seedTestDatabase(join(dir, 'xopc.db'));
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    try {
      ensureSessionRecord(key, dir, { agentId: 'main', sourceChannel: 'webchat' });
      const created = new TaskApplicationService().create(TaskCreateRequestSchema.parse({ idempotencyKey: 'cancel-recovery-task',
        title: 'Read Slack', body: 'Read Slack', originConversationId: key,
        contract: { ...defineTaskContract('Read Slack'), acceptancePolicy: 'manual', outputDestinations: [] },
        activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } } }));
      if (!created.ok || !created.runId) throw new Error('Task fixture must start');
      insertSessionInput({ id: 'task-original', conversationId: key, clientMessageId: 'task-original', taskRunId: created.runId,
        content: 'Read Slack', requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', origin: { type: 'channel', channel: 'webchat' } });
      claimNextSessionInput(key, 'task-original-run');
      const required = requireSessionConnection({ conversationId: key, principalId: 'local-owner', agentId: 'main',
        summary: 'Read Slack', needs: [resolveConnectionCandidate('composio-slack')] });
      finishSessionInputRun(key, 'task-original-run', 'suspended');
      const initial = getConnectionWait(required.waitId!)!;
      const wait = updateConnectionWait({ ...initial, intent: { objectiveRevision: initial.objectiveRevision, validUntil: Date.now() + 60_000 } }, initial.version);
      mocks.run.mockImplementation(async function* (deps: RunGatewayAgentDeps, content: string, _channel: string, conversationId: string,
        origin: Parameters<typeof describeActiveExecution>[0]['origin'], _attachments: unknown, _thinking: unknown,
        options: { runId: string; taskRunId?: string }) {
        calls.push(content);
        const current = new AbortController();
        deps.runAbortControllers.set(options.runId, current);
        deps.activeWebchatRunBySession.set(conversationId, options.runId);
        deps.activeExecutionBySession.set(conversationId, describeActiveExecution({ conversationId, runId: options.runId, taskRunId: options.taskRunId, origin }));
        const lease = acquireEmbeddedRunLease({ conversationId, transcriptId: wait.transcriptId, runId: options.runId });
        try {
          if (options.taskRunId) {
            controller = current;
            await lease.attach({} as never, async () => {
              sdkStop();
              releaseCleanup();
              if (acknowledgement === 'reject') throw new Error('SDK stop failed');
              await ack;
            });
            await new Promise<void>(resolve => current.signal.addEventListener('abort', () => resolve(), { once: true }));
          } else { nextLease = lease; await nextGate; }
          yield { type: 'assistant_delta', payload: { delta: 'Done' } };
          return { status: options.taskRunId ? 'aborted' : 'ok', summary: '' };
        } finally {
          if (options.taskRunId) await cleanup;
          lease.release();
          deps.runAbortControllers.delete(options.runId);
          if (deps.activeWebchatRunBySession.get(conversationId) === options.runId) {
            deps.activeWebchatRunBySession.delete(conversationId);
            deps.activeExecutionBySession.delete(conversationId);
          }
        }
      });
      runner = new GatewayAgentRunner({ getConfig: () => ({}), emit: () => {}, publishRealtime: () => {},
        getAgentService: () => ({ prepareInboundAttachments: async () => [], sessionStore: { idleCompaction: { interrupt: () => {} } } }),
        sessionIndex: { getSessionMetadata: async () => ({}), appendTranscriptContextEntry: async () => {} } } as never);
      const abort = vi.spyOn(runner, 'abortAgentRun');
      queueConnectionResolution(wait, 'continued');
      publishConnectionWait(key);
      void runner.inputs.drain(key);
      await vi.waitFor(() => expect(controller).toBeDefined());
      const send = (content: string) => runner!.submitSessionInput({ conversationId: key, clientMessageId: content,
        content, delivery: 'next', origin: { type: 'channel', channel: 'webchat' } });
      await send('取消这个目标');
      await send('Another question');
      await vi.waitFor(() => expect(nextLease).toBeDefined());
      expect(controller!.signal.aborted).toBe(true);
      expect(abort).toHaveBeenCalledOnce();
      expect(sdkStop).toHaveBeenCalledOnce();
      expect(getConnectionWait(wait.id)?.resolution).toBe('cancelled');
      expect(new TaskRunRepository().get(created.runId)?.status).toBe('cancelled');
      releaseAck();
      await vi.waitFor(() => expect(nextLease!.signal.aborted).toBe(false));
      releaseNext();
      await vi.waitFor(() => expect(getSessionInputState(key).activeRunId).toBeUndefined());
      runner.recoverSessionInputs();
      await runner.inputs.drain(key);
      expect(calls).toHaveLength(2);
      expect(calls[1]).toBe('Another question');
    } finally {
      releaseAck(); releaseNext(); releaseCleanup();
      if (runner) {
        await vi.waitFor(() => expect(getSessionInputState(key).activeRunId).toBeUndefined());
        runner.disposeClarifications();
      }
      closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true });
    }
  });
  it('does not cancel a new embedded run when the old run exits before asynchronous abort dispatch', async () => {
    const key = 'gateway-late-abort-review';
    const old = acquireEmbeddedRunLease({ conversationId: key, transcriptId: 'transcript', runId: 'old-run' });
    let next: EmbeddedRunLease | undefined;
    mocks.run.mockImplementation(async function* (deps: RunGatewayAgentDeps) {
      const controller = new AbortController();
      deps.runAbortControllers.set('old-run', controller);
      deps.activeWebchatRunBySession.set(key, 'old-run');
      controller.signal.addEventListener('abort', () => {
        old.release();
        next = acquireEmbeddedRunLease({ conversationId: key, transcriptId: 'transcript', runId: 'new-run' });
      });
      yield { type: 'assistant_delta', payload: { delta: 'Working' } };
      return { status: 'ok', summary: '' };
    });
    const runner = new GatewayAgentRunner({ getConfig: () => ({}), getAgentService: () => ({}),
      sessionIndex: { appendTranscriptContextEntry: async () => {} } } as never);
    const stream = runner.runAgent('hello', 'webchat', key, { type: 'channel', channel: 'webchat' });
    try {
      await stream.next();
      await runner.abortAgentRun('old-run');
      expect(next).toBeDefined();
      expect(next!.signal.aborted).toBe(false);
    } finally {
      await stream.return({ status: 'ok', summary: '' });
      old.release(); next?.release();
    }
  });
  it('awaits inner cleanup and releases the active session when the consumer stops early', async () => {
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => { release = resolve; });
    let cleaning = false;
    const key = 'agent:main:webchat:default:direct:voice';
    mocks.run.mockImplementation(async function* (deps: RunGatewayAgentDeps) {
      deps.activeWebchatRunBySession.set(key, 'run');
      try {
        yield { type: 'assistant_delta', payload: { delta: 'Hello.' } };
        yield { type: 'assistant_delta', payload: { delta: 'Late.' } };
      } finally {
        cleaning = true;
        await cleanup;
        deps.activeWebchatRunBySession.delete(key);
      }
      return { status: 'ok', summary: '' };
    });
    const runner = new GatewayAgentRunner({ getConfig: () => ({}), getAgentService: () => ({}) } as never);
    const stream = runner.runAgent('hello', 'webchat', key, { type: 'channel', channel: 'webchat' });
    await stream.next();
    expect(runner.hasActiveRun(key)).toBe(true);
    let stopped = false;
    const stopping = stream.return({ status: 'aborted', summary: '' }).then(() => { stopped = true; });
    try {
      await vi.waitFor(() => expect(cleaning).toBe(true));
      expect(stopped).toBe(false);
    } finally { release(); }
    await stopping;
    expect(runner.hasActiveRun(key)).toBe(false);
  });
});
