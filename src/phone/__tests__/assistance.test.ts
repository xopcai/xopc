import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskCreateRequestSchema } from '@xopcai/gateway-contract';

import { ConfigSchema } from '../../config/schema.js';
import { AgentDefaultsSchema } from '../../agent-config/schema.js';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { ensureSessionRecord, resetSessionRecord } from '../../storage/sqlite/session-repository.js';
import { getSessionInputState, claimNextSessionInput, finishSessionInputRun, insertSessionInput } from '../../storage/sqlite/session-input-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { runWithEmbeddedExecutionSession } from '../../agent/embedded/execution-context.js';
import { createPhoneUseTool } from '../../agent/tools/phone-use-tool.js';
import { SessionInputCoordinator } from '../../gateway/service/session-input-coordinator.js';
import { phoneAssistance, pendingPhoneAssistance, queuePhoneAssistance, reconcilePhoneAssistance, consumePhoneAssistance, finishPhoneAssistance, cancelPhoneAssistance } from '../assistance.js';
import { TaskApplicationService } from '../../tasks/task-application-service.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { defineTaskContract } from '../../tasks/task-contract-definition.js';
import { completePhoneAssistanceFromUser, preparePhoneContinuation } from '../assistance-service.js';
import { PhoneRuntime } from '../runtime.js';
import { PhoneRepository } from '../repository.js';
import type { PhoneObservation } from '../contracts.js';

let folder: string;
let runtime: PhoneRuntime;
const owner = 'c539ac08-b201-4206-a3c0-a42c1484eada';
const config = ConfigSchema.parse({ phone: { enabled: true } });
const context = { config, agentId: 'main', modelRef: 'test/phone' };
let texts: string[];
let predict: ReturnType<typeof vi.fn>;
let execute: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  closeXopcDatabase(); folder = mkdtempSync(join(tmpdir(), 'xopc-phone-assistance-'));
  openXopcDatabase({ path: join(folder, 'xopc.db') });
  seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: 'chat/model' }, phoneUse: { primary: 'test/phone' } } }) });
  ensureSessionRecord(owner, folder, { agentId: 'main', sourceChannel: 'webchat' });
  texts = ['Login']; predict = vi.fn(async () => ({ kind: 'needsUser' as const, reason: 'Enter the verification code on the phone' })); execute = vi.fn();
  runtime = makeRuntime();
  const device = runtime.repository.save({ serial: 'test-phone', name: 'Test phone', enabled: true, appAccess: 'all', allowedApps: [] });
  runtime.repository.setDefault(device.id);
  await runtime.execute(owner, { op: 'open', mode: 'control' }, context);
});
afterEach(async () => { await runtime.shutdown(); closeXopcDatabase(); rmSync(folder, { recursive: true, force: true }); });
function makeRuntime() {
  return new PhoneRuntime(new PhoneRepository(), () => ({
    discover: async () => [{ serial: 'test-phone', name: 'Test phone', state: 'device', emulator: false }],
    observe: async (): Promise<PhoneObservation> => ({ frameId: randomUUID(), capturedAt: Date.now(), width: 100, height: 200,
      rotation: 0, package: 'test.app', frame: Buffer.from('private-screen-pixels'), elements: texts.map(text => ({ text, description: '', resourceId: 'title',
        bounds: [0, 0, 100, 100], clickable: true, password: false, focused: false })) }), execute,
  }), async () => ({ predict }));
}
async function suspend(runId = 'original-run') {
  const tool = createPhoneUseTool({ runtime, context: () => ({ ...context, owner }) });
  return runWithEmbeddedExecutionSession(owner, () => tool.execute('phone-call', { op: 'run', goal: 'Read Android version after login',
    expectText: 'Android version', constraints: ['Do not change settings'], budget: { maxActions: 8, maxModelRequests: 9, maxActiveDurationMs: 300000 } }), runId);
}
function coordinator(run: ConstructorParameters<typeof SessionInputCoordinator>[0]['execute']) {
  return new SessionInputCoordinator({ sessionExists: async () => true, execute: run,
    completePhone: wait => completePhoneAssistanceFromUser(wait, config, runtime),
    beforeExecute: input => preparePhoneContinuation(input, config, runtime), prepareAttachments: async () => undefined,
    prepareContexts: async () => [], steer: async () => false, emit: () => {} });
}
it('settles the tool, persists only the task checkpoint, and preserves the wait across a database reopen', async () => {
  expect((await suspend()).details).toMatchObject({ status: 'needs_user', assistanceId: expect.any(String) });
  const saved = phoneAssistance(owner)!;
  expect(saved.checkpoint).toMatchObject({ task: { goal: 'Read Android version after login', constraints: ['Do not change settings'] }, usage: { modelRequests: 1, actions: 0 } });
  const stored = JSON.stringify(saved);
  expect(stored).not.toContain('private-screen-pixels'); expect(stored).not.toContain('verification code');
  await runtime.shutdown(); closeXopcDatabase(); openXopcDatabase({ path: join(folder, 'xopc.db') }); runtime = makeRuntime();
  expect(pendingPhoneAssistance()).toHaveLength(1);
  const restored = await runtime.restoreAssistance(saved.checkpoint, context, undefined, saved.id);
  expect(restored).toMatchObject({ assistanceId: saved.id, status: 'needs_user', modelRequests: 1, task: { taskId: saved.checkpoint.task.taskId } });
  expect(execute).not.toHaveBeenCalled();
});
it('persists a main Agent request after a plain pause and restores it after restart', async () => {
  predict.mockResolvedValue({ kind: 'complete', summary: 'Inspect the current page' });
  await runtime.execute(owner, { op: 'run', goal: 'Verify login after manual inspection', constraints: ['Never enter credentials'] }, context);
  await runtime.execute(owner, { op: 'pause' }, context);
  expect(phoneAssistance(owner)).toBeUndefined();
  const tool = createPhoneUseTool({ runtime, context: () => ({ ...context, owner }) });
  const result = await runWithEmbeddedExecutionSession(owner, () => tool.execute('request', { op: 'request_user', reason: 'Inspect login on the phone' }), 'main-request');
  expect(result.details).toMatchObject({ status: 'needs_user', assistanceId: expect.any(String) });
  const saved = phoneAssistance(owner)!;
  expect(saved).toMatchObject({ status: 'open', originRunId: 'main-request', toolCallId: 'request', checkpoint: { task: { constraints: ['Never enter credentials'] } } });
  await runtime.shutdown(); closeXopcDatabase(); openXopcDatabase({ path: join(folder, 'xopc.db') }); runtime = makeRuntime();
  await runtime.restoreAssistance(saved.checkpoint, context, undefined, saved.id);
  expect(runtime.status(owner)).toMatchObject({ status: 'needs_user', assistanceId: saved.id, task: { taskId: saved.checkpoint.task.taskId } });
  expect(predict).toHaveBeenCalledOnce(); expect(execute).not.toHaveBeenCalled();
});
it('queues an early handback while the old run is closing and runs the original task exactly once', async () => {
  let release!: () => void;
  const closing = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  const run = vi.fn(async (input: { runId: string }) => {
    if (first) { first = false; await suspend(input.runId); await closing; return { status: 'suspended', summary: '' }; }
    const wait = phoneAssistance(owner)!;
    const tool = createPhoneUseTool({ runtime, context: () => ({ ...context, owner }) });
    const result = await runWithEmbeddedExecutionSession(owner, () => tool.execute('resumed-call', { op: 'run', goal: 'Continue' }), input.runId);
    expect(result.details).toMatchObject({ verified: true, task: { taskId: wait.checkpoint.task.taskId, constraints: ['Do not change settings'] }, modelRequests: 1 });
    return { status: 'ok', summary: '' };
  });
  const inputs = coordinator(run);
  await inputs.submit({ conversationId: owner, clientMessageId: 'original', content: 'Read Android version after login', delivery: 'next', origin: { type: 'channel', channel: 'webchat' } });
  await vi.waitFor(() => expect(phoneAssistance(owner)?.status).toBe('open'));
  const wait = phoneAssistance(owner)!;
  const report = runtime.status(owner)!;
  await runtime.liveControl(owner, report.sessionId, context, 'browser', { op: 'takeover', epoch: report.controlEpoch!, operationId: randomUUID() });
  texts = ['Android version', '15'];
  await runtime.liveControl(owner, report.sessionId, context, 'browser', { op: 'handback', epoch: runtime.status(owner)!.controlEpoch!, operationId: randomUUID() });
  inputs.resumePhone(owner, wait.id); inputs.resumePhone(owner, wait.id);
  expect(run).toHaveBeenCalledOnce(); expect(phoneAssistance(owner)?.status).toBe('queued');
  release(); await vi.waitFor(() => expect(phoneAssistance(owner)?.status).toBe('completed'));
  inputs.resumePhone(owner, wait.id); await inputs.drain(owner);
  expect(run).toHaveBeenCalledTimes(2); expect(predict).toHaveBeenCalledOnce(); expect(execute).not.toHaveBeenCalled();
});
it('recovers a queued continuation after restart with a fresh observation and the original budget', async () => {
  await suspend(); const saved = phoneAssistance(owner)!;
  queuePhoneAssistance(owner, saved.id);
  await runtime.shutdown(); closeXopcDatabase(); openXopcDatabase({ path: join(folder, 'xopc.db') }); runtime = makeRuntime(); texts = ['Android version', '15'];
  expect(reconcilePhoneAssistance()).toEqual([owner]);
  const run = vi.fn(async () => {
    expect(runtime.status(owner)).toMatchObject({ status: 'ready', controlOwner: 'agent', modelRequests: 1,
      task: { taskId: saved.checkpoint.task.taskId, budget: { maxActions: 8, maxModelRequests: 9 } } });
    return { status: 'ok', summary: '' };
  });
  await coordinator(run).drain(owner); expect(run).toHaveBeenCalledOnce(); expect(execute).not.toHaveBeenCalled();
});
it('completes assistance when a resumed Agent finishes with close and deduplicates later completion clicks', async () => {
  await suspend(); const saved = phoneAssistance(owner)!;
  const run = vi.fn(async (input: { runId: string }) => {
    const tool = createPhoneUseTool({ runtime, context: () => ({ ...context, owner }) });
    await runWithEmbeddedExecutionSession(owner, () => tool.execute('finished', { op: 'close' }), input.runId);
    expect(phoneAssistance(owner)?.status).toBe('resuming');
    return { status: 'ok', summary: 'Login inspected' };
  });
  const inputs = coordinator(run);
  inputs.resumePhone(owner, saved.id); await inputs.drain(owner);
  await vi.waitFor(() => expect(phoneAssistance(owner)?.status).toBe('completed'));
  inputs.resumePhone(owner, saved.id); await inputs.drain(owner);
  expect(run).toHaveBeenCalledOnce();
});
it('requires explicit user action after an interrupted continuation and rejects stale transcript requests', async () => {
  await suspend(); const saved = phoneAssistance(owner)!;
  const queued = queuePhoneAssistance(owner, saved.id);
  const input = claimNextSessionInput(owner, 'resume-run')!;
  expect(consumePhoneAssistance(input)).toBe(true);
  finishSessionInputRun(owner, 'resume-run', 'interrupted');
  expect(reconcilePhoneAssistance()).toEqual([]);
  expect(phoneAssistance(owner)?.status).toBe('open');
  expect(phoneAssistance(owner)?.queuedInputId).toBeUndefined();
  expect(phoneAssistance(owner)!.id).not.toBe(queued.id);
  expect(() => queuePhoneAssistance(owner, saved.id)).toThrow('changed');
  resetSessionRecord(owner, folder);
  expect(pendingPhoneAssistance()).toHaveLength(0);
  expect(() => queuePhoneAssistance(owner, phoneAssistance(owner)?.id ?? saved.id)).toThrow('changed');
});
it('does not execute when the device binding changed and keeps the task recoverable', async () => {
  await suspend(); const saved = phoneAssistance(owner)!;
  const device = runtime.repository.get(saved.checkpoint.report.deviceId);
  runtime.repository.save({ ...device, name: 'Changed phone' }, device.id);
  queuePhoneAssistance(owner, saved.id);
  const run = vi.fn(async () => ({ status: 'ok', summary: '' }));
  await coordinator(run).drain(owner);
  expect(run).not.toHaveBeenCalled(); expect(phoneAssistance(owner)?.status).toBe('open');
  expect(getSessionInputState(owner).activeRunId).toBeUndefined();
});

it('updates the durable budget during continuation and preserves it after another interruption', async () => {
  await suspend(); const saved = phoneAssistance(owner)!;
  queuePhoneAssistance(owner, saved.id);
  const input = claimNextSessionInput(owner, 'follow-up')!;
  await preparePhoneContinuation(input, config, runtime);
  expect(consumePhoneAssistance(input)).toBe(true);
  predict.mockResolvedValueOnce({ kind: 'action', action: { type: 'wait', durationMs: 1 } });
  await runtime.execute(owner, { op: 'step', goal: saved.checkpoint.task.goal, taskId: saved.checkpoint.task.taskId, maxActions: 1 }, context);
  await runtime.releaseConversation(owner);
  expect(phoneAssistance(owner)?.checkpoint.usage).toMatchObject({ actions: 1, modelRequests: 2 });
  expect(runtime.status(owner)).toMatchObject({ status: 'needs_user', task: { taskId: saved.checkpoint.task.taskId } });
  await runtime.shutdown(); closeXopcDatabase(); openXopcDatabase({ path: join(folder, 'xopc.db') }); runtime = makeRuntime();
  finishSessionInputRun(owner, 'follow-up', 'interrupted'); reconcilePhoneAssistance();
  const recovery = phoneAssistance(owner)!;
  expect(recovery.status).toBe('open');
  const restored = await runtime.restoreAssistance(recovery.checkpoint, context, undefined, recovery.id);
  expect(restored).toMatchObject({ actions: 1, modelRequests: 2, task: { budget: { maxModelRequests: 9 } } });
  expect(execute).toHaveBeenCalledOnce();
});

it('rolls back a completion when durable queue insertion fails', async () => {
  await suspend(); const saved = phoneAssistance(owner)!;
  getSqliteDatabase().exec("CREATE TEMP TRIGGER reject_phone_resume BEFORE INSERT ON session_inputs BEGIN SELECT RAISE(ABORT, 'queue unavailable'); END");
  expect(() => queuePhoneAssistance(owner, saved.id)).toThrow('queue unavailable');
  expect(phoneAssistance(owner)).toMatchObject({ id: saved.id, status: 'open' });
  expect(getSessionInputState(owner).inputs).toHaveLength(0);
});

it('coordinates a linked task run through waiting, continuation, recovery and cancellation', async () => {
  const created = new TaskApplicationService().create(TaskCreateRequestSchema.parse({ idempotencyKey: 'phone-linked-task', title: 'Read phone', body: 'Read phone', originConversationId: owner,
    contract: { ...defineTaskContract('Read phone'), acceptancePolicy: 'manual', outputDestinations: [] },
    activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } } }));
  if (!created.ok || !created.runId) throw new Error('Task fixture must start');
  const runs = new TaskRunRepository(); const initial = runs.get(created.runId)!;
  runs.setStatus({ runId: initial.id, expectedVersion: initial.version, from: ['queued'], to: 'running', actor: { kind: 'system' } });
  insertSessionInput({ id: 'task-original', conversationId: owner, clientMessageId: 'task-original', taskRunId: initial.id, content: 'Read phone',
    requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', origin: { type: 'channel', channel: 'webchat' } });
  claimNextSessionInput(owner, 'task-original-run'); await suspend('task-original-run');
  finishSessionInputRun(owner, 'task-original-run', 'suspended');
  expect(runs.get(initial.id)?.status).toBe('waiting');
  const wait = phoneAssistance(owner)!; queuePhoneAssistance(owner, wait.id);
  const input = claimNextSessionInput(owner, 'task-resume-run')!;
  await preparePhoneContinuation(input, config, runtime); expect(consumePhoneAssistance(input)).toBe(true);
  expect(runs.get(initial.id)?.status).toBe('running');
  finishPhoneAssistance(input, false);
  expect(runs.get(initial.id)?.status).toBe('waiting');
  expect(runs.listActiveWaits(initial.taskId)).toHaveLength(1);
  cancelPhoneAssistance(owner);
  expect(runs.get(initial.id)?.status).toBe('cancelled');
  expect(runs.listActiveWaits(initial.taskId)).toHaveLength(0);
});

it('treats an explicit login-completion message as the same user handback and queues one continuation', async () => {
  await suspend(); const report = runtime.status(owner)!;
  await runtime.liveControl(owner, report.sessionId, context, 'browser', { op: 'takeover', epoch: report.controlEpoch!, operationId: randomUUID() });
  texts = ['Android version', '15'];
  const run = vi.fn(async () => ({ status: 'ok', summary: '' })); const inputs = coordinator(run);
  const message = { conversationId: owner, clientMessageId: 'login-done', content: '我已登录，继续', delivery: 'next' as const, origin: { type: 'channel' as const, channel: 'webchat' } };
  await expect(inputs.submit(message)).rejects.toMatchObject({ code: 'PHONE_CONTROL_BUSY' });
  expect(phoneAssistance(owner)?.status).toBe('open');
  expect(run).not.toHaveBeenCalled();
  await runtime.liveControl(owner, report.sessionId, context, 'browser', { op: 'release', epoch: runtime.status(owner)!.controlEpoch!, operationId: randomUUID() });
  expect((await inputs.submit(message)).ok).toBe(true);
  await vi.waitFor(() => expect(phoneAssistance(owner)?.status).toBe('completed'));
  expect((await inputs.submit(message)).ok).toBe(true);
  expect(run).toHaveBeenCalledOnce(); expect(runtime.status(owner)?.controlOwner).toBe('agent');
  expect(execute).not.toHaveBeenCalled();
});

it.each(['继续', '我还没登录，继续', '登录需要多久'])('does not infer user handback from %s', async content => {
  await suspend(); const run = vi.fn(async () => ({ status: 'ok', summary: '' })); const inputs = coordinator(run);
  await inputs.submit({ conversationId: owner, clientMessageId: randomUUID(), content, delivery: 'next', origin: { type: 'channel', channel: 'webchat' } });
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  expect(phoneAssistance(owner)?.status).toBe('open');
  expect(runtime.status(owner)?.controlOwner).toBe('none');
});
