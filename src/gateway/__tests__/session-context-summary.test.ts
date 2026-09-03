import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { LocalWorktreeManager } from '../../execution-environments/local-worktree-manager.js';
import { ExecutionEnvironmentStore } from '../../execution-environments/store.js';
import { ProjectStore } from '../../projects/project-store.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { ensureSessionRecord } from '../../storage/sqlite/session-repository.js';
import { upsertNoteRecord } from '../../storage/sqlite/notes-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { TaskContextRepository } from '../../tasks/task-context-repository.js';
import { TaskConversationRepository } from '../../tasks/task-conversation-repository.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { registerSessionsRoutes } from '../hono/routes/sessions.js';
import { gatewayScopes } from '../hono/middleware/scopes.js';
import { setGatewayPrincipal } from '../security/gateway-principal.js';
import type { GatewayScope } from '../security/gateway-scopes.js';
import type { GatewayService } from '../service.js';
import { getSessionContextSummary } from '../session-context-summary.js';

describe('session context summary', () => {
  let directory: string;
  let projectId: string;
  let config: ReturnType<typeof ConfigSchema.parse>;
  const sessionKey = 'agent:main:webchat:default:direct:summary';
  const owner = ['gateway.admin'] as const;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const note = (id: string, status: 'inbox' | 'trashed' = 'inbox') => upsertNoteRecord({
    id, title: `Title ${id}`, kind: 'thought', status, markdown: 'PRIVATE BODY',
    capturedVia: { channel: 'web' }, createdAt: 1, updatedAt: 1,
  });
  const activeTask = () => {
    const task = new TaskRepository().create({ title: 'Current task', objective: 'PRIVATE OBJECTIVE', projectId });
    new TaskConversationRepository().activateExecutionSession({ taskId: task.id, sessionKey, agentId: 'main' });
    return task;
  };
  const link = (taskId: string, targetId: string) => new TaskContextRepository().add({
    taskId, targetId, targetKind: 'note', role: 'reference', title: 'STALE PRIVATE TITLE', createdBy: { kind: 'user', id: 'owner' },
  });

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-context-summary-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    config = ConfigSchema.parse({ agents: { list: [{ id: 'main', workspace: directory }] } });
    projectId = new ProjectStore().create({ name: 'Project', workspaceRoot: directory }).id;
    ensureSessionRecord(sessionKey, directory, { projectId, customData: {
      sourceBinding: { kind: 'note', sourceId: 'note-a', version: 'v1', attachedAt: 1 }, secret: 'PRIVATE DATA',
    } });
    note('note-a');
  });
  afterEach(() => {
    getSqliteDatabase().exec('PRAGMA query_only = OFF');
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads metadata only with the database in read-only mode, merging source provenance', async () => {
    const task = activeTask();
    link(task.id, 'note-a');
    new TaskRepository().create({ title: 'Unrelated task', objective: 'Other', projectId });
    getSqliteDatabase().exec('PRAGMA query_only = ON');
    const result = await getSessionContextSummary(config, sessionKey, owner);
    expect(result?.work).toEqual({ project: { id: projectId, title: 'Project' }, task: { id: task.id, title: task.title, phase: task.phase } });
    expect(result?.sources).toEqual([{ kind: 'note', id: 'note-a', title: 'Title note-a', origins: [{ kind: 'session', version: 'v1' }, { kind: 'task' }] }]);
    expect(result?.environment).toEqual({ kind: 'local_checkout', rootPath: directory, available: true });
    expect(result?.unavailableSections).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|Unrelated/);
  });

  it('does not infer a current task from project membership', async () => {
    new TaskRepository().create({ title: 'Unrelated', objective: 'Other', projectId });
    expect((await getSessionContextSummary(config, sessionKey, owner))?.work.task).toBeUndefined();
  });

  it('hides deleted and trashed titles, never using stored edge labels', async () => {
    const task = activeTask();
    link(task.id, 'deleted');
    note('note-a', 'trashed');
    const result = await getSessionContextSummary(config, sessionKey, owner);
    expect(result?.sources).toHaveLength(2);
    expect(result?.sources.every((source) => source.unavailable && !source.title)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Title|STALE/);
  });

  it('bounds the source list and reports overflow', async () => {
    const task = activeTask();
    for (let i = 0; i < 30; i++) link(task.id, `source-${i}`);
    const result = await getSessionContextSummary(config, sessionKey, owner);
    expect(result?.sources).toHaveLength(20);
    expect(result?.sourcesHasMore).toBe(true);
    expect(result?.sources[0]?.id).toBe('note-a');
  });

  it('omits cross-resource data when the device only has sessions.read', async () => {
    activeTask();
    const result = await getSessionContextSummary(config, sessionKey, ['sessions.read']);
    expect(result).toMatchObject({ work: {}, sources: [], unavailableSections: ['work', 'sources', 'environment'] });
    expect(result?.environment).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(projectId);
  });

  it('does not reveal task references without tasks.read', async () => {
    const task = activeTask();
    link(task.id, 'task-only-note');
    const result = await getSessionContextSummary(config, sessionKey, ['sessions.read', 'workspace.read']);
    expect(result?.work.task).toBeUndefined();
    expect(result?.sources.map((source) => source.id)).toEqual(['note-a']);
  });

  it('reports live branch and detached HEAD without changing the repository', async () => {
    git('init', '--initial-branch=summary-test');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'Initial');
    const sha = git('rev-parse', 'HEAD');
    expect((await getSessionContextSummary(config, sessionKey, owner))?.environment).toMatchObject({ branch: 'summary-test', headSha: sha, detached: false });
    git('checkout', '--detach');
    expect((await getSessionContextSummary(config, sessionKey, owner))?.environment).toMatchObject({ headSha: sha, detached: true });
    expect(git('rev-parse', 'HEAD')).toBe(sha);
  });

  it('never falls back to the project directory when a bound workspace disappears', async () => {
    const rootPath = join(directory, 'bound');
    mkdirSync(rootPath);
    const store = new ExecutionEnvironmentStore();
    const environment = await new LocalWorktreeManager({ store }).registerLocalCheckout({ workspacePath: rootPath });
    store.bind({ sessionKey, environmentId: environment.id });
    rmSync(rootPath, { recursive: true });
    expect((await getSessionContextSummary(config, sessionKey, owner))?.environment).toMatchObject({ rootPath, available: false });
  });

  it('reports the managed worktree HEAD and fails closed when its Git metadata disappears', async () => {
    const repositoryPath = join(directory, 'repo');
    mkdirSync(repositoryPath);
    const repoGit = (...args: string[]) => execFileSync('git', ['-C', repositoryPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    repoGit('init', '--initial-branch=main');
    repoGit('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'Initial');
    const store = new ExecutionEnvironmentStore();
    const environment = await new LocalWorktreeManager({ store, stateDir: directory }).provisionManagedWorktree({ projectId, repositoryPath });
    store.bind({ sessionKey, environmentId: environment.id });
    expect((await getSessionContextSummary(config, sessionKey, owner))?.environment).toMatchObject({
      kind: 'managed_worktree', rootPath: environment.rootPath, available: true, detached: true, headSha: repoGit('rev-parse', 'HEAD'),
    });
    rmSync(join(environment.rootPath, '.git'));
    expect((await getSessionContextSummary(config, sessionKey, owner))?.environment).toEqual({
      kind: 'managed_worktree', rootPath: environment.rootPath, available: false,
    });
  });

  it('returns 404 for missing sessions and enforces the route read scope', async () => {
    const appFor = (scopes: GatewayScope[]) => {
      const app = new Hono();
      app.use('*', async (c, next) => { setGatewayPrincipal(c, { kind: 'device', principalId: 'device', scopes }); await next(); });
      app.use('*', gatewayScopes());
      registerSessionsRoutes(app, { service: { isGatewayReady: () => true, currentConfig: config } as GatewayService });
      return app;
    };
    expect((await appFor(['workspace.read']).request(`/api/sessions/${encodeURIComponent(sessionKey)}/context-summary`)).status).toBe(403);
    expect((await appFor(['sessions.read']).request('/api/sessions/missing/context-summary')).status).toBe(404);
    const response = await appFor(['sessions.read']).request(`/api/sessions/${encodeURIComponent(sessionKey)}/context-summary`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).summary.work).toEqual({});
  });
});
