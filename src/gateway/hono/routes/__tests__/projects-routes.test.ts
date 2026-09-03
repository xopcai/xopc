import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityService } from '../../../../activity/index.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { ExecutionEnvironmentStore } from '../../../../execution-environments/store.js';
import { ProjectService } from '../../../../projects/index.js';
import {
  closeXopcDatabase,
  ensureSessionRecord,
  listMemoryRecords,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { defineTaskContract, TaskApplicationService } from '../../../../tasks/index.js';
import type { GatewayService } from '../../../service.js';
import { registerActivityRoutes } from '../activity.js';
import { registerProjectsRoutes } from '../projects.js';
import { registerSearchRoutes } from '../search.js';
import { registerSessionsRoutes } from '../sessions.js';

function registerActivityRouteApp(service: Partial<GatewayService>): Hono {
  const app = new Hono();
  registerActivityRoutes(app, { service: service as GatewayService });
  return app;
}

function registerProjectRouteApp(service: Partial<GatewayService>): Hono {
  const app = new Hono();
  registerProjectsRoutes(app, { service: { currentConfig: ConfigSchema.parse({}), ...service } as GatewayService });
  return app;
}

function registerSessionRouteApp(service: Partial<GatewayService>): Hono {
  const app = new Hono();
  registerSessionsRoutes(app, { service: service as GatewayService });
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
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
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
      error: `Workspace root does not exist: ${workspaceRoot}`,
      workspaceRoot,
    });
  });

  it('does not delete a project while it still owns an execution environment', async () => {
    const projects = new ProjectService();
    const workspaceRoot = join(stateDir, 'protected-project');
    mkdirSync(workspaceRoot, { recursive: true });
    const project = projects.create({ workspaceRoot });
    new ExecutionEnvironmentStore().create({
      projectId: project.id,
      hostId: 'local',
      kind: 'local_checkout',
      rootPath: workspaceRoot,
    });
    const app = registerProjectRouteApp({ projects });

    const res = await app.request(`/api/projects/${project.id}`, { method: 'DELETE' });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: 'execution_environments_exist' });
    expect(projects.get(project.id)).not.toBeNull();
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
        getSession: vi.fn(async () => ({ key: 'agent:main:webchat:default:direct:s1', name: 'Old name' })),
      } as unknown as GatewayService['sessions'],
      projects: {
        get: vi.fn(() => null),
        attachSession,
        detachSession,
      } as unknown as GatewayService['projects'],
    });

    const res = await app.request('/api/sessions/agent:main:webchat:default:direct:s1', {
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
      key: 'agent:main:webchat:default:direct:s1',
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

    const res = await app.request('/api/sessions/agent:main:webchat:default:direct:s1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: null }),
    });

    expect(res.status).toBe(200);
    expect(patch).toHaveBeenCalledWith('agent:main:webchat:default:direct:s1', {});
    expect(detachSession).toHaveBeenCalledWith('agent:main:webchat:default:direct:s1');
    expect(getSession).toHaveBeenCalledWith('agent:main:webchat:default:direct:s1');
  });

  it('requires releasing the execution environment before moving a session', async () => {
    const sessionKey = 'agent:main:webchat:default:direct:bound-session';
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
      hostId: 'local',
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
    store.bind({ subjectKind: 'session', subjectId: sessionKey, environmentId: ready.id });
    const patch = vi.fn(async () => ({ ok: true as const }));
    const app = registerSessionRouteApp({
      sessions: {
        patch,
        getSession: vi.fn(async () => ({ key: sessionKey, projectId: oldProject.id })),
      } as unknown as GatewayService['sessions'],
      projects,
    });

    const res = await app.request(`/api/sessions/${sessionKey}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: newProject.id }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: 'execution_environment_active' });
    expect(patch).not.toHaveBeenCalled();
  });

  it('creates project sessions with the project default agent when no agent is explicit', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Agent Project', defaultAgentId: 'coder' });
    const listSessions = vi.fn(async () => ({ items: [] }));
    const app = registerSessionRouteApp({
      currentConfig: {
        agents: {
          default: 'main',
          list: [{ id: 'main', enabled: true }, { id: 'coder', enabled: true }],
        },
      },
      projects,
      sessions: {
        listSessions,
        getSession: vi.fn(async (key: string) => ({ key, routing: { agentId: key.split(':')[1] }, projectId: project.id })),
      } as unknown as GatewayService['sessions'],
      sessionIndexInstance: {
        saveMessages: vi.fn(async (sessionKey: string) => {
          ensureSessionRecord(sessionKey, process.cwd());
        }),
      } as unknown as GatewayService['sessionIndexInstance'],
    });

    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { session: { key: string; routing?: { agentId?: string } } };
    expect(body.session.key.startsWith('agent:coder:')).toBe(true);
    expect(body.session.routing?.agentId).toBe('coder');
    expect(projects.listSessionKeys(project.id)).toEqual([body.session.key]);
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('applies initial agent config before returning a created session', async () => {
    const patchAgentConfig = vi.fn(async () => ({ ok: true as const }));
    const getSession = vi.fn(async (key: string) => ({
      key,
      routing: { agentId: 'main' },
    }));
    const app = registerSessionRouteApp({
      currentConfig: ConfigSchema.parse({}),
      projects: {
        get: vi.fn(),
        attachSession: vi.fn(),
      } as unknown as GatewayService['projects'],
      sessions: {
        patchAgentConfig,
        getSession,
      } as unknown as GatewayService['sessions'],
      sessionIndexInstance: {
        saveMessages: vi.fn(async (sessionKey: string) => {
          ensureSessionRecord(sessionKey, process.cwd());
        }),
      } as unknown as GatewayService['sessionIndexInstance'],
    });

    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        initialAgentConfig: { model: ' openai/gpt-test ', thinkingLevel: ' high ' },
        temporary: true,
      }),
    });

    expect(res.status).toBe(201);
    expect(patchAgentConfig).toHaveBeenCalledOnce();
    expect(patchAgentConfig).toHaveBeenCalledWith(expect.any(String), {
      model: 'openai/gpt-test',
      thinkingLevel: 'high',
      userContextMode: 'temporary',
    });
    expect(patchAgentConfig.mock.invocationCallOrder[0]).toBeLessThan(getSession.mock.invocationCallOrder[0]!);
  });

  it('creates a fresh project chat even when an empty shell already exists', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Reusable Project', defaultAgentId: 'coder' });
    const existingKey = 'agent:coder:webchat:default:direct:chat_1783525363859';
    const saveMessages = vi.fn(async (sessionKey: string) => {
      ensureSessionRecord(sessionKey, process.cwd());
    });
    const existingSession = {
      key: existingKey,
      messageCount: 0,
      hiddenFromSessionList: true,
      projectId: project.id,
      routing: {
        agentId: 'coder',
        source: 'webchat',
        accountId: 'default',
        peerKind: 'direct',
        peerId: 'chat_1783525363859',
      },
      customData: { genericNewChatShell: true },
    };
    const app = registerSessionRouteApp({
      currentConfig: {
        agents: {
          default: 'main',
          list: [{ id: 'main', enabled: true }, { id: 'coder', enabled: true }],
        },
      },
      projects,
      sessions: {
        listSessions: vi.fn(async () => ({ items: [existingSession] })),
        getSession: vi.fn(async (key: string) => ({
          ...existingSession,
          key,
          routing: { ...existingSession.routing, peerId: key.split(':').at(-1) },
        })),
      } as unknown as GatewayService['sessions'],
      sessionIndexInstance: {
        saveMessages,
      } as unknown as GatewayService['sessionIndexInstance'],
    });

    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { session: { key: string } };
    expect(body.session.key).not.toBe(existingKey);
    expect(saveMessages).toHaveBeenCalledOnce();
    expect(projects.listSessionKeys(project.id)).toEqual([body.session.key]);
  });

  it('omits hidden empty project chat shells from project session lists', async () => {
    const hiddenKey = 'agent:coder:webchat:default:direct:chat_1783525363859';
    const visibleKey = 'agent:coder:webchat:default:direct:chat_1783526000000';
    const app = registerProjectRouteApp({
      projects: {
        listSessionKeys: vi.fn(() => [hiddenKey, visibleKey]),
      } as unknown as GatewayService['projects'],
      sessions: {
        getSession: vi.fn(async (key: string) => key === hiddenKey
          ? {
              key,
              messageCount: 0,
              hiddenFromSessionList: true,
              routing: { peerId: 'chat_1783525363859' },
              customData: { genericNewChatShell: true },
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

  it('does not reuse note-scoped empty sessions when creating a generic webchat session', async () => {
    const noteKey = 'agent:main:webchat:default:direct:note_abc_1783324340003';
    const saveMessages = vi.fn(async (sessionKey: string) => {
      ensureSessionRecord(sessionKey, process.cwd());
    });
    const app = registerSessionRouteApp({
      currentConfig: {
        agents: {
          default: 'main',
          list: [{ id: 'main', enabled: true }],
        },
      },
      projects: {
        get: vi.fn(() => null),
      } as unknown as GatewayService['projects'],
      sessions: {
        listSessions: vi.fn(async () => ({
          items: [{
            key: noteKey,
            messageCount: 0,
            sourceChannel: 'webchat',
            sourceChatId: 'default:direct:note_abc_1783324340003',
            routing: {
              agentId: 'main',
              source: 'webchat',
              accountId: 'default',
              peerKind: 'direct',
              peerId: 'note_abc_1783324340003',
            },
            customData: {
              sourceBinding: { kind: 'note', sourceId: 'abc', version: '1', attachedAt: 1 },
            },
          }],
        })),
        getSession: vi.fn(async (key: string) => ({ key, routing: { agentId: key.split(':')[1] } })),
      } as unknown as GatewayService['sessions'],
      sessionIndexInstance: {
        saveMessages,
      } as unknown as GatewayService['sessionIndexInstance'],
    });

    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { session: { key: string } };
    expect(body.session.key).not.toBe(noteKey);
    expect(body.session.key).toContain(':direct:chat_');
    expect(saveMessages).toHaveBeenCalledWith(
      expect.stringContaining(':direct:chat_'),
      [],
      expect.any(Object),
    );
  });

  it('does not detach a session that is no longer attached to the route project', async () => {
    const detachSession = vi.fn();
    const app = registerProjectRouteApp({
      sessions: {
        getSession: vi.fn(async () => ({
          key: 'agent:main:webchat:default:direct:s1',
          projectId: 'project-b',
        })),
      } as unknown as GatewayService['sessions'],
      projects: {
        get: vi.fn((id: string) => (id === 'project-a' ? { id, name: 'Project A' } : null)),
        detachSession,
      } as unknown as GatewayService['projects'],
    });

    const res = await app.request('/api/projects/project-a/sessions/agent:main:webchat:default:direct:s1', {
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
      currentConfig: {
        agents: {
          default: 'main',
          list: [{ id: 'main', enabled: true }],
        },
      },
      projects,
      sessions: {
        getSession: vi.fn(),
      } as unknown as GatewayService['sessions'],
    });

    const first = await app.request(`/api/projects/${project.id}/digest-memory`, { method: 'POST' });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { record: { id: string; content: string } };
    expect(firstBody.record.id).toBe(`project-digest:${project.id}`);
    expect(firstBody.record.content).toContain('Ship the digest flow');

    capture('Review the updated digest');
    const second = await app.request(`/api/projects/${project.id}/digest-memory`, { method: 'POST' });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { record: { id: string; content: string } };
    expect(secondBody.record.id).toBe(firstBody.record.id);

    const records = listMemoryRecords({ projectId: project.id, kind: 'daily_note', status: 'active', limit: 10 });
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe(`project-digest:${project.id}`);
    expect(records[0]?.content).toContain('Review the updated digest');
  });

});
