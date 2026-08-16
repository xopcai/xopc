import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { GoalService } from '../../../../goals/index.js';
import { ProjectService } from '../../../../projects/index.js';
import { OutcomeExecutionService } from '../../../../work/index.js';
import type { GatewayService } from '../../../service.js';
import { registerGoalsRoutes } from '../goals.js';

const SESSION_KEY = 'agent:main:webchat:default:direct:goal-routes';

describe('goal routes', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-goal-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function createApp(servicePatch: Partial<GatewayService>): Hono {
    const app = new Hono();
    const service = {
      currentConfig: {},
      createWorkflowRunService: () => ({}),
      projects: new ProjectService(),
      getGoalQueueSnapshot: () => [],
      emit: vi.fn(),
      enqueueGoalRun: vi.fn(),
      agentService: {
        prepareInboundAttachments: vi.fn(async () => undefined),
      },
      sessionIndexInstance: { saveMessages: vi.fn() },
      getActiveWebchatRunId: vi.fn(),
      abortAgentRun: vi.fn(),
      ...servicePatch,
    } as unknown as GatewayService;
    registerGoalsRoutes(app, {
      service,
      strictRateLimitMiddleware: async (_c, next) => next(),
      sseConfig: {} as never,
    });
    return app;
  }

  function createGoal(input: Parameters<OutcomeExecutionService['create']>[0]) {
    return new OutcomeExecutionService().create(input).goal;
  }

  it('archives a goal and aborts the active linked webchat run', async () => {
    const goal = createGoal({ objective: 'Stop this goal loop', sessionKey: SESSION_KEY });
    const abortAgentRun = vi.fn(() => true);
    const app = createApp({
      getActiveWebchatRunId: vi.fn((sessionKey: string) => (sessionKey === SESSION_KEY ? 'run-123' : undefined)),
      abortAgentRun,
    });

    const res = await app.request(`/api/goals/${encodeURIComponent(goal.id)}/archive`, { method: 'POST' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; aborted?: boolean; abortedRunId?: string };
    expect(body.aborted).toBe(true);
    expect(body.abortedRunId).toBe('run-123');
    expect(abortAgentRun).toHaveBeenCalledWith('run-123');
  });

  it('completes a goal without aborting the active linked webchat run', async () => {
    const goal = createGoal({ objective: 'Mark complete only', sessionKey: SESSION_KEY });
    const abortAgentRun = vi.fn(() => true);
    const app = createApp({
      getActiveWebchatRunId: vi.fn(() => 'run-123'),
      abortAgentRun,
    });

    const res = await app.request(`/api/goals/${encodeURIComponent(goal.id)}/complete`, { method: 'POST' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; aborted?: boolean; abortedRunId?: string };
    expect(body.aborted).toBeUndefined();
    expect(body.abortedRunId).toBeUndefined();
    expect(abortAgentRun).not.toHaveBeenCalled();
  });

  it('attaches a generated continuation session to the goal project', async () => {
    const projects = new ProjectService();
    const workspaceRoot = join(stateDir, 'project-root');
    mkdirSync(workspaceRoot, { recursive: true });
    const project = projects.create({ name: 'Goal Project', workspaceRoot });
    const goal = createGoal({ objective: 'Continue in project workspace', projectId: project.id });
    const enqueueGoalRun = vi.fn(() => ({ id: 'queue-1' }));
    const app = createApp({
      projects,
      sessionIndexInstance: {
        saveMessages: vi.fn(async (sessionKey: string) => {
          ensureSessionRecord(sessionKey, process.cwd());
        }),
      } as unknown as GatewayService['sessionIndexInstance'],
      enqueueGoalRun,
    });

    const res = await app.request(`/api/goals/${encodeURIComponent(goal.id)}/continue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userTurn: { text: 'continue' } }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; sessionKey: string };
    expect(new GoalService().get(goal.id)?.activeSessionKey).toBe(body.sessionKey);
    expect(projects.listSessionKeys(project.id)).toEqual([body.sessionKey]);
    expect(enqueueGoalRun).toHaveBeenCalled();
  });

  it('attaches existing goal sessions to the goal project', async () => {
    const projects = new ProjectService();
    const workspaceRoot = join(stateDir, 'project-root');
    mkdirSync(workspaceRoot, { recursive: true });
    const project = projects.create({ name: 'Existing Session Project', workspaceRoot });
    const goal = createGoal({ objective: 'Attach existing session', projectId: project.id });
    const sessionKey = 'agent:main:webchat:default:direct:goal-existing-session';
    ensureSessionRecord(sessionKey, process.cwd());
    const app = createApp({ projects });

    const res = await app.request(`/api/goals/${encodeURIComponent(goal.id)}/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionKey }),
    });

    expect(res.status).toBe(200);
    expect(new GoalService().get(goal.id)?.activeSessionKey).toBe(sessionKey);
    expect(projects.listSessionKeys(project.id)).toEqual([sessionKey]);
  });

  it('moves the active goal session when the goal changes projects', async () => {
    const projects = new ProjectService();
    const sourceProject = projects.create({ name: 'Source Project' });
    const targetProject = projects.create({ name: 'Target Project' });
    ensureSessionRecord(SESSION_KEY, process.cwd());
    projects.attachSession(SESSION_KEY, sourceProject.id);
    const goal = createGoal({
      objective: 'Move project scope',
      projectId: sourceProject.id,
      sessionKey: SESSION_KEY,
    });
    const app = createApp({ projects });

    const res = await app.request(`/api/goals/${encodeURIComponent(goal.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: targetProject.id }),
    });

    expect(res.status).toBe(200);
    expect(new GoalService().get(goal.id)?.projectId).toBe(targetProject.id);
    expect(projects.listSessionKeys(sourceProject.id)).toEqual([]);
    expect(projects.listSessionKeys(targetProject.id)).toEqual([SESSION_KEY]);
  });
});
