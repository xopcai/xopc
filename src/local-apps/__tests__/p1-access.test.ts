import { mkdtempSync, realpathSync, rmSync, writeFileSync, symlinkSync, linkSync, unlinkSync, mkdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalAppResourceScopesSchema } from '@xopcai/gateway-contract';
import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { createProductDispatcher } from '../../capabilities/runtime/product.js';
import { CapabilityError, type CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { ProjectService } from '../../projects/project-service.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { fileResourceId, fileResourceFromPath, parseFileResourceId, resolveFilePath, type FileSpaceService } from '../../files/file-service.js';
import { upsertConnectorActionMetadata, upsertConnectorConnection } from '../../storage/sqlite/connector-repository.js';
import type { ExternalToolProvider } from '../../agent/external-tools/types.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import { localAppCapabilities } from '../capabilities/runtime.js';
import { localAppConnectorOptions, readAppResourceRequest, resolveAppResourceRequest, type LocalAppP1Deps } from '../p1-services.js';

let directory: string;
beforeEach(() => { directory = realpathSync(mkdtempSync(join(tmpdir(), 'app-p1-'))); resetXopcDatabaseSingletonForTest(); seedTestDatabase(join(directory, 'xopc.db')); openXopcDatabase({ path: join(directory, 'xopc.db') }); });
afterEach(() => { vi.restoreAllMocks(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true }); });
async function fixture() {
  const projects = new ProjectService(), tasks = new TaskRepository();
  const project = projects.create({ name: 'Approved', instructions: 'PRIVATE AGENT INSTRUCTIONS' });
  const other = projects.create({ name: 'Private' });
  const task = tasks.create({ title: 'Approved task', objective: 'PRIVATE EXECUTION CONTRACT', projectId: project.id });
  const otherTask = tasks.create({ title: 'Private task', objective: 'private', projectId: other.id });
  writeFileSync(join(directory, 'approved.txt'), 'APPROVED FILE'); writeFileSync(join(directory, 'private.txt'), 'PRIVATE FILE');
  const readRef = 'composio:composio-gmail:GMAIL_GET_EMAIL', writeRef = 'composio:composio-gmail:GMAIL_SEND_EMAIL';
  const connection = upsertConnectorConnection({ id: 'connection', accountId: 'account', connectorId: 'composio-gmail', provider: 'composio', principalId: 'local-owner', providerConnectionId: 'remote', identity: { email: 'fixture@example.invalid' }, status: 'active', isDefault: true, metadata: {} });
  for (const [actionId, scope] of [['GMAIL_GET_EMAIL', 'read'], ['GMAIL_SEND_EMAIL', 'write']] as const) upsertConnectorActionMetadata({ connectorId: 'composio-gmail', actionId, scope, curated: true, cachedAt: new Date().toISOString(), inputSchema: { type: 'object' } });
  const execute = vi.fn(async (_ref: string, args: Record<string, unknown>, _approval: string | undefined, context: { authorize?: () => void }) => {
    context.authorize?.(); return { content: [{ type: 'text' as const, text: JSON.stringify({ outcome: 'success', data: args }) }], details: {} };
  });
  const provider: ExternalToolProvider = { source: 'composio', search: async () => [readRef, writeRef].map(toolRef => ({ toolRef, source: 'composio', namespace: 'composio-gmail', title: toolRef, summary: 'Fixture operation' })),
    describe: async ref => ({ toolRef: ref, source: 'composio', namespace: 'composio-gmail', title: ref, summary: 'Fixture', description: 'Fixture operation',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, xopcAccountId: { type: 'string' } }, additionalProperties: false }, readOnly: ref === readRef }), execute };
  const files = { resource: async (id: string) => {
    const locator = parseFileResourceId(id), path = await resolveFilePath(directory, locator.relativePath);
    const space = { id: 'fixture', root: resolve(directory), kind: 'workspace' as const, title: 'Fixture', bindings: [], writable: true };
    return { space, resource: await fileResourceFromPath(space, path, resolve(directory, locator.relativePath)), absolutePath: path };
  } } as FileSpaceService;
  const deps: LocalAppP1Deps = { getConfig: () => ({}) as never, getFiles: () => files, getProviders: () => [provider] };
  const options = await localAppConnectorOptions(deps);
  const dispatcher = createProductDispatcher(undefined, { getProjects: () => projects, localAppP1: deps });
  const caller: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: ['gateway.admin'], authorize: () => true };
  const bindings = dispatcher.list({ ...caller, surface: 'extension' }).map(({ id, majorVersion, descriptorDigest }) => ({ id, majorVersion, descriptorDigest }));
  const scopes = LocalAppResourceScopesSchema.parse({ projectsRead: { mode: 'selected', ids: [project.id] }, projectsWrite: { mode: 'selected', ids: [project.id] },
    tasksRead: { mode: 'selected', ids: [task.id], includeCreated: true }, tasksWrite: { mode: 'selected', ids: [task.id], projectIds: [project.id], includeCreated: true },
    filesRead: { mode: 'selected', ids: [fileResourceId('fixture', 'approved.txt')] }, filesExport: true,
    connectors: { mode: 'selected', bindings: options.map(item => item.binding) } });
  let current = true;
  const apps = { getCapabilityAccess: () => { if (!current) throw new CapabilityError('FORBIDDEN', 'Revoked'); return { releaseId: 'release', grantRevision: 'revision', resourceScopes: scopes, bindings }; } };
  const call = async (id: string, input: unknown = {}, key = crypto.randomUUID(), extensionId = 'app') => localAppCapabilities(apps, dispatcher, extensionId, 'a'.repeat(64), caller).call(id, { ...dispatcher.describe(id, { ...caller, surface: 'extension' }), input, idempotencyKey: key });
  const review = async (id: string, approve = true, principalId = caller.principalId) => resolveAppResourceRequest(deps, apps, 'app', id, readAppResourceRequest('app', id).digest, approve, { ...caller, principalId });
  return { projects, project, other, tasks, task, otherTask, scopes, call, review, execute, deps, connection, readRef, writeRef, revoke: () => { current = false; } };
}
const capture = { title: 'Captured task', activation: { mode: 'capture', phase: 'backlog' }, contract: { objective: 'Review', expectedOutputs: [], acceptanceCriteria: [], constraints: [], approvalRequired: [], assumptions: [], risks: [], outputDestinations: [] } };
it('filters project counts and pagination and limits writes to project metadata and progress', async () => {
  const f = await fixture();
  expect((await f.call('xopc.projects.list', { limit: 1 })).data).toMatchObject({ total: 1, items: [{ id: f.project.id }] });
  expect((await f.call('xopc.projects.list', { search: 'PRIVATE AGENT INSTRUCTIONS' })).data).toMatchObject({ total: 0, items: [] });
  expect((await f.call('xopc.projects.list', { search: 'Approved' })).data).toMatchObject({ total: 1 });
  expect((await f.call('xopc.projects.list', { offset: 1 })).data).toMatchObject({ total: 1, items: [] });
  expect((await f.call('xopc.projects.get', { id: f.project.id })).data).not.toHaveProperty('project.instructions');
  await expect(f.call('xopc.projects.get', { id: f.other.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.call('xopc.projects.update', { id: f.project.id, expectedVersion: f.project.version, patch: { workspaceRoot: '/tmp/escape' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await f.call('xopc.projects.create_update', { projectId: f.project.id, expectedVersion: f.project.version, summary: 'Reviewed', health: 'on_track' })).data).toMatchObject({ update: { summary: 'Reviewed' } });
  await expect(f.call('xopc.projects.update', { id: f.project.id, expectedVersion: f.project.version, patch: { name: 'Stale' } })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
});
it('creates capture-only tasks once and refuses execution authority and cross-project writes', async () => {
  const f = await fixture();
  const created = await f.call('xopc.tasks.create', capture, 'capture') as { data: { model: { task: { id: string; version: number } } } };
  expect(await f.call('xopc.tasks.create', capture, 'capture')).toEqual(created);
  expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM task_runs').get()).toMatchObject({ n: 0 });
  expect((await f.call('xopc.tasks.list')).data).toMatchObject({ total: 2 });
  await expect(f.call('xopc.tasks.get', { id: created.data.model.task.id }, 'other', 'other-app')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.call('xopc.tasks.create', { ...capture, activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.call('xopc.tasks.create', { ...capture, projectId: f.other.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.call('xopc.tasks.update', { taskId: f.task.id, expectedVersion: f.task.version, projectId: f.other.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await f.call('xopc.tasks.update', { taskId: created.data.model.task.id, expectedVersion: created.data.model.task.version, body: 'Progress recorded' })).data).toMatchObject({ task: { body: 'Progress recorded' } });
});
it('reads only selected files and rejects symlinks, hidden files and hard links', async () => {
  const f = await fixture();
  expect((await f.call('xopc.files.read', { id: fileResourceId('fixture', 'approved.txt') })).data).toMatchObject({ content: 'APPROVED FILE' });
  await expect(f.call('xopc.files.read', { id: fileResourceId('fixture', 'private.txt') })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  symlinkSync(join(directory, 'private.txt'), join(directory, 'alias.txt')); linkSync(join(directory, 'private.txt'), join(directory, 'hard.txt')); writeFileSync(join(directory, '.env'), 'PRIVATE');
  for (const path of ['alias.txt', 'hard.txt', '.env']) {
    f.scopes.filesRead = { mode: 'selected', ids: [fileResourceId('fixture', path)] };
    await expect(f.call('xopc.files.read', { id: fileResourceId('fixture', path) })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }
});
it('stages exports without writing a file and binds review to the app and exact content', async () => {
  const f = await fixture();
  const proposed = (await f.call('xopc.files.propose_export', { name: 'result.txt', content: 'Result' }, 'export')).data as { id: string };
  expect(readAppResourceRequest('app', proposed.id).status).toBe('pending');
  await expect(f.call('xopc.apps.get_request', { id: proposed.id }, 'other', 'other-app')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(await f.review(proposed.id)).toMatchObject({ status: 'approved' });
  expect(await f.review(proposed.id)).toMatchObject({ status: 'approved' });
  expect(f.execute).not.toHaveBeenCalled();
  await expect(f.call('xopc.files.propose_export', { name: '../secret', content: 'x' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
it('separates connector reads from reviewed writes and never resubmits an approved request', async () => {
  const f = await fixture();
  expect((await f.call('xopc.connectors.read', { toolRef: f.readRef, accountId: 'account', arguments: { query: 'inbox' } })).data).toHaveProperty('content');
  await expect(f.call('xopc.connectors.read', { toolRef: f.writeRef, accountId: 'account', arguments: {} })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.call('xopc.connectors.read', { toolRef: f.readRef, accountId: 'other', arguments: {} })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const proposed = (await f.call('xopc.connectors.propose_write', { toolRef: f.writeRef, accountId: 'account', arguments: { query: 'send approved' } })).data as { id: string };
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(f.execute.mock.calls[0]?.[1]).toEqual({ query: 'inbox', xopcAccountId: 'account' });
  await f.review(proposed.id); await f.review(proposed.id); expect(f.execute).toHaveBeenCalledTimes(2);
  expect((await f.call('xopc.apps.get_request', { id: proposed.id })).data).toHaveProperty('result');
  f.scopes.connectors = { mode: 'none' };
  await expect(f.call('xopc.apps.get_request', { id: proposed.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('rejects credential injection, connection changes and revoked review authority', async () => {
  const f = await fixture();
  for (const args of [{ xopcAccountId: 'other' }, { nested: { xopcSecretRef: { provider: 'secret' } } }]) {
    await expect(f.call('xopc.connectors.read', { toolRef: f.readRef, accountId: 'account', arguments: args })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  }
  const proposed = (await f.call('xopc.connectors.propose_write', { toolRef: f.writeRef, accountId: 'account', arguments: {} })).data as { id: string };
  f.revoke(); await expect(f.review(proposed.id)).rejects.toMatchObject({ code: 'FORBIDDEN' }); expect(f.execute).not.toHaveBeenCalled();
});
it('requires new connector grants after an account is reconnected', async () => {
  const f = await fixture();
  const proposed = (await f.call('xopc.connectors.propose_write', { toolRef: f.writeRef, accountId: 'account', arguments: {} })).data as { id: string };
  upsertConnectorConnection({ ...f.connection, id: 'new-connection', providerConnectionId: 'remote-reconnected', status: 'active' });
  getSqliteDatabase().prepare('UPDATE connector_accounts SET current_connection_id = ? WHERE id = ?').run('new-connection', 'account');
  await expect(f.review(proposed.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.call('xopc.connectors.read', { toolRef: f.readRef, accountId: 'account', arguments: {} })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(f.execute).not.toHaveBeenCalled();
});
it('records an uncertain in-flight write and never resubmits it after revocation', async () => {
  const f = await fixture();
  let submitted!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { submitted = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  f.execute.mockImplementationOnce(async () => { submitted(); await pending; return { content: [{ type: 'text', text: '{"outcome":"success"}' }], details: {} }; });
  const proposed = (await f.call('xopc.connectors.propose_write', { toolRef: f.writeRef, accountId: 'account', arguments: {} })).data as { id: string };
  const review = f.review(proposed.id);
  await started; f.revoke(); finish();
  await expect(review).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  expect(readAppResourceRequest('app', proposed.id)).toMatchObject({ status: 'unknown' });
  expect(await f.review(proposed.id)).toMatchObject({ status: 'unknown' });
  expect(f.execute).toHaveBeenCalledTimes(1);
});
it('does not report a provider unknown outcome as an approved write', async () => {
  const f = await fixture();
  f.execute.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"outcome":"unknown"}' }], details: {} });
  const proposed = (await f.call('xopc.connectors.propose_write', { toolRef: f.writeRef, accountId: 'account', arguments: {} })).data as { id: string };
  await expect(f.review(proposed.id)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  expect(readAppResourceRequest('app', proposed.id)).toMatchObject({ status: 'unknown' });
  await f.review(proposed.id); expect(f.execute).toHaveBeenCalledTimes(1);
});

it('preserves a rejection that wins while approval is checking the connector', async () => {
  const f = await fixture();
  const proposed = (await f.call('xopc.connectors.propose_write', { toolRef: f.writeRef, accountId: 'account', arguments: {} })).data as { id: string };
  const provider = f.deps.getProviders!()[0]!, describe = provider.describe.bind(provider);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  vi.spyOn(provider, 'describe').mockImplementationOnce(async (...args) => { entered(); await gate; return describe(...args); });
  const approving = f.review(proposed.id); await started;
  expect(await f.review(proposed.id, false, 'other-browser')).toMatchObject({ status: 'rejected' });
  release(); expect(await approving).toMatchObject({ status: 'rejected' });
  expect(readAppResourceRequest('app', proposed.id)).toMatchObject({ status: 'rejected', decision: false });
  expect(f.execute).not.toHaveBeenCalled();
});
it('locks the accepted decision and executes one request once across host identities', async () => {
  const f = await fixture();
  const proposed = (await f.call('xopc.connectors.propose_write', { toolRef: f.writeRef, accountId: 'account', arguments: {} })).data as { id: string };
  const execute = f.execute.getMockImplementation()!;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  f.execute.mockImplementationOnce(async (...args) => { entered(); await gate; return execute(...args); });
  const approving = f.review(proposed.id); await started;
  await expect(f.review(proposed.id, false, 'other-browser')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  await expect(f.review(proposed.id, true, 'approved-device')).rejects.toMatchObject({ code: 'IN_PROGRESS' });
  release(); expect(await approving).toMatchObject({ status: 'approved' });
  expect(await f.review(proposed.id, true, 'other-browser')).toMatchObject({ status: 'approved' });
  expect(f.execute).toHaveBeenCalledTimes(1);
});
it('recovers a committed receipt under another identity without repeating the external write', async () => {
  const f = await fixture();
  const proposed = (await f.call('xopc.connectors.propose_write', { toolRef: f.writeRef, accountId: 'account', arguments: {} })).data as { id: string };
  await f.review(proposed.id);
  const record = readAppResourceRequest('app', proposed.id);
  // Model a restart after the receipt commits but before the review document is finalized.
  new DurableState('local-app-resource-requests').set(proposed.id, { ...record, status: 'pending', result: undefined });
  expect(await f.review(proposed.id, true, 'approved-device')).toMatchObject({ status: 'approved' });
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(readAppResourceRequest('app', proposed.id).reviewerPrincipalId).toBe('owner');
});
it.each(['file', 'directory'] as const)('rejects a selected %s replaced by a symlink after resource resolution', async kind => {
  const f = await fixture(), files = f.deps.getFiles(), resource = files.resource.bind(files);
  let id = fileResourceId('fixture', 'approved.txt');
  if (kind === 'directory') {
    mkdirSync(join(directory, 'selected')); mkdirSync(join(directory, 'private'));
    writeFileSync(join(directory, 'selected', 'item.txt'), 'APPROVED FILE');
    writeFileSync(join(directory, 'private', 'item.txt'), 'PRIVATE FILE');
    id = fileResourceId('fixture', 'selected/item.txt'); f.scopes.filesRead = { mode: 'selected', ids: [id] };
  }
  vi.spyOn(files, 'resource').mockImplementationOnce(async selected => {
    const result = await resource(selected);
    if (kind === 'file') { unlinkSync(join(directory, 'approved.txt')); symlinkSync(join(directory, 'private.txt'), join(directory, 'approved.txt')); }
    else { renameSync(join(directory, 'selected'), join(directory, 'old-selected')); symlinkSync(join(directory, 'private'), join(directory, 'selected')); }
    return result;
  });
  await expect(f.call('xopc.files.read', { id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
