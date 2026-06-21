import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { GoalService } from '../../../../goals/index.js';
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
      getGoalQueueSnapshot: () => [],
      emit: vi.fn(),
      enqueueWebchatPersistentGoalKickoff: vi.fn(),
      enqueueGoalRun: vi.fn(),
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
});
