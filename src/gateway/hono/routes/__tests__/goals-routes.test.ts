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

  it('creates a goal with context attachments through the shared user turn shape', async () => {
    const prepared = [{
      id: 'ctx-file.txt',
      bucket: 'inbound' as const,
      type: 'document',
      mimeType: 'text/plain',
      name: 'ctx.txt',
      size: 5,
      uri: 'media://inbound/ctx-file.txt',
      path: '/tmp/ctx-file.txt',
    }];
    const prepareInboundAttachments = vi.fn(async () => prepared);
    const enqueueGoalRun = vi.fn();
    const app = createApp({
      agentService: { prepareInboundAttachments } as unknown as GatewayService['agentService'],
      enqueueGoalRun,
    });

    const res = await app.request('/api/goals', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Review uploaded design',
        contextMessage: {
          text: 'Use the attached notes as source context.',
          attachments: [{
            type: 'document',
            mimeType: 'text/plain',
            data: Buffer.from('hello').toString('base64'),
            name: 'ctx.txt',
            size: 5,
          }],
        },
        source: 'api',
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      goal: NonNullable<ReturnType<GoalService['get']>>;
    };
    expect(body.goal.description).toBe('Use the attached notes as source context.');
    expect(body.goal.contextMessage?.text).toBe('Use the attached notes as source context.');
    expect(body.goal.contextMessage?.attachments).toEqual(prepared);
    expect(prepareInboundAttachments).toHaveBeenCalledWith(expect.stringMatching(/^goal:/), [
      expect.objectContaining({ name: 'ctx.txt', data: Buffer.from('hello').toString('base64') }),
    ]);
    expect(enqueueGoalRun).not.toHaveBeenCalled();
  });

  it('creates project goals with the project default agent when no agent is explicit', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Default Agent Goal Project', defaultAgentId: 'coder' });
    const app = createApp({
      currentConfig: {
        agents: {
          default: 'main',
          list: [{ id: 'main', enabled: true }, { id: 'coder', enabled: true }],
        },
      },
      projects,
    });

    const res = await app.request('/api/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Use project agent',
        projectId: project.id,
        source: 'api',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      goal: NonNullable<ReturnType<GoalService['get']>>;
    };
    expect(body.goal.agentId).toBe('coder');
    expect(body.goal.projectId).toBe(project.id);
  });

  it('archives a goal and aborts the active linked webchat run', async () => {
    const goals = new GoalService();
    const goal = goals.create({ title: 'Stop this goal loop', sessionKey: SESSION_KEY });
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
    const goals = new GoalService();
    const goal = goals.create({ title: 'Mark complete only', sessionKey: SESSION_KEY });
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

  it('requires planned evidence before a contracted goal can be completed', async () => {
    const goals = new GoalService();
    const goal = goals.create({
      title: 'Release the goal contract',
      contract: {
        objective: 'Deliver a verified release',
        evidencePlan: ['Automated test output'],
      },
    });
    const app = createApp({});

    const blocked = await app.request(`/api/goals/${encodeURIComponent(goal.id)}/complete`, { method: 'POST' });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      ok: false,
      missingEvidence: ['Automated test output'],
    });

    const saved = await app.request(`/api/goals/${encodeURIComponent(goal.id)}/contract`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        objective: 'Deliver a verified release',
        scopeBoundary: 'Only the release workflow',
        criteria: ['Release notes are published'],
        evidencePlan: ['Automated test output'],
      }),
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()).goal.contract).toMatchObject({
      scopeBoundary: 'Only the release workflow',
      evidencePlan: ['Automated test output'],
    });

    const requirementId = goals.get(goal.id)!.evidenceRequirements[0]!.id;
    const evidence = await app.request(`/api/goals/${encodeURIComponent(goal.id)}/evidence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'test', title: 'Automated test output', requirementId }),
    });
    expect(evidence.status).toBe(200);

    const waitingForApproval = await app.request(`/api/goals/${encodeURIComponent(goal.id)}/complete`, { method: 'POST' });
    expect(waitingForApproval.status).toBe(409);
    expect(await waitingForApproval.json()).toMatchObject({
      pendingApproval: ['Automated test output'],
    });

    const approval = await app.request(`/api/goals/${encodeURIComponent(goal.id)}/evidence-requirements/${requirementId}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'The test output was inspected.' }),
    });
    expect(approval.status).toBe(200);
    const completed = await app.request(`/api/goals/${encodeURIComponent(goal.id)}/complete`, { method: 'POST' });
    expect(completed.status).toBe(200);
  });

  it('attaches a generated continuation session to the goal project', async () => {
    const projects = new ProjectService();
    const workspaceRoot = join(stateDir, 'project-root');
    mkdirSync(workspaceRoot, { recursive: true });
    const project = projects.create({ name: 'Goal Project', workspaceRoot });
    const goals = new GoalService();
    const goal = goals.create({ title: 'Continue in project workspace', projectId: project.id });
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
    const goals = new GoalService();
    const goal = goals.create({ title: 'Attach existing session', projectId: project.id });
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
});
