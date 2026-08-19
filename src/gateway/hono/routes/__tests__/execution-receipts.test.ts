import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectService } from '../../../../projects/index.js';
import {
  closeXopcDatabase,
  completeExecutionReceipt,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  startExecutionReceipt,
} from '../../../../storage/sqlite/index.js';
import { TaskExecutionService } from '../../../../tasks/index.js';
import { TaskRepository } from '../../../../tasks/task-repository.js';
import {
  TaskProjectionService,
} from '../../../../tasks/task-projection-service.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { registerExecutionReceiptRoutes } from '../execution-receipts.js';

describe('work task receipt routes', () => {
  let stateDir: string;
  let app: Hono;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-work-tasks-'));
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
      body: JSON.stringify({ rating: 'helpful' }),
    });
    expect(feedback.status).toBe(200);
    expect(await feedback.json()).toMatchObject({
      ok: true,
      receipt: { feedback: { rating: 'helpful' } },
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

  it('reprojects completed tasks after contract and evidence updates', async () => {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Route projection' });
    const execution = new TaskExecutionService().create({
      objective: 'Finish route projection',
      projectId: project.id,
    });
    startExecutionReceipt({
      runId: 'run-reproject',
      sessionKey: 'session-1',
      channel: 'webchat',
      objective: 'Finish route projection',
      context: {
        taskId: execution.taskId,
        projectId: project.id,
        origin: 'task',
      },
      now: 300,
    });
    const completed = completeExecutionReceipt({
      runId: 'run-reproject',
      status: 'succeeded',
      summary: 'Awaiting verification',
      now: 400,
    })!;
    new TaskProjectionService().project(completed);
    expect(new TaskRepository().get(execution.taskId)).toMatchObject({
      status: 'running',
    });

    const response = await app.request('/api/execution-receipts/run-reproject', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contract: {
          objective: 'Finish route projection',
          expectedOutputs: [],
          acceptanceCriteria: ['Checks pass'],
          constraints: [],
          approvalRequired: [],
          assumptions: [],
          risks: [],
        },
        evidence: [{
          kind: 'test',
          title: 'Verification suite',
          summary: 'All checks passed',
          verifies: ['Checks pass'],
          provenance: 'tool',
          strength: 'verified',
          observedAt: Date.now(),
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
    expect(new TaskRepository().get(execution.taskId)).toMatchObject({
      status: 'completed',
    });
  });
});
