import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GoalService } from '../../../../goals/index.js';
import { ProjectService } from '../../../../projects/index.js';
import {
  closeXopcDatabase,
  completeTaskOutcome,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  startTaskOutcome,
} from '../../../../storage/sqlite/index.js';
import { WorkItemService } from '../../../../work-items/index.js';
import { OutcomeProjectionService } from '../../../../work/outcome-projection-service.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { registerTaskOutcomeRoutes } from '../task-outcomes.js';

describe('work outcome receipt routes', () => {
  let stateDir: string;
  let app: Hono;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-work-outcomes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord('session-1', stateDir);
    startTaskOutcome({
      runId: 'run-1',
      sessionKey: 'session-1',
      channel: 'webchat',
      objective: 'Prepare the release',
      context: { projectId: 'project-1', origin: 'chat', triggerKind: 'user' },
      now: 100,
    });
    completeTaskOutcome({ runId: 'run-1', status: 'succeeded', summary: 'Release prepared', now: 200 });
    app = new Hono();
    registerTaskOutcomeRoutes(app, {
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as AuthenticatedRouteDeps);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('lists receipts by project and records direct feedback', async () => {
    const list = await app.request('/api/work/outcomes?projectId=project-1');
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      ok: true,
      items: [{ runId: 'run-1', status: 'partial', summary: 'Release prepared' }],
    });

    const feedback = await app.request('/api/work/outcomes/run-1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'helpful' }),
    });
    expect(feedback.status).toBe(200);
    expect(await feedback.json()).toMatchObject({
      ok: true,
      receipt: { feedback: { outcome: 'helpful' } },
    });

    const verdict = await app.request('/api/work/outcomes/run-1/verdict', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ verdict: 'achieved' }),
    });
    expect(verdict.status).toBe(200);
    expect(await verdict.json()).toMatchObject({
      ok: true,
      receipt: { status: 'completed', completionVerdict: 'achieved' },
    });
  });

  it('reprojects completed outcomes after contract and evidence updates', async () => {
    const projects = new ProjectService();
    const workItems = new WorkItemService();
    const goals = new GoalService();
    const project = projects.create({ name: 'Route projection' });
    const goal = goals.create({ title: 'Finish route projection', projectId: project.id });
    const workItem = workItems.createProjectWorkItem(project.id, {
      title: 'Finish route projection',
      status: 'in_progress',
    });
    startTaskOutcome({
      runId: 'run-reproject',
      sessionKey: 'session-1',
      channel: 'webchat',
      objective: 'Finish route projection',
      context: { projectId: project.id, goalId: goal.id, workItemId: workItem.id, origin: 'goal' },
      now: 300,
    });
    const completed = completeTaskOutcome({
      runId: 'run-reproject',
      status: 'succeeded',
      summary: 'Awaiting verification',
      now: 400,
    })!;
    new OutcomeProjectionService().project(completed);
    expect(workItems.getWorkItem(workItem.id)?.status).toBe('in_review');

    const response = await app.request('/api/task-outcomes/run-reproject', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contract: {
          objective: 'Finish route projection',
          deliverables: [],
          acceptanceCriteria: ['Checks pass'],
          constraints: [],
          approvalRequired: [],
        },
        evidence: [{
          kind: 'test',
          title: 'Verification suite',
          summary: 'All checks passed',
          verifies: ['Checks pass'],
        }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      outcome: { completionVerdict: 'achieved', projectionVersion: 1 },
    });
    expect(workItems.getWorkItem(workItem.id)?.status).toBe('done');
    expect(goals.get(goal.id)?.status).toBe('done');
  });
});
