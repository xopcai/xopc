import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationRunMutationOutputSchema } from '@xopcai/gateway-contract';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { createProductDispatcher } from '../../capabilities/runtime/product.js';
import type { CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { AutomationService } from '../service/automation-service.js';
import { getAutomationRunRequest, saveAutomationRun, markAutomationRunRead } from '../storage/index.js';
import { createAutomationTool } from '../../agent/tools/automation-tool.js';
import { createXopcUseTool } from '../../agent/tools/xopc-use-tool.js';

let directory: string;
let service: AutomationService;
const caller: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: ['automations.write'], authorize: () => true };
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'xopc-automation-runs-'));
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(directory, 'xopc.db') });
  service = new AutomationService();
});
afterEach(async () => {
  await service.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
  closeXopcDatabase();
  resetXopcDatabaseSingletonForTest();
  rmSync(directory, { recursive: true, force: true });
});
async function fixture() {
  const automation = await service.create({ name: 'Safe fixture', trigger: { kind: 'manual' },
    action: { kind: 'workflow', workflowId: 'not-executed' }, safety: { mode: 'suggest_only' }, delivery: { notificationPolicy: 'none' } });
  const dispatcher = createProductDispatcher(undefined, { getAutomations: () => service });
  const invoke = (id: string, key: string, command = 'run', context = caller) => {
    const operation = `xopc.automations.${command}`;
    return dispatcher.call(operation, { id }, context, { ...dispatcher.describe(operation, context), idempotencyKey: key });
  };
  return { automation, dispatcher, invoke };
}
async function completed(runId: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const run = await service.getRun(runId);
    if (run && !['queued', 'running', 'cancelling'].includes(run.status)) return run;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Run did not complete');
}

describe('automation execution capabilities', () => {
  it('reads current run state and events after cancellation, including after automation deletion', async () => {
    const { automation, dispatcher } = await fixture();
    const run = service.queueRunAtomically(automation.id);
    await service.cancelRun(run.id);
    await service.remove(automation.id);
    const reader = { ...caller, scopes: ['automations.read'] };
    expect(await dispatcher.call('xopc.automations.get_run', { id: run.id }, reader)).toMatchObject({ run: { id: run.id, status: 'cancelled' } });
    const events = await dispatcher.call('xopc.automations.run_events', { id: run.id }, reader);
    expect(events).toMatchObject({ events: await service.listRunEvents(run.id) });
    await expect(dispatcher.call('xopc.automations.get_run', { id: 'missing' }, reader)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(dispatcher.call('xopc.automations.run_events', { id: 'missing' }, reader)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const get = vi.spyOn(service, 'getRun');
    get.mockClear();
    await expect(dispatcher.call('xopc.automations.get_run', { id: run.id }, { ...reader, authorize: () => false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(get).not.toHaveBeenCalled();
  });

  it('filters original product events and rejects partial filters and invalid limits', async () => {
    const { automation, dispatcher } = await fixture();
    const run = service.queueRunAtomically(automation.id, { manual: false, event: {
      type: 'fixture.changed', source: 'test', payload: { taskId: 'task-1', empty: '' }, occurredAtMs: Date.now(),
    } });
    const reader = { ...caller, scopes: ['automations.read'] };
    const operation = 'xopc.automations.product_events';
    const input = { eventType: 'fixture.changed', source: 'test', payloadKey: 'taskId', payloadValue: 'task-1' };
    expect(await dispatcher.call(operation, input, reader)).toMatchObject({ items: [{ run: { id: run.id }, triggerEvent: { type: 'run.queued' } }] });
    expect(await dispatcher.call(operation, { ...input, payloadValue: 'other' }, reader)).toEqual({ ok: true, items: [] });
    expect(await dispatcher.call(operation, { ...input, payloadKey: 'empty', payloadValue: '' }, reader)).toMatchObject({ items: [{ run: { id: run.id } }] });
    for (const invalid of [{ ...input, payloadValue: undefined }, { ...input, limit: 1.5 }, { ...input, limit: 101 }]) {
      await expect(dispatcher.call(operation, invalid, reader)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('shares diagnostic results across both agent tools and dispatcher without starting work', async () => {
    const { automation, dispatcher } = await fixture();
    const run = service.queueRunAtomically(automation.id);
    const deps = { getAutomationService: () => service };
    const direct = createAutomationTool(deps);
    const unified = createXopcUseTool(deps);
    for (const action of ['get_run', 'run_events', 'metrics', 'events', 'deliveries', 'product_events'] as const) {
      const args = action === 'product_events' ? { eventType: 'unknown' }
        : action === 'metrics' || action === 'events' ? {}
        : { runId: run.id };
      const result = await direct.execute(action, { action, ...args });
      expect((await unified.execute(action, { mode: 'automation', command: action, args })).details.result).toEqual(result.details);
    }
    const reader = { ...caller, scopes: ['automations.read'] };
    const list = await direct.execute('list', { action: 'list' });
    expect(await dispatcher.call('xopc.automations.list', {}, reader)).toMatchObject({ items: list.details.automations });
    const history = await direct.execute('history', { action: 'history', automationId: automation.id });
    expect(await dispatcher.call('xopc.automations.history', { automationId: automation.id }, reader)).toMatchObject({ items: history.details.runs });
    expect(await service.getRun(run.id)).toMatchObject({ status: 'queued' });
  });

  it('signals a local running executor only after accepting cancellation', async () => {
    const { automation, invoke } = await fixture();
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    service.setDeps({ agentService: { turnDispatcher: {
      processDirect: async (_message, _conversationId, _origin, _attachments, _thinking, options) => {
        signal = options?.signal;
        started();
        await new Promise<void>(resolve => {
          if (signal?.aborted) resolve();
          else signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return '';
      },
    } } });
    await service.update(automation.id, { action: { kind: 'agent', instruction: 'Local fixture', timeoutSeconds: 5 }, safety: { mode: 'auto_apply' } });
    const run = await service.runNow(automation.id);
    await ready;
    const receipt = await invoke(run.id, 'live-cancel', 'cancel');
    expect(receipt).toEqual({ ok: true, cancelled: true, confirmed: false });
    expect(signal?.aborted).toBe(true);
    expect(await completed(run.id)).toMatchObject({ status: 'cancelled', termination: { cancellationConfirmed: true } });
    expect(await invoke(run.id, 'live-cancel', 'cancel')).toEqual(receipt);
  });

  it('commits cancellation before signalling and replays without duplicate events', async () => {
    const { automation, invoke } = await fixture();
    const run = service.queueRunAtomically(automation.id);
    saveAutomationRun({ ...run, status: 'running' });
    const dispatch = vi.spyOn(service, 'dispatchCancellation').mockImplementationOnce(() => {
      getSqliteDatabase().exec('BEGIN');
      getSqliteDatabase().exec('ROLLBACK');
      throw new Error('Interrupted signal');
    });
    await expect(invoke(run.id, 'cancel', 'cancel')).rejects.toThrow('Interrupted signal');
    expect(await service.getRun(run.id)).toMatchObject({ status: 'cancelling' });
    const receipt = await invoke(run.id, 'cancel', 'cancel');
    expect(receipt).toEqual({ ok: true, cancelled: true, confirmed: false });
    expect(await invoke(run.id, 'another-key', 'cancel')).toEqual(receipt);
    expect((await service.listRunEvents(run.id)).filter(event => event.type === 'run.cancel_requested')).toHaveLength(1);
    await expect(invoke(run.id, 'cancel', 'cancel', { ...caller, authorize: () => false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it('confirms queued cancellation and cannot cancel a later run by replay', async () => {
    const { automation, invoke } = await fixture();
    const run = service.queueRunAtomically(automation.id);
    const receipt = await invoke(run.id, 'cancel', 'cancel');
    expect(receipt).toEqual({ ok: true, cancelled: true, confirmed: true });
    const next = service.queueRunAtomically(automation.id);
    expect(await invoke(run.id, 'cancel', 'cancel')).toEqual(receipt);
    expect(await service.getRun(next.id)).toMatchObject({ status: 'queued' });
    expect(await invoke(run.id, 'new-intent', 'cancel')).toEqual({ ok: true, cancelled: false, confirmed: false });
  });

  it('rolls cancellation state and events back when output validation fails', async () => {
    const { automation, invoke } = await fixture();
    const run = service.queueRunAtomically(automation.id);
    const cancel = service.cancelRunAtomically.bind(service);
    vi.spyOn(service, 'cancelRunAtomically').mockImplementation(id => ({ ...cancel(id), confirmed: 'invalid' } as never));
    const dispatch = vi.spyOn(service, 'dispatchCancellation');
    await expect(invoke(run.id, 'invalid-cancel', 'cancel')).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(await service.getRun(run.id)).toMatchObject({ status: 'queued' });
    expect((await service.get(automation.id))?.state.runningRunId).toBe(run.id);
    expect((await service.listRunEvents(run.id)).map(event => event.type)).toEqual(['run.queued']);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('preserves the first read timestamp and excludes future completions from batch replay', async () => {
    const { automation, invoke, dispatcher } = await fixture();
    const first = service.queueRunAtomically(automation.id);
    await service.cancelRun(first.id);
    expect(markAutomationRunRead(first.id, 123)).toBe(true);
    expect(await invoke(first.id, 'read', 'read')).toEqual({ ok: true, marked: true });
    expect((await service.getRun(first.id))?.readAtMs).toBe(123);
    const batch = () => dispatcher.call('xopc.automations.read_all', {}, caller,
      { ...dispatcher.describe('xopc.automations.read_all', caller), idempotencyKey: 'batch' });
    expect(await batch()).toEqual({ ok: true, count: 0 });
    const later = service.queueRunAtomically(automation.id);
    await expect(invoke(later.id, 'unfinished', 'read')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await service.cancelRun(later.id);
    expect(await batch()).toEqual({ ok: true, count: 0 });
    expect((await service.getRun(later.id))?.readAtMs).toBeUndefined();
    expect(await invoke(later.id, 'unfinished', 'read')).toEqual({ ok: true, marked: true });
  });

  it('does not rearm a timer for a schedule already reserved by queued work', async () => {
    vi.useFakeTimers();
    await service.initialize();
    const backgroundTimers = vi.getTimerCount();
    const automation = await service.create({ name: 'Scheduled', trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMs: 1000 } },
      action: { kind: 'workflow', workflowId: 'not-executed' }, safety: { mode: 'suggest_only' } });
    expect(vi.getTimerCount()).toBe(backgroundTimers + 1);
    service.queueRunAtomically(automation.id);
    service.refreshSchedule();
    expect(vi.getTimerCount()).toBe(backgroundTimers);
  });

  it('commits before dispatch, retries a failed wake, and replays without starting another execution', async () => {
    const { automation, invoke } = await fixture();
    const dispatch = vi.spyOn(service, 'dispatchQueuedRun').mockImplementationOnce(() => {
      getSqliteDatabase().exec('BEGIN');
      getSqliteDatabase().exec('ROLLBACK');
      throw new Error('Wake interrupted');
    });
    await expect(invoke(automation.id, 'run')).rejects.toThrow('Wake interrupted');
    const runs = await service.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('queued');
    const receipt = await invoke(automation.id, 'run');
    expect(receipt).toMatchObject({ run: { id: runs[0].id, status: 'queued' } });
    expect(await completed(runs[0].id)).toMatchObject({ status: 'succeeded' });
    expect(await invoke(automation.id, 'run', 'run', { ...caller, surface: 'agent' })).toEqual(receipt);
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect((await service.listRunEvents(runs[0].id)).filter(event => event.type === 'run.started')).toHaveLength(1);
    await expect(invoke(automation.id, 'run', 'run', { ...caller, authorize: () => false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rolls back run, snapshot, ownership and events when output validation fails', async () => {
    const { automation, invoke } = await fixture();
    const queue = service.queueRunAtomically.bind(service);
    vi.spyOn(service, 'queueRunAtomically').mockImplementation((id, opts) => ({ ...queue(id, opts), status: 'invalid' } as never));
    const dispatch = vi.spyOn(service, 'dispatchQueuedRun');
    await expect(invoke(automation.id, 'invalid')).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(await service.listRuns()).toEqual([]);
    expect((await service.get(automation.id))?.state.runningRunId).toBeUndefined();
    expect(getSqliteDatabase().prepare('SELECT * FROM automation_run_requests').all()).toEqual([]);
    expect(getSqliteDatabase().prepare('SELECT * FROM automation_run_events').all()).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('recovers queued work using the committed safety snapshot, not later configuration', async () => {
    const { automation, invoke } = await fixture();
    vi.spyOn(service, 'dispatchQueuedRun').mockImplementation(() => {});
    const receipt = AutomationRunMutationOutputSchema.parse(await invoke(automation.id, 'queued'));
    await service.update(automation.id, { safety: { mode: 'auto_apply' }, name: 'Later config' });
    expect(getAutomationRunRequest(receipt.run.id)).toMatchObject({ safety: { mode: 'suggest_only' }, name: 'Safe fixture' });
    const startWorkflowRun = vi.fn();
    await service.stop();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    service = new AutomationService();
    service.setDeps({ workflowRunService: { startWorkflowRun } as never });
    await service.initialize();
    expect(await completed(receipt.run.id)).toMatchObject({ status: 'succeeded', summary: expect.stringContaining('Suggest only') });
    expect(startWorkflowRun).not.toHaveBeenCalled();
  });

  it('never automatically repeats a claimed run after a crash', async () => {
    const { automation } = await fixture();
    const run = service.queueRunAtomically(automation.id);
    getSqliteDatabase().prepare("UPDATE automation_runs SET status = 'running' WHERE run_id = ?").run(run.id);
    await service.initialize();
    expect(await service.getRun(run.id)).toMatchObject({ status: 'failed', termination: { cancellationConfirmed: false } });
    service.dispatchQueuedRun(run.id);
    expect((await service.listRunEvents(run.id)).some(event => event.type === 'run.started')).toBe(false);
  });

  it('allows only one dispatcher to claim a queued run', async () => {
    const { automation } = await fixture();
    const run = service.queueRunAtomically(automation.id);
    const other = new AutomationService();
    try {
      service.dispatchQueuedRun(run.id);
      other.dispatchQueuedRun(run.id);
      await completed(run.id);
      expect((await service.listRunEvents(run.id)).filter(event => event.type === 'run.started')).toHaveLength(1);
    } finally { await other.stop(); }
  });

  it('can cancel accepted queued work before dispatch and never starts it on receipt replay', async () => {
    const { automation, invoke } = await fixture();
    const dispatch = vi.spyOn(service, 'dispatchQueuedRun').mockImplementation(() => {});
    const receipt = AutomationRunMutationOutputSchema.parse(await invoke(automation.id, 'cancel-before-start'));
    expect(await service.cancelRun(receipt.run.id)).toBe(true);
    dispatch.mockRestore();
    expect(await invoke(automation.id, 'cancel-before-start')).toEqual(receipt);
    expect(await service.getRun(receipt.run.id)).toMatchObject({ status: 'cancelled', termination: { cancellationConfirmed: true } });
    expect((await service.get(automation.id))?.state.runningRunId).toBeUndefined();
    expect((await service.listRunEvents(receipt.run.id)).some(event => event.type === 'run.started')).toBe(false);
  });

  it('recovers pending work older than the latest 500 completed history entries', async () => {
    const { automation } = await fixture();
    const queued = service.queueRunAtomically(automation.id);
    const insert = getSqliteDatabase().prepare(`INSERT INTO automation_runs
      (run_id, automation_id, automation_name, status, trigger_snapshot_json, action_snapshot_json, manual, created_at_ms)
      SELECT ?, automation_id, automation_name, 'succeeded', trigger_snapshot_json, action_snapshot_json, manual, created_at_ms + 1000
      FROM automation_runs WHERE run_id = ?`);
    for (let index = 0; index < 501; index++) insert.run(`completed-${index}`, queued.id);
    await service.initialize();
    expect(await completed(queued.id)).toMatchObject({ status: 'succeeded' });
  });

  it('records an idempotent user rerun trigger and rejects overlapping runs', async () => {
    const { automation, invoke } = await fixture();
    const event = { type: 'fixture.event', source: 'test', payload: { key: 'original' }, occurredAtMs: Date.now() };
    const source = service.queueRunAtomically(automation.id, { manual: false, event });
    await expect(invoke(automation.id, 'overlap')).rejects.toMatchObject({ code: 'IN_PROGRESS' });
    service.dispatchQueuedRun(source.id);
    await completed(source.id);
    vi.spyOn(service, 'dispatchQueuedRun').mockImplementation(() => {});
    const rerun = AutomationRunMutationOutputSchema.parse(await invoke(source.id, 'rerun', 'rerun'));
    expect(rerun.run).toMatchObject({ manual: true, status: 'queued' });
    expect(await invoke(source.id, 'rerun', 'rerun')).toEqual(rerun);
    expect((await service.listRunEvents(rerun.run.id))[0]).toMatchObject({ data: { event: expect.objectContaining({
      type: 'automation.rerun.requested', payload: { automationId: automation.id, previousRunId: source.id },
    }) } });
    expect(await service.listRuns()).toHaveLength(2);
  });

  it('shares execution receipts between agent tools without repeating completed work', async () => {
    const { automation } = await fixture();
    const deps = { getAutomationService: () => service, getCurrentAgentId: () => 'reviewer' };
    const direct = createAutomationTool(deps);
    const unified = createXopcUseTool(deps);
    const result = await direct.execute('call-1', { action: 'run', automationId: automation.id, idempotencyKey: 'agent-run' });
    const run = result.details.run as { id: string };
    await completed(run.id);
    const replay = await unified.execute('call-2', { mode: 'automation', command: 'run', args: { automationId: automation.id, idempotencyKey: 'agent-run' } });
    expect(replay.details.result).toMatchObject({ run });
    const rerun = await direct.execute('call-3', { action: 'rerun', runId: run.id, idempotencyKey: 'agent-rerun' });
    await completed((rerun.details.run as { id: string }).id);
    expect((await unified.execute('call-4', { mode: 'automation', command: 'rerun', args: { runId: run.id, idempotencyKey: 'agent-rerun' } })).details.result)
      .toMatchObject({ run: rerun.details.run });
    expect(await service.listRuns()).toHaveLength(2);
  });

  it('shares cancellation and read receipts between both agent tools', async () => {
    const { automation } = await fixture();
    const run = service.queueRunAtomically(automation.id);
    const deps = { getAutomationService: () => service, getCurrentAgentId: () => 'reviewer' };
    const direct = createAutomationTool(deps);
    const unified = createXopcUseTool(deps);
    for (const command of ['cancel', 'read', 'read_all'] as const) {
      const result = await direct.execute(command, { action: command, runId: run.id, idempotencyKey: command });
      const replay = await unified.execute(command, { mode: 'automation', command, args: { runId: run.id, idempotencyKey: command } });
      expect(replay.details.result).toEqual(result.details);
    }
    expect((await service.listRunEvents(run.id)).filter(event => event.type === 'run.cancel_requested')).toHaveLength(1);
  });
});
