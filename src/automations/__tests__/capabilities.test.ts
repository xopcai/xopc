import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationMutationOutputSchema } from '@xopcai/gateway-contract';

import { createProductDispatcher } from '../../capabilities/runtime/product.js';
import type { CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { AutomationService } from '../service/automation-service.js';
import { createAutomationTool } from '../../agent/tools/automation-tool.js';
import { createXopcUseTool } from '../../agent/tools/xopc-use-tool.js';
import { ProjectService } from '../../projects/project-service.js';
import { saveAutomationRun } from '../storage/index.js';
import { AutomationDraftService, simulateAutomation } from '../draft/index.js';
import { ConfigSchema } from '../../config/schema.js';

let directory: string;
const caller: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: ['automations.write'], authorize: () => true };
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'xopc-automation-capability-'));
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(directory, 'xopc.db') });
});
afterEach(() => {
  vi.restoreAllMocks();
  closeXopcDatabase();
  resetXopcDatabaseSingletonForTest();
  rmSync(directory, { recursive: true, force: true });
});

async function fixture() {
  const service = new AutomationService();
  const automation = await service.create({ name: 'Manual fixture', trigger: { kind: 'manual' },
    action: { kind: 'agent', instruction: 'Do not execute' } });
  const dispatcher = createProductDispatcher(undefined, { getAutomations: () => service });
  const id = 'xopc.automations.set_enabled';
  const input = { id: automation.id, enabled: false, expectedRevision: automation.updatedAtMs };
  const invoke = (key = 'pause', body = input, context = caller) => dispatcher.call(id, body, context,
    { ...dispatcher.describe(id, context), idempotencyKey: key });
  return { service, automation, dispatcher, id, input, invoke };
}

describe('automation state capability', () => {
  it('shares draft receipts across surfaces without repeating model calls or creating automations', async () => {
    const service = new AutomationService();
    const automation = { name: 'Suggested', trigger: { kind: 'manual' as const }, action: { kind: 'agent' as const, instruction: 'Review' } };
    const generate = vi.spyOn(AutomationDraftService.prototype, 'createDraft').mockResolvedValue({
      draftId: 'draft-fixture', automation, explanation: 'Fixture', assumptions: [], risks: [],
      simulation: simulateAutomation(automation), repairAttempts: 0,
    });
    const dispatcher = createProductDispatcher(undefined, { getAutomations: () => service, getConfig: () => ConfigSchema.parse({}) });
    const id = 'xopc.automations.draft';
    const expected = { ...dispatcher.describe(id, caller), idempotencyKey: 'draft-intent' };
    const input = { prompt: 'Prepare a draft' };
    const result = await dispatcher.call(id, input, caller, expected);
    expect(await dispatcher.call(id, input, { ...caller, surface: 'agent' }, expected)).toEqual(result);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await service.list()).toEqual([]);
    await expect(dispatcher.call(id, input, { ...caller, authorize: () => false }, expected)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(dispatcher.call(id, { prompt: 'Changed' }, caller, expected)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    const read = { ...caller, scopes: ['automations.read'] as const };
    expect(await dispatcher.call('xopc.automations.simulate', automation, read)).toEqual({ simulation: simulateAutomation(automation) });
  });

  it('does not retry uncertain model generation and rejects unavailable repair inputs before the model', async () => {
    const service = new AutomationService();
    const generate = vi.spyOn(AutomationDraftService.prototype, 'createDraft').mockRejectedValue(new Error('Response lost'));
    const repair = vi.spyOn(AutomationDraftService.prototype, 'createRepairDraft');
    const dispatcher = createProductDispatcher(undefined, { getAutomations: () => service, getConfig: () => ConfigSchema.parse({}) });
    const id = 'xopc.automations.draft';
    const expected = { ...dispatcher.describe(id, caller), idempotencyKey: 'draft-intent' };
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(dispatcher.call(id, { prompt: 'Prepare' }, caller, expected)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    }
    expect(generate).toHaveBeenCalledTimes(1);
    const repairId = 'xopc.automations.repair_draft';
    await expect(dispatcher.call(repairId, { id: 'missing' }, caller, { ...dispatcher.describe(repairId, caller), idempotencyKey: 'repair' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(repair).not.toHaveBeenCalled();
  });
  it('replays deletion without deleting a recreated identity, even within one millisecond', async () => {
    const { service, automation, dispatcher } = await fixture();
    vi.spyOn(Date, 'now').mockReturnValue(automation.updatedAtMs);
    const operation = 'xopc.automations.delete';
    const input = { id: automation.id, expectedRevision: automation.updatedAtMs };
    const invoke = (key: string) => dispatcher.call(operation, input, caller, { ...dispatcher.describe(operation, caller), idempotencyKey: key });
    const receipt = await invoke('delete');
    expect(receipt).toMatchObject({ removed: true, automation: { id: automation.id } });
    expect(await service.get(automation.id)).toBeNull();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    const recreated = await service.create({ id: automation.id, name: 'New identity', trigger: { kind: 'manual' }, action: automation.action });
    expect(recreated.updatedAtMs).toBeGreaterThan(automation.updatedAtMs);
    expect(await invoke('delete')).toEqual(receipt);
    await expect(invoke('stale-delete')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await service.get(automation.id)).toEqual(recreated);
    await expect(dispatcher.call(operation, input, { ...caller, authorize: () => false },
      { ...dispatcher.describe(operation, caller), idempotencyKey: 'delete' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('persists cancellation once, retries notification after commit, and never resumes a deleted queued run', async () => {
    const { service, automation, dispatcher } = await fixture();
    saveAutomationRun({ id: 'queued-delete', automationId: automation.id, automationName: automation.name, status: 'queued',
      triggerSnapshot: automation.trigger, actionSnapshot: automation.action, manual: true, createdAtMs: Date.now() });
    const current = await service.update(automation.id, { state: { runningRunId: 'queued-delete' } });
    const operation = 'xopc.automations.delete';
    const invoke = () => dispatcher.call(operation, { id: automation.id, expectedRevision: current!.updatedAtMs }, caller,
      { ...dispatcher.describe(operation, caller), idempotencyKey: 'delete-active' });
    const finish = vi.spyOn(service, 'finishRemoval').mockImplementationOnce(() => {
      getSqliteDatabase().exec('BEGIN');
      getSqliteDatabase().exec('ROLLBACK');
      throw new Error('Delivery interrupted');
    });
    await expect(invoke()).rejects.toThrow('Delivery interrupted');
    expect(await service.get(automation.id)).toBeNull();
    expect(await service.getRun('queued-delete')).toMatchObject({ status: 'cancelling', cancelRequestedAtMs: expect.any(Number) });
    expect(await invoke()).toMatchObject({ removed: true, cancelRunId: 'queued-delete' });
    expect(finish).toHaveBeenCalledTimes(2);
    expect((await service.listRunEvents('queued-delete')).filter(event => event.type === 'run.cancel_requested')).toHaveLength(1);
    const restarted = new AutomationService();
    try {
      await restarted.initialize();
      expect(await restarted.getRun('queued-delete')).toMatchObject({ status: 'cancelled', termination: { cancellationConfirmed: false } });
      expect((await restarted.listRunEvents('queued-delete')).some(event => event.type === 'run.started')).toBe(false);
    } finally { await restarted.stop(); }
  });

  it('rolls back deletion, revision history, and cancellation when receipt validation fails', async () => {
    const { service, automation, dispatcher } = await fixture();
    saveAutomationRun({ id: 'running-delete', automationId: automation.id, automationName: automation.name, status: 'running',
      triggerSnapshot: automation.trigger, actionSnapshot: automation.action, manual: true, createdAtMs: Date.now() });
    const current = await service.update(automation.id, { state: { runningRunId: 'running-delete' } });
    const remove = service.removeAtomically.bind(service);
    vi.spyOn(service, 'removeAtomically').mockImplementation(id => ({ ...remove(id), removed: 'invalid' } as never));
    const finish = vi.spyOn(service, 'finishRemoval');
    const operation = 'xopc.automations.delete';
    await expect(dispatcher.call(operation, { id: automation.id, expectedRevision: current!.updatedAtMs }, caller,
      { ...dispatcher.describe(operation, caller), idempotencyKey: 'rollback-delete' })).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(await service.get(automation.id)).toEqual(current);
    expect(await service.getRun('running-delete')).toMatchObject({ status: 'running' });
    expect(await service.listRunEvents('running-delete')).toHaveLength(0);
    expect(getSqliteDatabase().prepare('SELECT * FROM automation_deleted_revisions').all()).toHaveLength(0);
    expect(finish).not.toHaveBeenCalled();
  });

  it('does not turn an absent-object deletion retry into a deletion of a later object', async () => {
    const { service, dispatcher } = await fixture();
    const operation = 'xopc.automations.delete';
    const invoke = (key: string) => dispatcher.call(operation, { id: 'later', expectedRevision: null }, caller,
      { ...dispatcher.describe(operation, caller), idempotencyKey: key });
    expect(await invoke('absent')).toMatchObject({ removed: false });
    await service.create({ id: 'later', name: 'Later', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'No execution' } });
    expect(await invoke('absent')).toMatchObject({ removed: false });
    await expect(invoke('fresh-absent')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await service.get('later')).not.toBeNull();
  });

  it('shares deletion receipts between agent tools without returning a stale open link', async () => {
    const { service, automation } = await fixture();
    const deps = { getAutomationService: () => service, getCurrentAgentId: () => 'reviewer' };
    const args = { automationId: automation.id, expectedRevision: automation.updatedAtMs, idempotencyKey: 'agent-delete' };
    const direct = await createAutomationTool(deps).execute('delete-1', { action: 'delete', ...args });
    expect(direct.details.removed).toBe(true);
    const replay = await createXopcUseTool(deps).execute('delete-2', { mode: 'automation', command: 'delete', args });
    expect(replay.details.result).toMatchObject({ removed: true, automation: { id: automation.id } });
    expect(replay.details.delivery).toBeUndefined();
  });

  it('preserves omitted policies and runtime state when changing only the name', async () => {
    const { service, dispatcher } = await fixture();
    const automation = await service.create({ name: 'Policy fixture', trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'No execution' }, conversationMode: 'continuous', notificationPolicy: 'none',
      state: { lastError: 'Retained diagnostic', consecutiveFailures: 2 } });
    const operation = 'xopc.automations.update';
    const result = AutomationMutationOutputSchema.parse(await dispatcher.call(operation,
      { id: automation.id, expectedRevision: automation.updatedAtMs, patch: { name: 'Renamed' } }, caller,
      { ...dispatcher.describe(operation, caller), idempotencyKey: 'rename' }));
    expect(result.automation).toMatchObject({ name: 'Renamed', conversationMode: 'continuous', notificationPolicy: 'none',
      state: { lastError: 'Retained diagnostic', consecutiveFailures: 2 } });
    expect(await service.get(automation.id)).toEqual(result.automation);
  });

  it('shares create and edit receipts between the two agent tools', async () => {
    const { service } = await fixture();
    const deps = { getAutomationService: () => service, getCurrentAgentId: () => 'reviewer' };
    const direct = createAutomationTool(deps);
    const unified = createXopcUseTool(deps);
    const input = { name: 'Agent fixture', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'No execution' } };
    const created = await direct.execute('create-1', { action: 'create', automation: input, idempotencyKey: 'agent-create' });
    const automation = created.details.automation as { id: string; updatedAtMs: number };
    const replay = await unified.execute('create-2', { mode: 'automation', command: 'create', args: { automation: input, idempotencyKey: 'agent-create' } });
    expect(replay.details.result).toMatchObject({ automation });
    const args = { automationId: automation.id, expectedRevision: automation.updatedAtMs, patch: { name: 'Agent edited' }, idempotencyKey: 'agent-edit' };
    const edited = await direct.execute('edit-1', { action: 'update', ...args });
    const editReplay = await unified.execute('edit-2', { mode: 'automation', command: 'update', args });
    expect(editReplay.details.result).toMatchObject({ automation: edited.details.automation });
    expect(await service.list()).toHaveLength(2);
  });

  it('creates exactly once and rejects duplicate identities without overwriting configuration', async () => {
    const { service, dispatcher } = await fixture();
    const operation = 'xopc.automations.create';
    const input = { id: 'stable-id', name: 'Created', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'Do not execute' } };
    const invoke = (key: string, body: unknown = input) => dispatcher.call(operation, body, caller,
      { ...dispatcher.describe(operation, caller), idempotencyKey: key });
    const refresh = vi.spyOn(service, 'refreshSchedule').mockImplementation(() => {
      getSqliteDatabase().exec('BEGIN');
      getSqliteDatabase().exec('ROLLBACK');
    });
    const first = await invoke('create');
    expect(await invoke('create')).toEqual(first);
    expect(refresh).toHaveBeenCalledTimes(2);
    await expect(invoke('different-intent', { ...input, name: 'Overwrite' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect((await service.get('stable-id'))?.name).toBe('Created');
    expect(await service.list()).toHaveLength(2);
  });

  it('edits at an exact revision and replays a historical result without overwriting a later edit', async () => {
    const { service, automation, dispatcher } = await fixture();
    const operation = 'xopc.automations.update';
    const input = { id: automation.id, expectedRevision: automation.updatedAtMs, patch: { name: 'Edited' } };
    const invoke = (key: string) => dispatcher.call(operation, input, caller,
      { ...dispatcher.describe(operation, caller), idempotencyKey: key });
    const first = await invoke('edit');
    const newer = await service.update(automation.id, { name: 'Newer' });
    expect(await invoke('edit')).toEqual(first);
    expect(await service.get(automation.id)).toEqual(newer);
    await expect(invoke('stale')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('validates projects, runtime-owned state, and nonempty patches before writing', async () => {
    const { service, automation } = await fixture();
    const projects = new ProjectService();
    const dispatcher = createProductDispatcher(undefined, { getAutomations: () => service, getProjects: () => projects });
    const invoke = (id: string, input: unknown) => dispatcher.call(id, input, caller,
      { ...dispatcher.describe(id, caller), idempotencyKey: 'validation' });
    const base = { name: 'Invalid', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'Do not execute' } };
    await expect(invoke('xopc.automations.create', { ...base, projectId: 'missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(invoke('xopc.automations.create', { ...base, state: { runningRunId: 'forged' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    for (const patch of [{}, { state: { runningRunId: 'forged' } }, { projectId: 'missing' }]) {
      await expect(invoke('xopc.automations.update', { id: automation.id, expectedRevision: automation.updatedAtMs, patch }))
        .rejects.toMatchObject({ code: 'projectId' in patch ? 'NOT_FOUND' : 'INVALID_INPUT' });
    }
    const project = projects.create({ name: 'Project' });
    expect(await invoke('xopc.automations.create', { ...base, projectId: project.id })).toMatchObject({ automation: { projectId: project.id } });
  });

  it('rolls back creation and retries a committed edit when schedule refresh fails', async () => {
    const { service, automation, dispatcher } = await fixture();
    const invoke = (id: string, input: unknown) => dispatcher.call(id, input, caller,
      { ...dispatcher.describe(id, caller), idempotencyKey: 'failure' });
    const create = service.createAtomically.bind(service);
    const creation = vi.spyOn(service, 'createAtomically').mockImplementation(input => ({ ...create(input), enabled: 'invalid' } as never));
    await expect(invoke('xopc.automations.create', { name: 'Rolled back', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'No execution' } }))
      .rejects.toMatchObject({ code: 'INTERNAL' });
    expect(await service.list()).toHaveLength(1);
    creation.mockRestore();
    const update = vi.spyOn(service, 'updateAtomically');
    vi.spyOn(service, 'refreshSchedule').mockImplementationOnce(() => { throw new Error('Wake interrupted'); });
    const input = { id: automation.id, expectedRevision: automation.updatedAtMs, patch: { name: 'Committed' } };
    await expect(invoke('xopc.automations.update', input)).rejects.toThrow('Wake interrupted');
    expect(await invoke('xopc.automations.update', input)).toMatchObject({ automation: { name: 'Committed' } });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('normalizes optional strings in discoverable create contracts', async () => {
    const { dispatcher } = await fixture();
    const operation = 'xopc.automations.create';
    const descriptor = dispatcher.describe(operation, caller);
    expect((descriptor.inputSchema.properties as Record<string, unknown>).projectId).toMatchObject({ anyOf: expect.any(Array) });
    const input = { name: 'Normalized', projectId: '  ', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'No execution', agentId: null } };
    const first = await dispatcher.call(operation, input, caller, { ...descriptor, idempotencyKey: 'normalized' });
    expect(await dispatcher.call(operation, { ...input, projectId: null }, caller, { ...descriptor, idempotencyKey: 'normalized' })).toEqual(first);
  });

  it('shares receipts between both agent tools and requires the original revision for retries', async () => {
    const { service, automation } = await fixture();
    const deps = { getAutomationService: () => service, getCurrentAgentId: () => 'reviewer' };
    const direct = createAutomationTool(deps);
    const unified = createXopcUseTool(deps);
    const args = { automationId: automation.id, expectedRevision: automation.updatedAtMs, idempotencyKey: 'agent-pause' };
    const first = await direct.execute('call-1', { action: 'pause', ...args });
    const paused = first.details.automation;
    const resumed = await service.resume(automation.id);
    const replay = await unified.execute('call-2', { mode: 'automation', command: 'pause', args });
    expect(replay.details.result).toMatchObject({ ok: true, automation: paused });
    expect(await service.get(automation.id)).toEqual(resumed);
    const invalid = await direct.execute('call-3', { action: 'pause', automationId: automation.id, idempotencyKey: 'invalid' });
    expect(invalid.details.ok).toBe(false);
    const invalidUnified = await unified.execute('call-4', { mode: 'automation', command: 'pause',
      args: { automationId: automation.id, idempotencyKey: 'invalid' } });
    expect(invalidUnified.details.result).toMatchObject({ ok: false });
    expect(await service.get(automation.id)).toEqual(resumed);
  });

  it('replays across surfaces without changing later state, including after deletion', async () => {
    const { service, automation, input, invoke } = await fixture();
    const first = AutomationMutationOutputSchema.parse(await invoke());
    expect(first.automation.enabled).toBe(false);
    expect(first.automation.updatedAtMs).toBeGreaterThan(automation.updatedAtMs);
    const resumed = await service.resume(automation.id);
    expect(await invoke('pause', input, { ...caller, surface: 'agent' })).toEqual(first);
    expect(await service.get(automation.id)).toEqual(resumed);
    await service.remove(automation.id);
    expect(await invoke()).toEqual(first);
    await expect(invoke('new-intent')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects stale revisions and changed input on a reused key', async () => {
    const { service, automation, input, invoke } = await fixture();
    await invoke();
    await expect(invoke('stale')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(invoke('pause', { ...input, enabled: true })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect((await service.get(automation.id))?.enabled).toBe(false);
  });

  it('authorizes before replay and hides writes from read-only callers', async () => {
    const { dispatcher, input, invoke } = await fixture();
    await invoke();
    await expect(invoke('pause', input, { ...caller, authorize: () => false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dispatcher.list({ ...caller, scopes: ['automations.read'] }).map(item => item.id))
      .not.toContain('xopc.automations.set_enabled');
  });

  it('refreshes scheduling only after commit and retries delivery without repeating mutation', async () => {
    const { service, automation, invoke } = await fixture();
    const refresh = vi.spyOn(service, 'refreshSchedule').mockImplementationOnce(() => {
      getSqliteDatabase().exec('BEGIN');
      getSqliteDatabase().exec('ROLLBACK');
      throw new Error('Wake interrupted');
    });
    const update = vi.spyOn(service, 'updateAtomically');
    await expect(invoke()).rejects.toThrow('Wake interrupted');
    expect((await service.get(automation.id))?.enabled).toBe(false);
    await invoke();
    expect(update).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('rolls back the mutation when output validation fails', async () => {
    const { service, automation, invoke } = await fixture();
    const update = service.updateAtomically.bind(service);
    vi.spyOn(service, 'updateAtomically').mockImplementation((id, patch) => ({ ...update(id, patch)!, enabled: 'invalid' } as never));
    const refresh = vi.spyOn(service, 'refreshSchedule');
    await expect(invoke()).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(await service.get(automation.id)).toEqual(automation);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('advances revision for multiple writes within one millisecond', async () => {
    const { service, automation } = await fixture();
    vi.spyOn(Date, 'now').mockReturnValue(automation.updatedAtMs);
    const paused = await service.pause(automation.id);
    const resumed = await service.resume(automation.id);
    expect(paused?.updatedAtMs).toBe(automation.updatedAtMs + 1);
    expect(resumed?.updatedAtMs).toBe(automation.updatedAtMs + 2);
  });
});
