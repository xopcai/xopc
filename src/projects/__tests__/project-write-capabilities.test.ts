import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { createProductDispatcher } from '../../capabilities/runtime/product.js';
import { ConfigSchema } from '../../config/schema.js';
import { ExecutionEnvironmentStore } from '../../execution-environments/store.js';
import { closeXopcDatabase, ensureSessionRecord, getSessionMetadata, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import type { WorkDiscoveryService } from '../../work-discovery/service.js';
import { ProjectService } from '../project-service.js';
import * as workspace from '../workspace-project.js';

describe('project create and edit capabilities', () => {
  let directory: string;
  let projects: ProjectService;
  const context: CapabilityContext = { principalId: 'user', surface: 'http', scopes: ['workspace.write'], authorize: () => true };
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-project-writes-'));
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
  function dispatcher(understanding?: WorkDiscoveryService) {
    return createProductDispatcher(undefined, { getProjects: () => projects, getConfig: () => ConfigSchema.parse({}), getWorkDiscovery: () => understanding });
  }

  it('creates a workspace and project once and replays the original result across surfaces', async () => {
    const runtime = dispatcher();
    const operation = 'xopc.projects.create';
    const input = { name: 'Created', workspaceRoot: join(directory, 'created'), createWorkspaceRoot: true };
    const options = { ...runtime.describe(operation, context), idempotencyKey: 'create' };
    const first = await runtime.call(operation, input, context, options);
    expect(existsSync(input.workspaceRoot)).toBe(true);
    expect(await runtime.call(operation, input, { ...context, surface: 'agent' }, options)).toEqual(first);
    expect(projects.list().total).toBe(1);
    await expect(runtime.call(operation, { ...input, name: 'Changed' }, context, options)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(runtime.call(operation, input, { ...context, authorize: () => false }, options)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects invalid filesystem roots without internal errors', async () => {
    const runtime = dispatcher();
    const operation = 'xopc.projects.create';
    await expect(runtime.call(operation, { name: 'Invalid', workspaceRoot: '/' }, context,
      { ...runtime.describe(operation, context), idempotencyKey: 'invalid' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(projects.list().total).toBe(0);
  });

  it('resolves, creates, and binds once through the same durable receipt', async () => {
    const root = join(directory, 'resolved');
    mkdirSync(root);
    const conversationId = 'b9d376ef-df81-41d6-8000-0ce9282047ae';
    const runtime = dispatcher();
    const operation = 'xopc.projects.resolve_workspace';
    const input = { workspacePath: root, autoCreate: true, agentId: 'main', conversationId };
    const options = { ...runtime.describe(operation, context), idempotencyKey: 'resolve' };
    const first = await runtime.call(operation, input, context, options);
    const project = projects.list().items[0];
    expect(first).toMatchObject({ created: true, reason: 'auto_created', project: { id: project.id, version: 2 } });
    expect(getSessionMetadata(conversationId)?.projectId).toBe(project.id);
    expect(await runtime.call(operation, input, { ...context, surface: 'agent' }, options)).toEqual(first);
    expect(projects.get(project.id)?.version).toBe(2);
    expect(projects.list().total).toBe(1);
  });

  it('does not let routing hints replace stored conversation routing', async () => {
    const root = join(directory, 'routing');
    mkdirSync(root);
    const project = projects.create({ name: 'Other agent', workspaceRoot: root, defaultAgentId: 'other' });
    const conversationId = 'b9d376ef-df81-41d6-8000-0ce9282047ae';
    ensureSessionRecord(conversationId, root, { routing: { agentId: 'main', source: 'web', accountId: 'default', peerKind: 'direct', peerId: conversationId } });
    const runtime = dispatcher();
    const operation = 'xopc.projects.resolve_workspace';
    await runtime.call(operation, { workspacePath: root, agentId: 'other', conversationId }, context,
      { ...runtime.describe(operation, context), idempotencyKey: 'routing' });
    expect(getSessionMetadata(conversationId)?.projectId).toBeUndefined();
    expect(projects.get(project.id)?.version).toBe(1);
  });

  it('rolls back an auto-created project rather than reassigning a bound conversation', async () => {
    const root = join(directory, 'conflict');
    mkdirSync(root);
    const project = projects.create({ name: 'Original' });
    const conversationId = 'b9d376ef-df81-41d6-8000-0ce9282047ae';
    ensureSessionRecord(conversationId, root, { agentId: 'main', projectId: project.id });
    const runtime = dispatcher();
    const operation = 'xopc.projects.resolve_workspace';
    await expect(runtime.call(operation, { workspacePath: root, autoCreate: true, agentId: 'main', conversationId }, context,
      { ...runtime.describe(operation, context), idempotencyKey: 'conflict' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(projects.list().total).toBe(1);
    expect(getSessionMetadata(conversationId)?.projectId).toBe(project.id);
  });

  it('rolls back workspace intent and project if output validation fails', async () => {
    const root = join(directory, 'rollback');
    const create = projects.create.bind(projects);
    vi.spyOn(projects, 'create').mockImplementation(input => ({ ...create(input), name: 42 } as never));
    const runtime = dispatcher();
    const operation = 'xopc.projects.create';
    await expect(runtime.call(operation, { name: 'Rollback', workspaceRoot: root, createWorkspaceRoot: true }, context,
      { ...runtime.describe(operation, context), idempotencyKey: 'rollback' })).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(projects.list().total).toBe(0);
    expect(existsSync(root)).toBe(false);
    expect(getSqliteDatabase().prepare('SELECT * FROM project_workspace_creation').all()).toHaveLength(0);
    expect(getSqliteDatabase().prepare("SELECT * FROM domain_outbox WHERE subject_kind = 'project'").all()).toHaveLength(0);
  });

  it('recovers failed directory creation with the same key without creating a second project', async () => {
    const root = join(directory, 'recover');
    vi.spyOn(workspace, 'ensureWorkspaceDirectory').mockImplementationOnce(() => { throw new Error('temporary failure'); });
    const runtime = dispatcher();
    const operation = 'xopc.projects.create';
    const input = { name: 'Recover', workspaceRoot: root, createWorkspaceRoot: true };
    const options = { ...runtime.describe(operation, context), idempotencyKey: 'recover' };
    await expect(runtime.call(operation, input, context, options)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const project = projects.list().items[0];
    expect(existsSync(root)).toBe(false);
    expect(await runtime.call(operation, input, context, options)).toMatchObject({ project: { id: project.id, version: 1 } });
    expect(existsSync(root)).toBe(true);
    expect(projects.list().total).toBe(1);
  });

  it('queues automatic understanding once, not on receipt replay', async () => {
    const startProjectUnderstanding = vi.fn();
    const runtime = dispatcher({ startProjectUnderstanding } as unknown as WorkDiscoveryService);
    const operation = 'xopc.projects.create';
    const options = { ...runtime.describe(operation, context), idempotencyKey: 'understand' };
    const first = await runtime.call(operation, { name: 'Understand', autoUnderstand: true }, context, options);
    expect(await runtime.call(operation, { name: 'Understand', autoUnderstand: true }, context, options)).toEqual(first);
    expect(startProjectUnderstanding).toHaveBeenCalledTimes(1);
  });

  it('rejects stale edits and preserves a later edit when replaying an old receipt', async () => {
    const project = projects.create({ name: 'Initial' });
    const runtime = dispatcher();
    const operation = 'xopc.projects.update';
    const options = { ...runtime.describe(operation, context), idempotencyKey: 'edit' };
    const input = { id: project.id, expectedVersion: 1, patch: { name: 'First edit' } };
    const first = await runtime.call(operation, input, context, options);
    projects.update(project.id, { name: 'Later edit' });
    expect(await runtime.call(operation, input, context, options)).toEqual(first);
    await expect(runtime.call(operation, input, context, { ...options, idempotencyKey: 'stale' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(projects.get(project.id)).toMatchObject({ name: 'Later edit', version: 3 });
  });

  it('shares agent validation and execution environment protection without creating a directory', async () => {
    const project = projects.create({ name: 'Protected' });
    const runtime = dispatcher();
    const operation = 'xopc.projects.update';
    const options = { ...runtime.describe(operation, context), idempotencyKey: 'protected' };
    await expect(runtime.call(operation, { id: project.id, expectedVersion: 1, patch: { defaultAgentId: 'not-configured' } }, context, options))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const registered = join(directory, 'registered');
    mkdirSync(registered);
    new ExecutionEnvironmentStore().create({ projectId: project.id, kind: 'local_checkout', rootPath: registered });
    const root = join(directory, 'blocked');
    await expect(runtime.call(operation, { id: project.id, expectedVersion: 1, patch: { workspaceRoot: root, createWorkspaceRoot: true } }, context, options))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(existsSync(root)).toBe(false);
    expect(projects.get(project.id)).toEqual(project);
  });
});
