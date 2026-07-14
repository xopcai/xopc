import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityService } from '../../../../activity/index.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { GoalService } from '../../../../goals/index.js';
import { ProjectService } from '../../../../projects/index.js';
import {
  closeXopcDatabase,
  ensureSessionRecord,
  getSqliteDatabase,
  listMemoryRecords,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { WORK_ITEM_ATTACHMENT_MAX_BYTES } from '../../../../work-items/index.js';
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
    const body = (await res.json()) as { reused?: boolean; session: { key: string } };
    expect(body.reused).toBeUndefined();
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

  it('does not detach a goal that is no longer attached to the route project', async () => {
    const projects = new ProjectService();
    const projectA = projects.create({ name: 'Project A' });
    const projectB = projects.create({ name: 'Project B' });
    const goal = new GoalService().create({ title: 'Keep the current project association' });
    projects.attachGoal(goal.id, projectB.id);
    const app = registerProjectRouteApp({
      projects,
      sessions: {
        getSession: vi.fn(),
      } as unknown as GatewayService['sessions'],
    });

    const res = await app.request(`/api/projects/${projectA.id}/goals/${goal.id}`, { method: 'DELETE' });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: 'Goal is not attached to this project' });
    expect(new GoalService().get(goal.id)?.projectId).toBe(projectB.id);
  });

  it('returns a project overview with active goals and next actions', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Project Overview', brief: 'Move the project forward' });
    const goals = new GoalService();
    const goal = goals.create({ title: 'Ship project overview', projectId: project.id });
    goals.update(goal.id, { nextAction: 'Wire the overview into the project page.' });
    const app = registerProjectRouteApp({
      projects,
      sessions: {
        getSession: vi.fn(),
      } as unknown as GatewayService['sessions'],
    });

    const res = await app.request(`/api/projects/${project.id}/overview`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      overview: {
        stats: { goalCount: number; activeGoalCount: number };
        activeGoals: Array<{ id: string; title: string }>;
        nextActions: Array<{ goalId: string; nextAction: string }>;
        recommendedAction?: string;
      };
    };
    expect(body.overview.stats).toMatchObject({ goalCount: 1, activeGoalCount: 1 });
    expect(body.overview.activeGoals).toEqual([expect.objectContaining({ id: goal.id, title: goal.title })]);
    expect(body.overview.nextActions).toEqual([
      expect.objectContaining({ goalId: goal.id, nextAction: 'Wire the overview into the project page.' }),
    ]);
    expect(body.overview.recommendedAction).toBe('Wire the overview into the project page.');
  });

  it('creates and lists first-class project work items', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Workbench Project' });
    const app = registerProjectRouteApp({ projects });

    const create = await app.request(`/api/projects/${project.id}/work-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Ship login',
        description: 'Build the project login flow',
        priority: 'high',
        status: 'todo',
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { ok: boolean; item: Record<string, unknown> };
    expect(created.ok).toBe(true);
    expect(created.item).toMatchObject({
      title: 'Ship login',
      description: 'Build the project login flow',
      priority: 'high',
      status: 'todo',
      projectId: project.id,
    });

    const res = await app.request(`/api/projects/${project.id}/work-items?sortBy=createdAt&sortOrder=asc`);

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; items: Array<Record<string, unknown>>; total: number };
    expect(body.ok).toBe(true);
    expect(body.total).toBe(1);
    expect(body.items).toEqual([expect.objectContaining({
      id: created.item.id,
      title: 'Ship login',
      priority: 'high',
      status: 'todo',
    })]);
  });

  it('creates, reads, and removes work item attachments', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Attachment Project' });
    const app = registerProjectRouteApp({ projects });
    const form = new FormData();
    form.append('title', 'Review attachment');
    form.append('description', 'Use the attached brief.');
    form.append('file', new File(['attachment brief'], 'brief.txt', { type: 'text/plain' }));

    const create = await app.request(`/api/projects/${project.id}/work-items`, {
      method: 'POST',
      body: form,
    });

    expect(create.status).toBe(201);
    const created = await create.json() as {
      ok: boolean;
      item: { id: string; attachments: Array<{ id: string; fileName: string; mimeType: string; size: number }> };
    };
    expect(created.ok).toBe(true);
    expect(created.item.attachments).toEqual([
      expect.objectContaining({
        fileName: 'brief.txt',
        mimeType: 'text/plain',
        size: 'attachment brief'.length,
      }),
    ]);
    const attachmentId = created.item.attachments[0].id;

    const content = await app.request(`/api/work-items/${created.item.id}/attachments/${attachmentId}/content`);
    expect(content.status).toBe(200);
    expect(content.headers.get('content-type')).toBe('text/plain');
    expect(await content.text()).toBe('attachment brief');

    const remove = await app.request(`/api/work-items/${created.item.id}/attachments/${attachmentId}`, {
      method: 'DELETE',
    });
    expect(remove.status).toBe(200);
    const removed = await remove.json() as { ok: boolean; item: { attachments: unknown[] } };
    expect(removed.ok).toBe(true);
    expect(removed.item.attachments).toEqual([]);

    const events = await app.request(`/api/work-items/${created.item.id}/events`);
    const eventsBody = await events.json() as { events: Array<Record<string, unknown>> };
    expect(eventsBody.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'attachment_added' }),
      expect.objectContaining({ type: 'attachment_removed' }),
    ]));
  });

  it('rejects oversized work item attachments before creating the work item', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Attachment Limit Project' });
    const app = registerProjectRouteApp({ projects });
    const form = new FormData();
    form.append('title', 'Too large attachment');
    form.append('file', new File([new Uint8Array(WORK_ITEM_ATTACHMENT_MAX_BYTES + 1)], 'large.bin'));

    const create = await app.request(`/api/projects/${project.id}/work-items`, {
      method: 'POST',
      body: form,
    });

    expect(create.status).toBe(413);
    const body = await create.json() as { ok: boolean; error: string };
    expect(body).toMatchObject({ ok: false });
    expect(body.error).toContain('exceeds 25MB limit');

    const list = await app.request(`/api/projects/${project.id}/work-items`);
    const listed = await list.json() as { ok: boolean; total: number };
    expect(listed.total).toBe(0);
  });

  it('paginates project work items beyond the source page size', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Large Workbench Project' });
    for (let index = 0; index < 520; index++) {
      getSqliteDatabase().prepare(
        `INSERT INTO work_items (id, project_id, title, status, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(`wi-${index}`, project.id, `Large work item ${String(index).padStart(3, '0')}`, 'todo', 'normal', index, index);
    }
    const app = registerProjectRouteApp({ projects });

    const first = await app.request(`/api/projects/${project.id}/work-items?sortBy=createdAt&sortOrder=asc&limit=20`);
    const firstBody = await first.json() as { ok: boolean; total: number; items: Array<Record<string, unknown>>; hasMore: boolean };
    expect(first.status).toBe(200);
    expect(firstBody.ok).toBe(true);
    expect(firstBody.total).toBe(520);
    expect(firstBody.items).toHaveLength(20);
    expect(firstBody.hasMore).toBe(true);

    const afterSourcePage = await app.request(`/api/projects/${project.id}/work-items?sortBy=createdAt&sortOrder=asc&limit=20&offset=500`);
    const afterBody = await afterSourcePage.json() as { ok: boolean; total: number; items: Array<Record<string, unknown>>; hasMore: boolean };
    expect(afterSourcePage.status).toBe(200);
    expect(afterBody.ok).toBe(true);
    expect(afterBody.total).toBe(520);
    expect(afterBody.items).toHaveLength(20);
    expect(afterBody.hasMore).toBe(false);
  });

  it('updates work item status and writes an event', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Status Project' });
    const app = registerProjectRouteApp({ projects });
    const create = await app.request(`/api/projects/${project.id}/work-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Review implementation' }),
    });
    const created = await create.json() as { item: { id: string } };

    const res = await app.request(`/api/work-items/${created.item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'in_review', priority: 'urgent', dueAt: 1783324340003 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; item: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.item).toMatchObject({
      id: created.item.id,
      status: 'in_review',
      priority: 'urgent',
      dueAt: 1783324340003,
    });

    const list = await app.request(`/api/projects/${project.id}/work-items?status=in_review`);
    const listBody = await list.json() as { items: Array<Record<string, unknown>> };
    expect(listBody.items).toEqual([expect.objectContaining({ id: created.item.id, status: 'in_review' })]);

    const events = await app.request(`/api/work-items/${created.item.id}/events`);
    const eventsBody = await events.json() as { ok: boolean; events: Array<Record<string, unknown>> };
    expect(eventsBody.ok).toBe(true);
    expect(eventsBody.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'status_changed' }),
    ]));
  });

  it('updates an incomplete work item without binding undefined completedAt', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Edit Project' });
    const app = registerProjectRouteApp({ projects });
    const create = await app.request(`/api/projects/${project.id}/work-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Draft title', priority: 'normal' }),
    });
    const created = await create.json() as { item: { id: string } };

    const res = await app.request(`/api/work-items/${created.item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Saved title', priority: 'high' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; item: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.item).toMatchObject({
      id: created.item.id,
      title: 'Saved title',
      priority: 'high',
    });
    expect(body.item.completedAt).toBeUndefined();
  });

  it('creates and applies a work item update suggestion', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Suggestion Project' });
    const app = registerProjectRouteApp({ projects });
    const create = await app.request(`/api/projects/${project.id}/work-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Keep work item updated', status: 'in_progress' }),
    });
    const created = await create.json() as { item: { id: string } };

    const suggest = await app.request(`/api/work-items/${created.item.id}/update-suggestions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceKind: 'chat',
        sourceId: 'agent:main:webchat:default:direct:s1',
        patch: {
          status: 'in_review',
          nextAction: 'Ask the user to verify the result.',
        },
        progressNote: 'Implemented the first pass and verified the build.',
      }),
    });

    expect(suggest.status).toBe(201);
    const suggested = await suggest.json() as { ok: boolean; suggestion: { id: string; status: string } };
    expect(suggested.ok).toBe(true);
    expect(suggested.suggestion.status).toBe('pending');

    const apply = await app.request(`/api/work-item-update-suggestions/${suggested.suggestion.id}/apply`, {
      method: 'POST',
    });

    expect(apply.status).toBe(200);
    const applied = await apply.json() as { ok: boolean; item: Record<string, unknown>; suggestion: Record<string, unknown> };
    expect(applied.ok).toBe(true);
    expect(applied.item).toMatchObject({
      id: created.item.id,
      status: 'in_review',
      nextAction: 'Ask the user to verify the result.',
    });
    expect(applied.suggestion).toMatchObject({ id: suggested.suggestion.id, status: 'applied' });

    const events = await app.request(`/api/work-items/${created.item.id}/events`);
    const eventsBody = await events.json() as { events: Array<Record<string, unknown>> };
    expect(eventsBody.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'progress_note_added' }),
      expect.objectContaining({ type: 'update_suggestion_applied' }),
    ]));
  });

  it('starts a chat from a work item and links it back', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Chat Work Item Project', defaultAgentId: 'coder' });
    const app = registerProjectRouteApp({
      projects,
      currentConfig: {
        agents: {
          default: 'main',
          list: [{ id: 'main', enabled: true }, { id: 'coder', enabled: true }],
        },
      },
      sessionIndexInstance: {
        saveMessages: vi.fn(async (sessionKey: string) => {
          ensureSessionRecord(sessionKey, process.cwd());
        }),
      } as unknown as GatewayService['sessionIndexInstance'],
      sessions: {
        getSession: vi.fn(async (key: string) => ({ key, name: 'Work item chat', status: 'active', projectId: project.id })),
      } as unknown as GatewayService['sessions'],
    });
    const create = await app.request(`/api/projects/${project.id}/work-items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Investigate issue' }),
    });
    const created = await create.json() as { item: { id: string } };

    const res = await app.request(`/api/work-items/${created.item.id}/start-chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { ok: boolean; item: Record<string, unknown>; session: { key: string } };
    expect(body.ok).toBe(true);
    expect(body.item).toMatchObject({
      id: created.item.id,
      status: 'in_progress',
    });
    expect((body.item.links as Array<Record<string, unknown>>)).toEqual([
      expect.objectContaining({ kind: 'chat', targetId: body.session.key }),
    ]);
  });

  it('creates a goal from a work item and links it back', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Goal Work Item Project', defaultAgentId: 'coder' });
    const app = registerProjectRouteApp({ projects });
    const form = new FormData();
    form.append('title', 'Implement review flow');
    form.append('priority', 'high');
    form.append('file', new File(['goal attachment brief'], 'brief.txt', { type: 'text/plain' }));
    const create = await app.request(`/api/projects/${project.id}/work-items`, { method: 'POST', body: form });
    const created = await create.json() as {
      item: { id: string; attachments: Array<{ id: string; mediaUri: string }> };
    };
    const originalAttachment = created.item.attachments[0]!;

    const res = await app.request(`/api/work-items/${created.item.id}/create-goal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { ok: boolean; item: Record<string, unknown>; goal: { id: string; title: string; projectId: string } };
    expect(body.ok).toBe(true);
    expect(body.goal).toMatchObject({ title: 'Implement review flow', projectId: project.id });
    expect((body.item.links as Array<Record<string, unknown>>)).toEqual([
      expect.objectContaining({ kind: 'goal', targetId: body.goal.id }),
    ]);

    const goal = new GoalService().get(body.goal.id);
    const snapshot = goal?.contextMessage?.attachments[0];
    expect(snapshot).toMatchObject({
      bucket: 'inbound',
      type: 'document',
      mimeType: 'text/plain',
      name: 'brief.txt',
      size: 'goal attachment brief'.length,
    });
    expect(snapshot?.uri).not.toBe(originalAttachment.mediaUri);
    expect(goal?.contextMessage?.text).toContain(`xopc-media-uri:${snapshot!.uri}`);
    expect(goal?.contextMessage?.text).not.toContain(`xopc-media-uri:${originalAttachment.mediaUri}`);
    expect(readFileSync(snapshot!.path, 'utf-8')).toBe('goal attachment brief');

    const remove = await app.request(`/api/work-items/${created.item.id}/attachments/${originalAttachment.id}`, {
      method: 'DELETE',
    });
    expect(remove.status).toBe(200);
    expect(existsSync(snapshot!.path)).toBe(true);
    expect(readFileSync(snapshot!.path, 'utf-8')).toBe('goal attachment brief');
  });

  it('updates a stable project digest memory record instead of creating duplicates', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Digest Project', brief: 'Keep a stable digest' });
    const goals = new GoalService();
    goals.create({ title: 'Ship the digest flow', projectId: project.id });
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

    goals.create({ title: 'Review the updated digest', projectId: project.id });
    const second = await app.request(`/api/projects/${project.id}/digest-memory`, { method: 'POST' });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { record: { id: string; content: string } };
    expect(secondBody.record.id).toBe(firstBody.record.id);

    const records = listMemoryRecords({ projectId: project.id, kind: 'daily_note', status: 'active', limit: 10 });
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe(`project-digest:${project.id}`);
    expect(records[0]?.content).toContain('Review the updated digest');
  });

  it('lists files inside the project workspace only', async () => {
    const workspaceRoot = join(stateDir, 'workspace');
    mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
    mkdirSync(join(workspaceRoot, '.git'), { recursive: true });
    const outsideRoot = join(stateDir, 'outside');
    mkdirSync(outsideRoot, { recursive: true });
    writeFileSync(join(workspaceRoot, 'README.md'), '# Project\n');
    writeFileSync(join(workspaceRoot, 'src', 'index.ts'), 'export {};\n');
    writeFileSync(join(outsideRoot, 'secret.txt'), 'secret\n');
    symlinkSync(join(outsideRoot, 'secret.txt'), join(workspaceRoot, 'escape.txt'));
    const readmeRealPath = realpathSync.native(join(workspaceRoot, 'README.md'));
    const projects = new ProjectService();
    const project = projects.create({ name: 'Files Project', workspaceRoot });
    const app = registerProjectRouteApp({
      projects,
      sessions: {
        getSession: vi.fn(),
      } as unknown as GatewayService['sessions'],
    });

    const rootRes = await app.request(`/api/projects/${project.id}/files`);
    expect(rootRes.status).toBe(200);
    const rootBody = (await rootRes.json()) as {
      ok: true;
      path: string;
      entries: Array<{ name: string; path: string; type: string; size?: number }>;
    };
    expect(rootBody.path).toBe('');
    expect(rootBody.entries).toEqual([
      expect.objectContaining({ name: 'src', path: 'src', type: 'directory' }),
      expect.objectContaining({ name: 'README.md', path: 'README.md', type: 'file' }),
    ]);

    const nestedRes = await app.request(`/api/projects/${project.id}/files?path=src`);
    expect(nestedRes.status).toBe(200);
    const nestedBody = (await nestedRes.json()) as {
      ok: true;
      path: string;
      parentPath: string | null;
      entries: Array<{ name: string; path: string; type: string }>;
    };
    expect(nestedBody.path).toBe('src');
    expect(nestedBody.parentPath).toBe('');
    expect(nestedBody.entries).toEqual([
      expect.objectContaining({ name: 'index.ts', path: 'src/index.ts', type: 'file' }),
    ]);

    const outsideRes = await app.request(`/api/projects/${project.id}/files?path=..`);
    expect(outsideRes.status).toBe(400);
    expect(await outsideRes.json()).toEqual({ ok: false, error: 'Path is outside project workspace' });

    const readRes = await app.request(`/api/projects/${project.id}/files/read?path=README.md`);
    expect(readRes.status).toBe(200);
    const readBody = (await readRes.json()) as {
      ok: true;
      payload: { content: string; path: string; absolutePath: string; mtimeMs: number };
    };
    expect(readBody.payload.content).toBe('# Project\n');
    expect(readBody.payload.path).toBe('README.md');
    expect(realpathSync.native(readBody.payload.absolutePath)).toBe(readmeRealPath);
    expect(typeof readBody.payload.mtimeMs).toBe('number');

    const rawRes = await app.request(`/api/projects/${project.id}/files/raw?path=README.md`);
    expect(rawRes.status).toBe(200);
    expect(rawRes.headers.get('content-type')).toContain('text/markdown');
    expect(await rawRes.text()).toBe('# Project\n');

    const resolveRes = await app.request(`/api/projects/${project.id}/files/resolve-reference?path=README.md`);
    expect(resolveRes.status).toBe(200);
    const resolveBody = (await resolveRes.json()) as {
      ok: true;
      payload: { exists: boolean; absolutePath: string; workspaceRelativePath: string; capabilities: string[] };
    };
    expect(resolveBody.payload.exists).toBe(true);
    expect(resolveBody.payload.absolutePath).toBe(readmeRealPath);
    expect(resolveBody.payload.workspaceRelativePath).toBe('README.md');
    expect(resolveBody.payload.capabilities).toContain('preview');

    const writeRes = await app.request(`/api/projects/${project.id}/files/write`, {
      method: 'PUT',
      body: JSON.stringify({ path: 'README.md', content: '# Updated\n' }),
    });
    expect(writeRes.status).toBe(200);
    expect(readFileSync(join(workspaceRoot, 'README.md'), 'utf-8')).toBe('# Updated\n');

    const outsideReadRes = await app.request(`/api/projects/${project.id}/files/read?path=..`);
    expect(outsideReadRes.status).toBe(400);

    const symlinkReadRes = await app.request(`/api/projects/${project.id}/files/read?path=escape.txt`);
    expect(symlinkReadRes.status).toBe(400);

    const symlinkRawRes = await app.request(`/api/projects/${project.id}/files/raw?path=escape.txt`);
    expect(symlinkRawRes.status).toBe(400);

    const symlinkResolveRes = await app.request(`/api/projects/${project.id}/files/resolve-reference?path=escape.txt`);
    expect(symlinkResolveRes.status).toBe(400);

    const symlinkWriteRes = await app.request(`/api/projects/${project.id}/files/write`, {
      method: 'PUT',
      body: JSON.stringify({ path: 'escape.txt', content: 'overwritten\n' }),
    });
    expect(symlinkWriteRes.status).toBe(400);
    expect(readFileSync(join(outsideRoot, 'secret.txt'), 'utf-8')).toBe('secret\n');
  });
});
