import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createXopcUseTool } from '../../agent/tools/xopc-use-tool.js';
import { type CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { createProductDispatcher } from '../../capabilities/runtime/product.js';
import { ExecutionEnvironmentStore } from '../../execution-environments/store.js';
import { closeXopcDatabase, ensureSessionRecord, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { createWorkDiscoveryRun, getWorkDiscoveryRun, listPendingProjectUnderstandingRuns } from '../../work-discovery/repository.js';
import { ProjectService } from '../project-service.js';

describe('project deletion capability', () => {
  let directory: string;
  let projects: ProjectService;
  const writer: CapabilityContext = { principalId: 'user', surface: 'http', scopes: ['workspace.write'], authorize: () => true };
  const operation = 'xopc.projects.delete';
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-project-delete-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    projects = new ProjectService();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  });
  function run(projectId: string, status: 'queued' | 'analyzing' | 'completed' = 'queued') {
    const id = randomUUID();
    const conversationId = randomUUID();
    ensureSessionRecord(conversationId, directory, { agentId: 'main', projectId });
    return createWorkDiscoveryRun({ id, idempotencyKey: id, projectId, conversationId, status, mode: 'background',
      source: 'manual_selected_directory', rootPath: directory, agentId: 'main', modelRef: 'test/model', scanPolicyVersion: 1, createdAt: Date.now() });
  }
  function fixture(id: string, expectedVersion = 1) {
    const dispatcher = createProductDispatcher(undefined, { getProjects: () => projects });
    const input = { id, expectedVersion };
    const options = { ...dispatcher.describe(operation, writer), idempotencyKey: 'delete-project' };
    return { dispatcher, input, options, call: () => dispatcher.call(operation, input, writer, options) };
  }

  it('persists stop intent for pending runs before cascading deletion and preserves files and other projects', async () => {
    const project = projects.create({ name: 'Deleted', workspaceRoot: directory });
    const other = projects.create({ name: 'Other' });
    const queued = run(project.id);
    const active = run(project.id, 'analyzing');
    const completed = run(project.id, 'completed');
    const untouched = run(other.id);
    const file = join(directory, 'keep.txt');
    writeFileSync(file, 'user content');
    const { call, dispatcher, input, options } = fixture(project.id);
    expect(await call()).toEqual({ ok: true, deleted: true, executionStopConfirmed: false });
    expect(await call()).toEqual({ ok: true, deleted: true, executionStopConfirmed: false });
    expect(projects.get(project.id)).toBeNull();
    expect(getWorkDiscoveryRun(queued.id)).toBeNull();
    expect(getWorkDiscoveryRun(active.id)).toBeNull();
    expect(getWorkDiscoveryRun(completed.id)).toBeNull();
    expect(listPendingProjectUnderstandingRuns().map(item => item.id)).toEqual([untouched.id]);
    expect(existsSync(file)).toBe(true);
    const events = getSqliteDatabase().prepare("SELECT * FROM domain_outbox WHERE event_type = 'project.deleted'").all();
    expect(events).toHaveLength(1);
    expect(JSON.parse(String(events[0].payload_json)).deletedUnderstandingRunIds.sort()).toEqual([queued.id, active.id].sort());
    await expect(dispatcher.call(operation, input, { ...writer, authorize: () => false }, options)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rolls project, cancellation, event and receipt back when receipt persistence fails', async () => {
    const project = projects.create({ name: 'Rollback' });
    const pending = run(project.id);
    getSqliteDatabase().exec(`CREATE TRIGGER reject_delete_receipt BEFORE INSERT ON capability_operations
      BEGIN SELECT RAISE(ABORT, 'receipt failure'); END`);
    const { call } = fixture(project.id);
    await expect(call()).rejects.toThrow();
    expect(projects.get(project.id)).toEqual(project);
    expect(getWorkDiscoveryRun(pending.id)).toEqual(pending);
    expect(getSqliteDatabase().prepare("SELECT * FROM domain_outbox WHERE event_type = 'project.deleted'").all()).toHaveLength(0);
    expect(getSqliteDatabase().prepare('SELECT * FROM capability_operations').all()).toHaveLength(0);
    getSqliteDatabase().exec('DROP TRIGGER reject_delete_receipt');
    expect(await call()).toMatchObject({ deleted: true });
  });

  it('does not cancel or delete when the project version is stale or an execution environment exists', async () => {
    const project = projects.create({ name: 'Protected' });
    const pending = run(project.id);
    projects.update(project.id, { name: 'Newer' });
    await expect(fixture(project.id).call()).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    new ExecutionEnvironmentStore().create({ projectId: project.id, kind: 'local_checkout', rootPath: directory });
    await expect(fixture(project.id, 2).call()).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(() => projects.delete(project.id)).toThrow('execution environments');
    expect(getWorkDiscoveryRun(pending.id)).toEqual(pending);
    expect(projects.get(project.id)?.version).toBe(2);
  });

  it('replays after reopening the database without recreating the deleted project or cancellation', async () => {
    const project = projects.create({ name: 'Recover' });
    const pending = run(project.id);
    vi.spyOn(projects, 'flushCommittedEffects').mockImplementationOnce(() => { throw new Error('notification failed'); });
    const { call } = fixture(project.id);
    await expect(call()).rejects.toThrow('notification failed');
    const event = getSqliteDatabase().prepare("SELECT payload_json FROM domain_outbox WHERE event_type = 'project.deleted'").get();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    expect(await call()).toMatchObject({ deleted: true });
    expect(getWorkDiscoveryRun(pending.id)).toBeNull();
    expect(getSqliteDatabase().prepare("SELECT payload_json FROM domain_outbox WHERE event_type = 'project.deleted'").get()).toEqual(event);
    expect(projects.get(project.id)).toBeNull();
  });

  it('supports Agent dry run and replay without looking up an already deleted project', async () => {
    const project = projects.create({ name: 'Agent deletion' });
    const tool = createXopcUseTool({ getProjectService: () => projects });
    const args = { projectId: project.id, expectedVersion: 1, idempotencyKey: 'agent-delete' };
    await tool.execute('preview', { mode: 'project', command: 'delete', args, dryRun: true });
    expect(projects.get(project.id)).toEqual(project);
    const first = await tool.execute('delete', { mode: 'project', command: 'delete', args });
    expect(first.details.result).toMatchObject({ deleted: true, executionStopConfirmed: false });
    expect(await tool.execute('replay', { mode: 'project', command: 'delete', args })).toEqual(first);
    expect(projects.get(project.id)).toBeNull();
  });
});
