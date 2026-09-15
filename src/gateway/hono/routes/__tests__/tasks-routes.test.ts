import { mkdtempSync, rmSync } from 'node:fs';
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
import { TaskRepository } from '../../../../tasks/task-repository.js';
import { TaskRunRepository } from '../../../../tasks/task-run-repository.js';
import { registerTaskRoutes } from '../tasks.js';

describe('task routes', () => {
  let stateDir: string;
  let app: Hono;
  const abortAgentRun = vi.fn();

  beforeEach(() => {
    abortAgentRun.mockReset();
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-routes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    app = new Hono();
    registerTaskRoutes(app, {
      service: {
        currentConfig: {},
        projects: {},
        sessions: {},
        sessionIndexInstance: {},
        dispatchTaskEvents: vi.fn(),
        dispatchTaskRuns: vi.fn(),
        getActiveWebchatRunId: vi.fn(() => 'live-run'),
        abortAgentRun,
      },
      strictRateLimitMiddleware: async (_c, next) => next(),
      chatRateLimitMiddleware: async (_c, next) => next(),
    } as never);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('aborts the live conversation after persisting a pause', async () => {
    const task = new TaskRepository().create({ title: 'Pause route', objective: 'Wait' });
    ensureSessionRecord('session', stateDir);
    new TaskRunRepository().create({ taskId: task.id, sessionKey: 'session', executorKind: 'agent',
      executorRef: { agentId: 'main' }, trigger: { kind: 'manual' }, correlationId: 'pause-route',
      idempotencyKey: 'pause-route', contractVersion: task.latestContractVersion });
    const response = await app.request(`/api/tasks/${task.id}/commands`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'pause-route-command', expectedVersion: task.version,
        command: { type: 'add_wait', wait: { kind: 'paused', reason: 'Later', condition: {} } } }) });
    expect(response.status).toBe(200);
    expect(abortAgentRun).toHaveBeenCalledWith('live-run');
    expect(new TaskRunRepository().listActiveWaits(task.id)[0]?.kind).toBe('paused');
  });

  it('deletes an idle Task and reports a stable missing-task error', async () => {
    const task = new TaskRepository().create({ title: 'Delete route', objective: 'Delete through REST' });

    const deleted = await app.request(`/api/tasks/${task.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ ok: true, deleted: true, taskId: task.id });

    const missing = await app.request(`/api/tasks/${task.id}`, { method: 'DELETE' });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      ok: false,
      code: 'task_not_found',
      error: 'Task not found',
    });
  });

  it('rejects deletion while a TaskRun is active', async () => {
    const task = new TaskRepository().create({ title: 'Active route', objective: 'Keep active' });
    const run = new TaskRunRepository().create({
      taskId: task.id,
      executorKind: 'agent',
      executorRef: { agentId: 'main' },
      trigger: { kind: 'manual' },
      correlationId: 'route-active-run',
      idempotencyKey: 'route-active-run',
      contractVersion: task.latestContractVersion,
    });

    const response = await app.request(`/api/tasks/${task.id}`, { method: 'DELETE' });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: 'task_active',
      error: 'Cancel the active TaskRun before deleting the Task',
      runId: run.id,
    });
  });
});
