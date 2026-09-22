import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { createProductDispatcher } from '../runtime/product.js';
import { ProductReadContracts } from '@xopcai/gateway-contract';
import { ProjectService } from '../../projects/project-service.js';
import { TaskContextMutationOutputSchema } from '../../tasks/capabilities/relations.js';
import { TaskEditOutputSchema } from '../../tasks/capabilities/management.js';
import { AutomationService } from '../../automations/service/automation-service.js';
import { createXopcUseTool } from '../../agent/tools/xopc-use-tool.js';
import { CapabilityDispatcher, defineAtomicCapability, type CapabilityContext } from '../runtime/dispatcher.js';

let directory: string;
const context: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: ['tasks.write'], authorize: () => true };
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'xopc-capability-atomic-'));
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(directory, 'xopc.db') });
});
afterEach(() => {
  vi.restoreAllMocks();
  closeXopcDatabase();
  resetXopcDatabaseSingletonForTest();
  rmSync(directory, { recursive: true, force: true });
});

function fixture(invalidResult = false, failAfterCommit = false) {
  const dispatcher = new CapabilityDispatcher();
  dispatcher.register(defineAtomicCapability({
    id: 'xopc.test.create', majorVersion: 1, description: 'Create a transactional fixture', effect: 'local-write',
    surfaces: ['http', 'agent'], scopes: ['tasks.write'],
    input: z.strictObject({ title: z.string().min(1) }), output: z.object({ id: z.string().min(1) }),
    execute(input) {
      const task = new TaskRepository().create({ title: input.title, objective: input.title });
      return { id: invalidResult ? '' : task.id };
    },
    afterCommit() { if (failAfterCommit) throw new Error('Response delivery interrupted'); },
  }));
  return dispatcher;
}
function invoke(dispatcher: CapabilityDispatcher, key = 'request-1', title = 'Draft', ctx = context) {
  return dispatcher.call('xopc.test.create', { title }, ctx, {
    ...dispatcher.describe('xopc.test.create', ctx), idempotencyKey: key,
  });
}
function count(table: string): number {
  return Number(getSqliteDatabase().prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);
}

describe('atomic capability operations', () => {
  it('prepares outside the write transaction, rechecks access, and never prepares receipt replay', async () => {
    const dispatcher = new CapabilityDispatcher();
    const prepare = vi.fn(async () => {
      expect(getSqliteDatabase().isTransaction).toBe(false);
      await Promise.resolve();
    });
    const execute = vi.fn(() => ({ ok: true }));
    dispatcher.register(defineAtomicCapability({ id: 'xopc.test.prepared', majorVersion: 1, description: 'Prepared fixture', effect: 'local-write',
      surfaces: ['http'], scopes: ['tasks.write'], input: z.strictObject({}), output: z.object({ ok: z.boolean() }), prepare, execute }));
    const operation = 'xopc.test.prepared';
    const options = { ...dispatcher.describe(operation, context), idempotencyKey: 'prepared' };
    const authorize = vi.fn(() => true);
    expect(await dispatcher.call(operation, {}, { ...context, authorize }, options)).toEqual({ ok: true });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(await dispatcher.call(operation, {}, context, options)).toEqual({ ok: true });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(dispatcher.call(operation, {}, { ...context, authorize: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false) },
      { ...options, idempotencyKey: 'revoked' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(count('capability_operations')).toBe(1);
  });

  it('fences workspace changes and cancellation during asynchronous preparation', async () => {
    let scope = 'first';
    const controller = new AbortController();
    const dispatcher = new CapabilityDispatcher();
    const execute = vi.fn(() => ({ ok: true }));
    dispatcher.register(defineAtomicCapability({ id: 'xopc.test.prepared', majorVersion: 1, description: 'Prepared fixture', effect: 'local-write',
      surfaces: ['http'], scopes: ['tasks.write'], input: z.strictObject({ cancel: z.boolean() }), output: z.object({ ok: z.boolean() }),
      requestScope: () => scope, prepare: async ({ cancel }) => { if (cancel) controller.abort(); else scope = 'other'; }, execute }));
    const operation = 'xopc.test.prepared';
    const options = { ...dispatcher.describe(operation, context), idempotencyKey: 'prepared' };
    await expect(dispatcher.call(operation, { cancel: false }, context, options)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(dispatcher.call(operation, { cancel: true }, { ...context, signal: controller.signal }, options)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(execute).not.toHaveBeenCalled();
    expect(count('capability_operations')).toBe(0);
  });

  it('shares pin receipts across surfaces and rejects stale versions, changed intent and revoked access', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Pin fixture' });
    const dispatcher = createProductDispatcher(undefined, { getProjects: () => projects });
    const writer = { ...context, scopes: ['workspace.write'] };
    const operation = 'xopc.projects.set_pinned';
    const input = { id: project.id, expectedVersion: project.version, pinned: true };
    const options = { ...dispatcher.describe(operation, writer), idempotencyKey: 'pin' };
    const first = await dispatcher.call(operation, input, writer, options);
    expect(first).toMatchObject({ project: { version: 2, pinnedAt: expect.any(Number) } });
    expect(await dispatcher.call(operation, input, { ...writer, surface: 'agent' }, options)).toEqual(first);
    await expect(dispatcher.call(operation, { ...input, pinned: false }, writer, options)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(dispatcher.call(operation, input, writer, { ...options, idempotencyKey: 'stale' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(dispatcher.call(operation, input, { ...writer, authorize: () => false }, options)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await dispatcher.call(operation, { ...input, expectedVersion: 2, pinned: false }, writer, { ...options, idempotencyKey: 'unpin' });
    expect(await dispatcher.call(operation, input, writer, options)).toEqual(first);
    expect(projects.get(project.id)).toMatchObject({ version: 3, pinnedAt: undefined });
    expect(getSqliteDatabase().prepare("SELECT * FROM domain_outbox WHERE event_type = 'project.changed'").all()).toHaveLength(2);
  });

  it('rolls pin state and event back on invalid output, and recovers a committed pin after notification failure', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Pin rollback' });
    const dispatcher = createProductDispatcher(undefined, { getProjects: () => projects });
    const writer = { ...context, scopes: ['workspace.write'] };
    const operation = 'xopc.projects.set_pinned';
    const input = { id: project.id, expectedVersion: project.version, pinned: true };
    const options = { ...dispatcher.describe(operation, writer), idempotencyKey: 'pin-recovery' };
    const original = projects.pin.bind(projects);
    const pin = vi.spyOn(projects, 'pin').mockImplementationOnce(id => ({ ...original(id), name: 42 } as never));
    await expect(dispatcher.call(operation, input, writer, options)).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(projects.get(project.id)).toEqual(project);
    expect(getSqliteDatabase().prepare("SELECT * FROM domain_outbox WHERE event_type = 'project.changed'").all()).toHaveLength(0);
    vi.spyOn(projects, 'flushCommittedEffects').mockImplementationOnce(() => { throw new Error('notification failed'); });
    await expect(dispatcher.call(operation, input, writer, options)).rejects.toThrow('notification failed');
    expect(projects.get(project.id)?.version).toBe(2);
    expect(await dispatcher.call(operation, input, writer, options)).toMatchObject({ project: { version: 2 } });
    expect(pin).toHaveBeenCalledTimes(2);
  });

  it('validates Agent pin dry runs and retains the original receipt on retry', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Agent pin' });
    const tool = createXopcUseTool({ getProjectService: () => projects });
    const args = { projectId: project.id, expectedVersion: project.version, idempotencyKey: 'agent-pin' };
    await tool.execute('preview', { mode: 'project', command: 'pin', args, dryRun: true });
    expect(projects.get(project.id)).toEqual(project);
    const first = await tool.execute('pin', { mode: 'project', command: 'pin', args });
    const replay = await tool.execute('replay', { mode: 'project', command: 'pin', args });
    expect(replay).toEqual(first);
    expect(projects.get(project.id)?.version).toBe(2);
    const invalid = await tool.execute('bad', { mode: 'project', command: 'unpin', args: { projectId: project.id, idempotencyKey: 'missing-version' } });
    expect(JSON.stringify(invalid)).toContain('original expectedVersion');
    expect(projects.get(project.id)?.version).toBe(2);
  });

  it('commits project version and event before notification and replays without duplicate changes', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Realtime fixture' });
    const flush = vi.spyOn(projects, 'flushCommittedEffects').mockImplementationOnce(() => {
      getSqliteDatabase().exec('BEGIN');
      getSqliteDatabase().exec('ROLLBACK');
      throw new Error('Publish interrupted');
    });
    const dispatcher = createProductDispatcher(undefined, { getProjects: () => projects });
    const writer = { ...context, scopes: ['workspace.write'] };
    const operation = 'xopc.projects.create_milestone';
    const call = () => dispatcher.call(operation, { projectId: project.id, title: 'Ship' }, writer,
      { ...dispatcher.describe(operation, writer), idempotencyKey: 'project-event' });
    await expect(call()).rejects.toThrow('Publish interrupted');
    expect(projects.get(project.id)?.version).toBe(project.version + 1);
    expect(getSqliteDatabase().prepare("SELECT operation_id, published_at FROM domain_outbox WHERE event_type = 'project.changed'").get())
      .toMatchObject({ operation_id: expect.any(String), published_at: null });
    expect(await call()).toMatchObject({ project: { version: project.version + 1 } });
    await call();
    expect(flush).toHaveBeenCalledTimes(3);
    expect(projects.get(project.id)?.version).toBe(project.version + 1);
    expect(getSqliteDatabase().prepare("SELECT * FROM domain_outbox WHERE event_type = 'project.changed'").all()).toHaveLength(1);
  });

  it('rolls milestone, project revision and outbox back when output validation fails', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Realtime rollback' });
    const create = projects.createMilestone.bind(projects);
    vi.spyOn(projects, 'createMilestone').mockImplementation((...args) => ({ ...create(...args), title: 42 } as never));
    const flush = vi.spyOn(projects, 'flushCommittedEffects');
    const dispatcher = createProductDispatcher(undefined, { getProjects: () => projects });
    const writer = { ...context, scopes: ['workspace.write'] };
    const operation = 'xopc.projects.create_milestone';
    await expect(dispatcher.call(operation, { projectId: project.id, title: 'Ship' }, writer,
      { ...dispatcher.describe(operation, writer), idempotencyKey: 'rollback-event' })).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(projects.listMilestones(project.id)).toEqual([]);
    expect(projects.get(project.id)).toEqual(project);
    expect(getSqliteDatabase().prepare("SELECT * FROM domain_outbox WHERE event_type = 'project.changed'").all()).toEqual([]);
    expect(flush).not.toHaveBeenCalled();
  });
  it('version-checks milestone edits and deletion while replaying old receipts unchanged', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Milestone fixture' });
    const dispatcher = createProductDispatcher(undefined, { getProjects: () => projects });
    const writer = { ...context, scopes: ['workspace.write'] };
    const call = (command: string, input: unknown, key: string) => {
      const operation = `xopc.projects.${command}`;
      return dispatcher.call(operation, input, writer, { ...dispatcher.describe(operation, writer), idempotencyKey: key });
    };
    const input = { projectId: project.id, title: 'Ship' };
    const created = await call('create_milestone', input, 'create');
    expect(await call('create_milestone', input, 'create')).toEqual(created);
    const milestone = projects.listMilestones(project.id)[0];
    vi.spyOn(Date, 'now').mockReturnValue(milestone.updatedAt);
    const edit = { projectId: project.id, id: milestone.id, expectedRevision: milestone.updatedAt, patch: { title: 'Review' } };
    const edited = await call('update_milestone', edit, 'edit');
    expect(projects.listMilestones(project.id)[0].updatedAt).toBe(milestone.updatedAt + 1);
    expect(await call('update_milestone', edit, 'edit')).toEqual(edited);
    await expect(call('update_milestone', edit, 'stale')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    const remove = { projectId: project.id, id: milestone.id, expectedRevision: milestone.updatedAt + 1 };
    expect(await call('delete_milestone', remove, 'delete')).toEqual({ ok: true, deleted: true });
    expect(await call('delete_milestone', remove, 'delete')).toEqual({ ok: true, deleted: true });
    expect(projects.listMilestones(project.id)).toEqual([]);
    expect(await call('create_milestone', input, 'create')).toEqual(created);
    expect(projects.listMilestones(project.id)).toEqual([]);
  });

  it('returns each exact progress record in one millisecond and rejects stale health changes and forged actors', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Progress fixture' });
    vi.spyOn(Date, 'now').mockReturnValue(project.updatedAt);
    const dispatcher = createProductDispatcher(undefined, { getProjects: () => projects });
    const writer = { ...context, scopes: ['workspace.write'], actor: { kind: 'user' as const, id: 'owner' } };
    const operation = 'xopc.projects.create_update';
    const call = (input: unknown, key: string) => dispatcher.call(operation, input, writer, { ...dispatcher.describe(operation, writer), idempotencyKey: key });
    const first = { projectId: project.id, expectedVersion: project.version, health: 'on_track', summary: 'First' };
    expect(await call(first, 'first')).toMatchObject({ update: { summary: 'First', actor: writer.actor } });
    const next = { ...first, expectedVersion: projects.get(project.id)!.version, summary: 'Second', health: 'at_risk' };
    expect(await call(next, 'second')).toMatchObject({ update: { summary: 'Second' }, project: { health: 'at_risk' } });
    expect(await call(first, 'first')).toMatchObject({ update: { summary: 'First' } });
    expect(projects.get(project.id)?.health).toBe('at_risk');
    await expect(call(first, 'stale')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(call({ ...next, actor: { kind: 'system' } }, 'forged')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(projects.listUpdates(project.id)).toHaveLength(2);
  });

  it('rolls a progress record and health back when its output is invalid', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Rollback progress' });
    const original = projects.createUpdate.bind(projects);
    vi.spyOn(projects, 'createUpdate').mockImplementation((id, input) => ({ ...original(id, input), summary: 42 } as never));
    const dispatcher = createProductDispatcher(undefined, { getProjects: () => projects });
    const writer = { ...context, scopes: ['workspace.write'] };
    const operation = 'xopc.projects.create_update';
    await expect(dispatcher.call(operation, { projectId: project.id, expectedVersion: project.version, health: 'off_track', summary: 'Invalid result' }, writer,
      { ...dispatcher.describe(operation, writer), idempotencyKey: 'rollback' })).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(projects.get(project.id)).toEqual(project);
    expect(projects.listUpdates(project.id)).toEqual([]);
  });

  it('shares milestone creation receipts between the Agent and dispatcher and rechecks permission', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Agent fixture' });
    const deps = { getProjectService: () => projects, getCurrentAgentId: () => 'main' };
    const tool = createXopcUseTool(deps);
    const args = { projectId: project.id, title: 'Agent milestone', idempotencyKey: 'agent-create' };
    const result = await tool.execute('create', { mode: 'project', command: 'create_milestone', args });
    const dispatcher = createProductDispatcher(undefined, { getProjects: () => projects });
    const writer = { ...context, principalId: 'agent:main', scopes: ['workspace.write'] };
    const operation = 'xopc.projects.create_milestone';
    const input = { projectId: project.id, title: args.title };
    expect(await dispatcher.call(operation, input, writer, { ...dispatcher.describe(operation, writer), idempotencyKey: args.idempotencyKey })).toEqual(result.details.result);
    await expect(dispatcher.call(operation, input, { ...writer, authorize: () => false }, { ...dispatcher.describe(operation, writer), idempotencyKey: args.idempotencyKey })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(projects.listMilestones(project.id)).toHaveLength(1);
  });

  it('records feedback once across surfaces and rolls back invalid output with its resource event', async () => {
    const tasks = new TaskRepository();
    const task = tasks.create({ title: 'Feedback', objective: 'Do not execute' });
    const run = new TaskRunRepository().create({ taskId: task.id, executorKind: 'human', executorRef: {}, trigger: {},
      correlationId: 'feedback', idempotencyKey: 'feedback', contractVersion: 1 });
    const wake = vi.fn();
    const runtime = createProductDispatcher(undefined, { wake });
    const operation = 'xopc.task_runs.feedback';
    const input = { id: run.id, rating: 'not_helpful', reason: 'Needs correction' };
    const options = { ...runtime.describe(operation, context), idempotencyKey: 'feedback' };
    const first = await runtime.call(operation, input, context, options);
    expect(await runtime.call(operation, input, { ...context, surface: 'agent' }, options)).toEqual(first);
    expect(count('task_run_feedback')).toBe(1);
    expect(tasks.require(task.id).version).toBe(task.version + 1);
    await expect(runtime.call(operation, { ...input, rating: 'helpful' }, context, options)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(runtime.call(operation, input, { ...context, authorize: () => false }, options)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const before = count('domain_outbox');
    const record = TaskRunRepository.prototype.recordFeedback;
    vi.spyOn(TaskRunRepository.prototype, 'recordFeedback').mockImplementation(function (this: TaskRunRepository, data) {
      return { ...record.call(this, data), rating: 'invalid' } as never;
    });
    await expect(runtime.call(operation, input, context, { ...options, idempotencyKey: 'rollback' })).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(count('task_run_feedback')).toBe(1);
    expect(count('domain_outbox')).toBe(before);
    expect(tasks.require(task.id).version).toBe(task.version + 1);
    const reader = { ...context, scopes: ['tasks.read'] };
    expect(await runtime.call('xopc.tasks.metrics', {}, reader)).toMatchObject({ metrics: { tasks: { total: 1, userCorrected: 1 } } });
  });

  it('cancels a task run once and replays without affecting a later execution', async () => {
    const task = new TaskRepository().create({ title: 'Cancel fixture', objective: 'Do not execute' });
    const runs = new TaskRunRepository();
    const createRun = (key: string) => runs.create({ taskId: task.id, executorKind: 'agent', executorRef: {}, trigger: {},
      correlationId: key, idempotencyKey: key, contractVersion: 1 });
    const run = createRun('first');
    const wake = vi.fn().mockImplementationOnce(() => { throw new Error('Wake failed'); });
    const dispatcher = createProductDispatcher(undefined, { wake });
    const operation = 'xopc.task_runs.cancel';
    const input = { id: run.id, expectedVersion: run.version };
    const call = (key = 'cancel', caller = context) => dispatcher.call(operation, input, caller,
      { ...dispatcher.describe(operation, caller), idempotencyKey: key });
    await expect(call()).rejects.toThrow('Wake failed');
    expect(runs.require(run.id).status).toBe('cancelled');
    const receipt = await call();
    expect(receipt).toMatchObject({ executionStopConfirmed: false, receipt: { status: 'cancelled', completionVerdict: 'not_achieved' } });
    const later = createRun('later');
    expect(await call()).toEqual(receipt);
    expect(runs.require(later.id).status).toBe('queued');
    expect(runs.listEvents(run.id).filter(event => event.type === 'task_run.cancelled')).toHaveLength(1);
    await expect(call('new-key')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(call('cancel', { ...context, authorize: () => false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rolls cancellation receipt and events back on invalid capability output', async () => {
    const task = new TaskRepository().create({ title: 'Rollback fixture', objective: 'Do not execute' });
    const runs = new TaskRunRepository();
    const run = runs.create({ taskId: task.id, executorKind: 'agent', executorRef: {}, trigger: {},
      correlationId: 'rollback', idempotencyKey: 'rollback', contractVersion: 1 });
    const wake = vi.fn();
    const dispatcher = createProductDispatcher(undefined, { wake });
    vi.spyOn(TaskRunRepository.prototype, 'getReceipt').mockReturnValue(undefined);
    const operation = 'xopc.task_runs.cancel';
    await expect(dispatcher.call(operation, { id: run.id, expectedVersion: run.version }, context,
      { ...dispatcher.describe(operation, context), idempotencyKey: 'cancel' })).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(runs.require(run.id)).toEqual(run);
    expect(runs.listEvents(run.id).filter(event => event.type === 'task_run.cancelled')).toEqual([]);
    expect(wake).not.toHaveBeenCalled();
  });

  it('preserves automation policy fields and historical queries across surfaces', async () => {
    const service = new AutomationService();
    const automation = await service.create({ name: 'Review', trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'Review notes' }, conversationMode: 'continuous', notificationPolicy: 'none' });
    const dispatcher = createProductDispatcher(undefined, { getAutomations: () => service });
    const reader = { ...context, scopes: ['automations.read'] };
    const http = await dispatcher.call('xopc.automations.get', { id: automation.id }, reader);
    expect(http).toMatchObject({ automation: { conversationMode: 'continuous', notificationPolicy: 'none' } });
    expect(await dispatcher.call('xopc.automations.get', { id: automation.id }, { ...reader, surface: 'agent' })).toEqual(http);
    expect(await dispatcher.call('xopc.automations.history', { automationId: 'deleted-automation' }, reader)).toMatchObject({ items: [] });
    await expect(dispatcher.call('xopc.automations.list', { projectId: 'missing' }, reader)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await service.stop();
  });
  it('replays edits and deletions and never deletes a task with an active execution', async () => {
    const tasks = new TaskRepository();
    const task = tasks.create({ title: 'Draft', objective: 'Deliver' });
    const dispatcher = createProductDispatcher(undefined, {});
    const invoke = (id: string, input: unknown, key: string) => dispatcher.call(id, input, context,
      { ...dispatcher.describe(id, context), idempotencyKey: key });
    const input = { taskId: task.id, title: 'Edited', expectedVersion: task.version };
    const edited = TaskEditOutputSchema.parse(await invoke('xopc.tasks.update', input, 'edit'));
    expect(await invoke('xopc.tasks.update', input, 'edit')).toEqual(edited);
    const run = new TaskRunRepository().create({ taskId: task.id, executorKind: 'agent', executorRef: {}, trigger: {},
      correlationId: 'active', idempotencyKey: 'active', contractVersion: 1 });
    expect(await invoke('xopc.tasks.delete', { taskId: task.id }, 'blocked-delete')).toMatchObject({ ok: false, reason: 'active_run' });
    expect(tasks.get(task.id)).toBeDefined();
    getSqliteDatabase().prepare("UPDATE task_runs SET status = 'cancelled', completed_at = ? WHERE run_id = ?").run(Date.now(), run.id);
    const removed = await invoke('xopc.tasks.delete', { taskId: task.id, expectedVersion: edited.task.version }, 'delete');
    expect(removed).toMatchObject({ ok: true });
    expect(await invoke('xopc.tasks.delete', { taskId: task.id, expectedVersion: edited.task.version }, 'delete')).toEqual(removed);
    expect(tasks.get(task.id)).toBeUndefined();
    const events = getSqliteDatabase().prepare("SELECT operation_id, payload_json FROM domain_outbox WHERE event_type = 'task.deleted.v1'").all();
    expect(events).toHaveLength(1);
    expect(events[0]!.operation_id).toEqual(expect.any(String));
    expect(JSON.parse(String(events[0]!.payload_json)).version).toBe(edited.task.version + 1);
  });
  it('persists relation receipts with monotonic versions and rolls back missing-edge mutations', async () => {
    const tasks = new TaskRepository();
    const task = tasks.create({ title: 'Context', objective: 'Read context' });
    const dependency = tasks.create({ title: 'Dependency', objective: 'Finish first' });
    const dispatcher = createProductDispatcher(undefined, {});
    const invoke = (id: string, input: unknown, key: string) => dispatcher.call(id, input, context,
      { ...dispatcher.describe(id, context), idempotencyKey: key });
    const input = { taskId: task.id, expectedVersion: task.version, edge: {
      targetKind: 'url', targetId: 'https://example.com', role: 'input', pinned: false, metadata: {}, retrievalPolicy: {},
    } };
    const added = TaskContextMutationOutputSchema.parse(await invoke('xopc.tasks.add_context', input, 'add'));
    expect(added.version).toBe(task.version + 1);
    expect(await invoke('xopc.tasks.add_context', input, 'add')).toEqual(added);
    await expect(invoke('xopc.tasks.add_context', input, 'stale-add')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(invoke('xopc.tasks.remove_context', { taskId: task.id, edgeId: 'missing' }, 'missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(tasks.require(task.id).version).toBe(added.version);
    const remove = { taskId: task.id, edgeId: added.edgeId, expectedVersion: added.version };
    const removed = TaskContextMutationOutputSchema.parse(await invoke('xopc.tasks.remove_context', remove, 'remove'));
    expect(removed.context).toEqual([]);
    expect(await invoke('xopc.tasks.remove_context', remove, 'remove')).toEqual(removed);
    const change = { taskId: task.id, expectedVersion: removed.version, dependsOnTaskIds: [dependency.id] };
    const changed = await invoke('xopc.tasks.update_dependencies', change, 'dependency');
    expect(await invoke('xopc.tasks.update_dependencies', change, 'dependency')).toEqual(changed);
    expect(tasks.require(task.id).version).toBe(task.version + 3);
    expect(count('capability_operations')).toBe(3);
  });
  it('shares project queries and rejects missing projects and resource restrictions', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Capability project' });
    projects.createMilestone(project.id, { title: 'Ship' });
    const dispatcher = createProductDispatcher(undefined, { getProjects: () => projects });
    const reader = { ...context, scopes: ['workspace.read'] };
    const http = await dispatcher.call('xopc.projects.get', { id: project.id }, reader);
    expect(await dispatcher.call('xopc.projects.get', { id: project.id }, { ...reader, surface: 'agent' })).toEqual(http);
    expect(await dispatcher.call('xopc.projects.list_milestones', { id: project.id }, reader)).toMatchObject({ items: [{ title: 'Ship' }] });
    await expect(dispatcher.call('xopc.projects.list_updates', { id: 'missing' }, reader)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(dispatcher.call('xopc.projects.get', { id: project.id }, { ...reader, authorize: () => false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(dispatcher.call('xopc.projects.list', { status: 'invalid' }, reader)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('uses the same validated run reads across surfaces and does not truncate lists at 100', async () => {
    const task = new TaskRepository().create({ title: 'Run history', objective: 'Inspect history' });
    const runs = new TaskRunRepository();
    let runId = '';
    for (let index = 0; index < 105; index++) {
      runId = runs.create({ taskId: task.id, executorKind: 'agent', executorRef: {}, trigger: {},
        correlationId: `c-${index}`, idempotencyKey: `r-${index}`, contractVersion: 1 }).id;
      getSqliteDatabase().prepare("UPDATE task_runs SET status = 'cancelled', completed_at = ? WHERE run_id = ?").run(Date.now(), runId);
    }
    const dispatcher = createProductDispatcher();
    const reader = { ...context, scopes: ['tasks.read'] };
    const http = await dispatcher.call('xopc.task_runs.get', { id: runId }, reader);
    expect(await dispatcher.call('xopc.task_runs.get', { id: runId }, { ...reader, surface: 'agent' })).toEqual(http);
    const listed = ProductReadContracts['xopc.task_runs.list'].output.parse(
      await dispatcher.call('xopc.task_runs.list', { taskId: task.id, limit: 105 }, reader));
    expect(listed.items).toHaveLength(105);
    await expect(dispatcher.call('xopc.task_runs.get', { id: 'missing' }, reader)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(dispatcher.call('xopc.task_runs.list', { taskId: task.id }, { ...reader, scopes: [] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('filters before pagination and counts tasks outside the first page', () => {
    const tasks = new TaskRepository();
    const older = tasks.create({ title: 'Older', objective: 'Unique searchable objective', priority: 'high' });
    for (let index = 0; index < 205; index++) tasks.create({ title: `New ${index}`, objective: 'Other' });
    expect(tasks.list({ search: 'Unique searchable', priority: 'high' }).map(task => task.id)).toEqual([older.id]);
    expect(tasks.count({ search: 'Unique searchable', priority: 'high' })).toBe(1);
    expect(tasks.list({ limit: 10, offset: 200 })).toHaveLength(6);
    expect(tasks.count()).toBe(206);
  });
  it('coalesces concurrent retries, preserves distinct intent, and records separate invocations', async () => {
    const dispatcher = fixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => invoke(dispatcher)));
    expect(new Set(results.map(result => JSON.stringify(result))).size).toBe(1);
    expect(count('tasks')).toBe(1);
    expect(count('capability_operations')).toBe(1);
    expect(count('capability_invocations')).toBe(8);
    await expect(invoke(dispatcher, 'request-1', 'Changed')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await invoke(dispatcher, 'request-2');
    expect(count('tasks')).toBe(2);
  });

  it('rolls back both business rows and receipts when output validation fails', async () => {
    await expect(invoke(fixture(true))).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(count('tasks')).toBe(0);
    expect(count('capability_operations')).toBe(0);
    await invoke(fixture());
    expect(count('tasks')).toBe(1);
  });

  it('replays a committed result after a response failure and database reopen', async () => {
    await expect(invoke(fixture(false, true))).rejects.toThrow('Response delivery interrupted');
    expect(count('tasks')).toBe(1);
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    await invoke(fixture());
    expect(count('tasks')).toBe(1);
    expect(count('capability_invocations')).toBe(2);
  });

  it('reauthorizes replay and isolates idempotency keys by principal', async () => {
    const dispatcher = fixture();
    await invoke(dispatcher);
    await expect(invoke(dispatcher, 'request-1', 'Draft', { ...context, authorize: () => false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await invoke(dispatcher, 'request-1', 'Draft', { ...context, principalId: 'other' });
    expect(count('tasks')).toBe(2);
    expect(count('capability_invocations')).toBe(2);
  });
});
