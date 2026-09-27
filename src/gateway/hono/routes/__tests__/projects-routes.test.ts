import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestDatabase } from '../../../../../test/sqlite-fixture.js';

import { ActivityService } from '../../../../activity/index.js';
import { seedTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { ExecutionEnvironmentStore } from '../../../../execution-environments/store.js';
import { ProjectService } from '../../../../projects/index.js';
import { listKnowledgeItems } from '../../../../knowledge-memory/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { defineTaskContract, TaskApplicationService } from '../../../../tasks/index.js';
import type { GatewayService } from '../../../service.js';
import { registerActivityRoutes } from '../activity.js';
import { registerProjectsRoutes } from '../projects.js';
import { registerSearchRoutes } from '../search.js';
import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import { registerSessionsRoutes } from '../sessions.js';

function registerActivityRouteApp(service: Partial<GatewayService>): Hono {
  const app = new Hono();
  registerActivityRoutes(app, { service: service as GatewayService });
  return app;
}

function registerProjectRouteApp(service: Partial<GatewayService>): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    setGatewayPrincipal(c, { kind: 'owner', principalId: 'test-owner', scopes: ['gateway.admin'] });
    await next();
  });
  registerProjectsRoutes(app, { service: { currentConfig: ConfigSchema.parse({}), ...service } as GatewayService });
  return app;
}

function registerSessionRouteApp(service: Partial<GatewayService>): Hono {
  const app = new Hono();
  registerSessionsRoutes(app, { service: { ...service, sessions: { initializeChatModel: vi.fn(async () => ({ ok: true })), getFixedAgentConfig: vi.fn(async () => ({ model: 'test/model', thinkingLevel: 'off', configVersion: 1, fixedModel: true })), ...service.sessions } } as GatewayService });
  return app;
}

function registerSearchRouteApp(service: Partial<GatewayService>): Hono {
  const app = new Hono();
  registerSearchRoutes(app, { service: service as GatewayService });
  return app;
}

describe('project association routes', () => {
  let stateDir: string;
  let previousStateDir: string | undefined;

  beforeEach(() => {
    previousStateDir = process.env.XOPC_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-project-routes-'));
    process.env.XOPC_STATE_DIR = stateDir;
    resetXopcDatabaseSingletonForTest();
    seedTestDatabase(join(stateDir, 'xopc.db'));
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    seedTestAgentCatalog({ agents: [{ id: 'main' }, { id: 'coder' }] });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    if (previousStateDir === undefined) {
      delete process.env.XOPC_STATE_DIR;
    } else {
      process.env.XOPC_STATE_DIR = previousStateDir;
    }
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('returns a structured conflict when creating with a missing workspace root', async () => {
    const projects = new ProjectService();
    const workspaceRoot = join(stateDir, 'missing-workspace');
    const app = registerProjectRouteApp({ projects });

    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceRoot }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false,
      code: 'workspace_root_missing',
      error: `Workspace root does not exist: ${join(realpathSync(stateDir), 'missing-workspace')}`,
      workspaceRoot: join(realpathSync(stateDir), 'missing-workspace'),
    });
  });

  it('version-checks pin writes and replays the original result without reapplying it', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Pin route' });
    const app = registerProjectRouteApp({ projects });
    const pin = () => app.request(`/api/projects/${project.id}/pin`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'pin-route' }, body: JSON.stringify({ expectedVersion: 1 }) });
    const first = await pin();
    expect(first.status).toBe(200);
    const result = await first.json();
    expect(result).toMatchObject({ project: { version: 2, pinnedAt: expect.any(Number) } });
    const stale = await app.request(`/api/projects/${project.id}/unpin`, { method: 'POST', body: JSON.stringify({ expectedVersion: 1 }) });
    expect(stale.status).toBe(409);
    expect((await app.request(`/api/projects/${project.id}/unpin`, { method: 'POST', body: JSON.stringify({ expectedVersion: 2 }) })).status).toBe(200);
    expect(await (await pin()).json()).toEqual(result);
    expect(projects.get(project.id)).toMatchObject({ version: 3, pinnedAt: undefined });
  });

  it('rejects malformed pin input and requires the original version for keyed retries', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Pin validation' });
    const app = registerProjectRouteApp({ projects });
    for (const body of ['null', '[]', '{', '{"expectedVersion":null}', '{"pinned":false}', '{"expectedVersion":"1"}']) {
      expect((await app.request(`/api/projects/${project.id}/pin`, { method: 'POST', body })).status).toBe(400);
    }
    expect((await app.request(`/api/projects/${project.id}/pin`, { method: 'POST', headers: { 'idempotency-key': 'pin' } })).status).toBe(400);
    expect(projects.get(project.id)?.version).toBe(1);
    expect((await app.request(`/api/projects/${project.id}/pin`, { method: 'POST' })).status).toBe(200);
    expect((await app.request('/api/projects/missing/pin', { method: 'POST' })).status).toBe(404);
  });

  it('does not delete a project while it still owns an execution environment', async () => {
    const projects = new ProjectService();
    const workspaceRoot = join(stateDir, 'protected-project');
    mkdirSync(workspaceRoot, { recursive: true });
    const project = projects.create({ workspaceRoot });
    new ExecutionEnvironmentStore().create({
      projectId: project.id,
      kind: 'local_checkout',
      rootPath: workspaceRoot,
    });
    const app = registerProjectRouteApp({ projects });

    const res = await app.request(`/api/projects/${project.id}`, { method: 'DELETE' });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: 'execution_environments_exist' });
    expect(projects.get(project.id)).not.toBeNull();
  });

  it('rejects stale or malformed deletions and replays a keyed deletion after the project is gone', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Delete route' });
    const app = registerProjectRouteApp({ projects });
    const path = `/api/projects/${project.id}`;
    for (const body of ['null', '[]', '{', '{"expectedVersion":null}', '{"expectedVersion":"1"}']) {
      expect((await app.request(path, { method: 'DELETE', body })).status).toBe(400);
    }
    expect((await app.request(path, { method: 'DELETE', headers: { 'idempotency-key': 'delete' } })).status).toBe(400);
    projects.update(project.id, { name: 'New version' });
    expect((await app.request(path, { method: 'DELETE', body: JSON.stringify({ expectedVersion: 1 }) })).status).toBe(409);
    const remove = () => app.request(path, { method: 'DELETE', headers: { 'idempotency-key': 'delete' }, body: JSON.stringify({ expectedVersion: 2 }) });
    const first = await remove();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, deleted: true, executionStopConfirmed: false });
    expect((await remove()).status).toBe(200);
    expect((await app.request(path, { method: 'DELETE' })).status).toBe(404);
  });

  it('does not expose the removed direct project delegation endpoint', async () => {
    const projects = new ProjectService();
    const app = registerProjectRouteApp({ projects } as Partial<GatewayService>);

    const res = await app.request('/api/projects/delegate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'Create a project immediately' }),
    });

    expect(res.status).toBe(404);
    expect(projects.list().total).toBe(0);
  });

  it('lists global activity and object activity through gateway routes', async () => {
    const activity = new ActivityService();
    const projectEvent = activity.record({
      type: 'project.created',
      primaryObject: { kind: 'project', id: 'project-a', title: 'Project A' },
      actor: { kind: 'system' },
      source: { kind: 'system' },
      payload: { name: 'Project A' },
      nowMs: 100,
    });
    activity.record({
      type: 'note.created',
      primaryObject: { kind: 'note', id: 'note-a', title: 'Note A' },
      actor: { kind: 'system' },
      source: { kind: 'system' },
      payload: { title: 'Note A' },
      nowMs: 200,
    });
    const app = registerActivityRouteApp({});

    const globalRes = await app.request('/api/activity?limit=1');
    expect(globalRes.status).toBe(200);
    const globalBody = await globalRes.json() as { ok: boolean; total: number; items: Array<{ id: string }> };
    expect(globalBody.ok).toBe(true);
    expect(globalBody.total).toBe(2);
    expect(globalBody.items).toHaveLength(1);

    const objectRes = await app.request('/api/activity/objects/project/project-a');
    expect(objectRes.status).toBe(200);
    const objectBody = await objectRes.json() as { ok: boolean; items: Array<{ id: string; type: string }> };
    expect(objectBody.ok).toBe(true);
    expect(objectBody.items).toEqual([
      expect.objectContaining({ id: projectEvent.id, type: 'project.created' }),
    ]);
  });

  it('rejects unsupported activity object kinds', async () => {
    const app = registerActivityRouteApp({});

    const res = await app.request('/api/activity/objects/unknown/object-a');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'Unsupported activity object kind' });
  });

  it('lists stable and optionally related project activity', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Activity Project' });
    const activity = new ActivityService();
    const stableEvent = activity.record({
      type: 'project.updated',
      primaryObject: { kind: 'project', id: project.id, title: project.name },
      actor: { kind: 'system' },
      source: { kind: 'system' },
      payload: { changes: ['brief'] },
      scopes: [{ scopeKind: 'project', scopeId: project.id, reason: 'object_owner' }],
      nowMs: 100,
    });
    const relatedEvent = activity.record({
      type: 'note.created',
      primaryObject: { kind: 'note', id: 'note-a', title: 'Related note' },
      actor: { kind: 'system' },
      source: { kind: 'system' },
      payload: { title: 'Related note' },
      relatedProjects: [{ projectId: project.id, reason: 'object_link', confidence: 0.9 }],
      nowMs: 200,
    });
    const app = registerProjectRouteApp({ projects });

    const stableRes = await app.request(`/api/projects/${project.id}/activity`);
    expect(stableRes.status).toBe(200);
    const stableBody = await stableRes.json() as { ok: boolean; items: Array<{ id: string }> };
    expect(stableBody.ok).toBe(true);
    expect(stableBody.items.map((item) => item.id)).toContain(stableEvent.id);
    expect(stableBody.items.map((item) => item.id)).not.toContain(relatedEvent.id);

    const relatedRes = await app.request(`/api/projects/${project.id}/activity?includeRelated=true`);
    expect(relatedRes.status).toBe(200);
    const relatedBody = await relatedRes.json() as { ok: boolean; items: Array<{ id: string }> };
    expect(relatedBody.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([relatedEvent.id, stableEvent.id]),
    );
  });

  it('returns 404 for missing project activity', async () => {
    const app = registerProjectRouteApp({
      projects: new ProjectService(),
    });

    const res = await app.request('/api/projects/missing/activity');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'Project not found' });
  });

  it('returns project hits from global search', async () => {
    const projects = new ProjectService();
    const project = projects.create({
      name: 'Searchable Project',
      brief: 'Coordinate the basalt rollout',
    });
    projects.create({ name: 'Unrelated Project', brief: 'Keep daily notes tidy' });
    const app = registerSearchRouteApp({ projects });

    const res = await app.request('/api/search?q=basalt&types=project');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0]).toMatchObject({
      kind: 'project',
      id: `project:${project.id}`,
      title: 'Searchable Project',
      href: `/projects/${encodeURIComponent(project.id)}`,
      payload: { project: { id: project.id } },
    });
  });

  it('pins and unpins projects through project routes', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Pin Route Project' });
    const app = registerProjectRouteApp({ projects });

    const pinRes = await app.request(`/api/projects/${project.id}/pin`, { method: 'POST' });
    expect(pinRes.status).toBe(200);
    const pinBody = await pinRes.json() as { ok: boolean; project: { id: string; pinnedAt?: number } };
    expect(pinBody.ok).toBe(true);
    expect(pinBody.project.id).toBe(project.id);
    expect(pinBody.project.pinnedAt).toEqual(expect.any(Number));

    const unpinRes = await app.request(`/api/projects/${project.id}/unpin`, { method: 'POST' });
    expect(unpinRes.status).toBe(200);
    const unpinBody = await unpinRes.json() as { ok: boolean; project: { id: string; pinnedAt?: number } };
    expect(unpinBody.ok).toBe(true);
    expect(unpinBody.project.id).toBe(project.id);
    expect(unpinBody.project.pinnedAt).toBeUndefined();
  });

  it('includes an operating summary when requested by the mobile portfolio', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Mobile Portfolio Project' });
    const app = registerProjectRouteApp({ projects });

    const response = await app.request('/api/projects?includeOperating=true');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      items: Array<{ id: string; operating?: { health: string; counts: Record<string, number> } }>;
    };
    expect(body.items.find((item) => item.id === project.id)?.operating).toEqual(expect.objectContaining({
      health: 'empty',
      counts: { ready: 0, moving: 0, waiting: 0, needsUser: 0, done: 0 },
    }));
  });

  it('manages milestones and appends project updates through project routes', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Operating Route Project' });
    const app = registerProjectRouteApp({ projects });

    const milestoneRes = await app.request(`/api/projects/${project.id}/milestones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Beta', status: 'active', sortOrder: 1 }),
    });
    expect(milestoneRes.status).toBe(201);

    const updateRes = await app.request(`/api/projects/${project.id}/updates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        health: 'at_risk',
        summary: 'One external review remains.',
        risks: ['Review delay'],
        nextSteps: ['Resolve the review wait'],
      }),
    });
    expect(updateRes.status).toBe(201);

    const detailRes = await app.request(`/api/projects/${project.id}`);
    const detail = await detailRes.json() as { project: { health: string; milestones: unknown[]; recentUpdates: unknown[] } };
    expect(detail.project).toMatchObject({ health: 'at_risk' });
    expect(detail.project.milestones).toHaveLength(1);
    expect(detail.project.recentUpdates).toHaveLength(1);
  });

  it('validates projectId before patching session metadata', async () => {
    const patch = vi.fn(async () => ({ ok: true as const }));
    const attachSession = vi.fn();
    const detachSession = vi.fn();
    const app = registerSessionRouteApp({
      sessions: {
        patch,
        getSession: vi.fn(async () => ({ key: "958be7fd-89d5-48d0-8a78-4d900096a8fb", name: 'Old name' })),
      } as unknown as GatewayService['sessions'],
      projects: {
        get: vi.fn(() => null),
        attachSession,
        detachSession,
      } as unknown as GatewayService['projects'],
    });

    const res = await app.request('/api/sessions/958be7fd-89d5-48d0-8a78-4d900096a8fb', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New name', projectId: 'missing-project' }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'Project not found' });
    expect(patch).not.toHaveBeenCalled();
    expect(attachSession).not.toHaveBeenCalled();
    expect(detachSession).not.toHaveBeenCalled();
  });

  it('detaches a session when projectId is explicitly null', async () => {
    const patch = vi.fn(async () => ({ ok: true as const }));
    const detachSession = vi.fn();
    const getSession = vi.fn(async () => ({
      key: "958be7fd-89d5-48d0-8a78-4d900096a8fb",
      projectId: undefined,
    }));
    const app = registerSessionRouteApp({
      sessions: { patch, getSession } as unknown as GatewayService['sessions'],
      projects: {
        get: vi.fn(),
        attachSession: vi.fn(),
        detachSession,
      } as unknown as GatewayService['projects'],
    });

    const res = await app.request('/api/sessions/958be7fd-89d5-48d0-8a78-4d900096a8fb', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: null }),
    });

    expect(res.status).toBe(200);
    expect(patch).toHaveBeenCalledWith("958be7fd-89d5-48d0-8a78-4d900096a8fb", {});
    expect(detachSession).toHaveBeenCalledWith("958be7fd-89d5-48d0-8a78-4d900096a8fb");
    expect(getSession).toHaveBeenCalledWith("958be7fd-89d5-48d0-8a78-4d900096a8fb");
  });

  it('requires releasing the execution environment before moving a session', async () => {
    const conversationId = "95343719-66e8-4181-85cd-1b3984c2f916";
    const projects = new ProjectService();
    const oldRoot = join(stateDir, 'old-project');
    const newRoot = join(stateDir, 'new-project');
    mkdirSync(oldRoot, { recursive: true });
    mkdirSync(newRoot, { recursive: true });
    const oldProject = projects.create({ name: 'Old project', workspaceRoot: oldRoot });
    const newProject = projects.create({ name: 'New project', workspaceRoot: newRoot });
    const store = new ExecutionEnvironmentStore();
    const requested = store.create({
      projectId: oldProject.id,
      kind: 'local_checkout',
      rootPath: oldRoot,
    });
    const provisioning = store.transition({
      environmentId: requested.id,
      expectedVersion: requested.version,
      toStatus: 'provisioning',
      reason: 'test provisioning',
    });
    const ready = store.transition({
      environmentId: requested.id,
      expectedVersion: provisioning.version,
      toStatus: 'ready',
      reason: 'test ready',
    });
    store.bind({ conversationId: conversationId, environmentId: ready.id });
    const patch = vi.fn(async () => ({ ok: true as const }));
    const app = registerSessionRouteApp({
      sessions: {
        patch,
        getSession: vi.fn(async () => ({ key: conversationId, projectId: oldProject.id })),
      } as unknown as GatewayService['sessions'],
      projects,
    });

    const res = await app.request(`/api/sessions/${conversationId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: newProject.id }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: 'execution_environment_active' });
    expect(patch).not.toHaveBeenCalled();
  });

  it.each(['webchat', 'automation', 'understanding'])('omits hidden %s sessions from project session lists', async (source) => {
    const hiddenKey = crypto.randomUUID();
    const visibleKey = "f6220a1c-2b77-40ac-8386-fd31474221a9";
    const app = registerProjectRouteApp({
      projects: {
        listConversationIds: vi.fn(() => [hiddenKey, visibleKey]),
      } as unknown as GatewayService['projects'],
      sessions: {
        getSession: vi.fn(async (key: string) => key === hiddenKey
          ? {
              key,
              messageCount: 0,
              hiddenFromSessionList: true,
              routing: { peerId: source === 'webchat' ? 'chat_1783525363859' : 'automation-run' },
              customData: source === 'understanding' ? { workDiscovery: true }
                : source === 'webchat' ? { genericNewChatShell: true } : { origin: 'automation' },
            }
          : {
              key,
              messageCount: 2,
              hiddenFromSessionList: false,
              routing: { peerId: 'chat_1783526000000' },
              customData: { genericNewChatShell: true },
            }),
      } as unknown as GatewayService['sessions'],
    });

    const res = await app.request('/api/projects/project-a/sessions');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sessions: Array<{ key: string }> };
    expect(body.ok).toBe(true);
    expect(body.sessions).toEqual([expect.objectContaining({ key: visibleKey })]);
  });

  it('does not detach a session that is no longer attached to the route project', async () => {
    const detachSession = vi.fn();
    const app = registerProjectRouteApp({
      sessions: {
        getSession: vi.fn(async () => ({
          key: "958be7fd-89d5-48d0-8a78-4d900096a8fb",
          projectId: 'project-b',
        })),
      } as unknown as GatewayService['sessions'],
      projects: {
        get: vi.fn((id: string) => (id === 'project-a' ? { id, name: 'Project A' } : null)),
        detachSession,
      } as unknown as GatewayService['projects'],
    });

    const res = await app.request('/api/projects/project-a/sessions/958be7fd-89d5-48d0-8a78-4d900096a8fb', {
      method: 'DELETE',
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: 'Session is not attached to this project' });
    expect(detachSession).not.toHaveBeenCalled();
  });

  it('updates a stable project digest memory record instead of creating duplicates', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Digest Project', brief: 'Keep a stable digest' });
    const tasks = new TaskApplicationService();
    const capture = (title: string) => tasks.create({
      idempotencyKey: `digest:${title}`,
      title,
      projectId: project.id,
      priority: 'normal',
      contract: { ...defineTaskContract(title), acceptancePolicy: 'verified_auto', outputDestinations: [] },
      dependencies: [], context: [], authorityGrants: [],
      activation: { mode: 'capture', phase: 'backlog' },
    });
    capture('Ship the digest flow');
    const app = registerProjectRouteApp({
      currentConfig: ConfigSchema.parse({}),
      projects,
      sessions: {
        getSession: vi.fn(),
      } as unknown as GatewayService['sessions'],
    });

    const first = await app.request(`/api/projects/${project.id}/digest-knowledge`, { method: 'POST' });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { knowledge: { id: string; content: string } };
    expect(firstBody.knowledge.content).toContain('Ship the digest flow');

    capture('Review the updated digest');
    const second = await app.request(`/api/projects/${project.id}/digest-knowledge`, { method: 'POST' });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { knowledge: { id: string; content: string } };
    expect(secondBody.knowledge.id).toBe(firstBody.knowledge.id);

    const records = listKnowledgeItems({ statuses: ['active'], limit: 10 })
      .filter((item) => item.scope.type === 'project' && item.scope.id === project.id);
    expect(records).toHaveLength(1);
    expect(records[0]?.canonicalKey).toBe(`project-digest:${project.id}`);
    expect(records[0]?.content).toContain('Review the updated digest');
  });

});
