import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GoalService } from '../../../../goals/index.js';
import { ProjectService } from '../../../../projects/index.js';
import {
  closeXopcDatabase,
  completeExecutionReceipt,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  startExecutionReceipt,
} from '../../../../storage/sqlite/index.js';
import { WorkItemService } from '../../../../work-items/index.js';
import { OutcomeExecutionService } from '../../../../work/index.js';
import { OutcomeRepository } from '../../../../work/outcome-repository.js';
import {
  OutcomeProjectionService,
} from '../../../../work/outcome-projection-service.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { registerExecutionReceiptRoutes } from '../execution-receipts.js';

describe('work outcome receipt routes', () => {
  let stateDir: string;
  let app: Hono;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-work-outcomes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord('session-1', stateDir);
    startExecutionReceipt({
      runId: 'run-1',
      sessionKey: 'session-1',
      channel: 'webchat',
      objective: 'Prepare the release',
      context: { projectId: 'project-1', origin: 'chat', triggerKind: 'user' },
      now: 100,
    });
    completeExecutionReceipt({ runId: 'run-1', status: 'succeeded', summary: 'Release prepared', now: 200 });
    app = new Hono();
    registerExecutionReceiptRoutes(app, {
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as AuthenticatedRouteDeps);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('lists receipts by project and records direct feedback', async () => {
    const list = await app.request('/api/execution-receipts?projectId=project-1');
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      ok: true,
      items: [{ runId: 'run-1', status: 'partial', summary: 'Release prepared' }],
    });

    const feedback = await app.request('/api/execution-receipts/run-1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'helpful' }),
    });
    expect(feedback.status).toBe(200);
    expect(await feedback.json()).toMatchObject({
      ok: true,
      receipt: { feedback: { outcome: 'helpful' } },
    });

    const verdict = await app.request('/api/execution-receipts/run-1/verdict', {
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
    const project = projects.create({ name: 'Route projection' });
    const execution = new OutcomeExecutionService().create({
      objective: 'Finish route projection',
      projectId: project.id,
    });
    const goal = execution.goal;
    const workItem = workItems.createProjectWorkItem(project.id, {
      title: 'Finish route projection',
      status: 'in_progress',
    });
    startExecutionReceipt({
      runId: 'run-reproject',
      sessionKey: 'session-1',
      channel: 'webchat',
      objective: 'Finish route projection',
      context: {
        outcomeId: execution.outcomeId,
        projectId: project.id,
        goalId: goal.id,
        workItemId: workItem.id,
        origin: 'goal',
      },
      now: 300,
    });
    const completed = completeExecutionReceipt({
      runId: 'run-reproject',
      status: 'succeeded',
      summary: 'Awaiting verification',
      now: 400,
    })!;
    new OutcomeProjectionService().project(completed);
    expect(new OutcomeRepository().get(execution.outcomeId)).toMatchObject({
      userStatus: 'running',
      internalStatus: 'continuing',
    });
    expect(workItems.getWorkItem(workItem.id)?.status).toBe('in_progress');
    expect(new GoalService().get(goal.id)?.status).toBe('active');

    const response = await app.request('/api/execution-receipts/run-reproject', {
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
      receipt: {
        completionVerdict: 'achieved',
      },
    });
    expect(new OutcomeRepository().get(execution.outcomeId)).toMatchObject({
      userStatus: 'completed',
      internalStatus: 'completed',
    });
    expect(workItems.getWorkItem(workItem.id)?.status).toBe('in_progress');
    expect(new GoalService().get(goal.id)?.status).toBe('active');
  });
});
