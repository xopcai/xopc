import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalService } from '../../../../goals/index.js';
import { ProjectService } from '../../../../projects/index.js';
import {
  closeXopcDatabase,
  ensureSessionRecord,
  listMemoryRecords,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import type { GatewayService } from '../../../service.js';
import { registerProjectsRoutes } from '../projects.js';
import { registerSearchRoutes } from '../search.js';
import { registerSessionsRoutes } from '../sessions.js';

function registerProjectRouteApp(service: Partial<GatewayService>): Hono {
  const app = new Hono();
  registerProjectsRoutes(app, { service: service as GatewayService });
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

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-project-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
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
    const app = registerSessionRouteApp({
      currentConfig: {
        agents: {
          default: 'main',
          list: [{ id: 'main', enabled: true }, { id: 'coder', enabled: true }],
        },
      },
      projects,
      sessions: {
        listSessions: vi.fn(async () => ({ items: [] })),
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
    writeFileSync(join(workspaceRoot, 'README.md'), '# Project\n');
    writeFileSync(join(workspaceRoot, 'src', 'index.ts'), 'export {};\n');
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
  });
});
