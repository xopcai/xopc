import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  TaskDetailResponseSchema,
  TaskCreateResponseSchema,
  TaskValueMetricsSchema,
} from '@xopcai/gateway-contract';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { ProjectService } from '../../../../projects/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { TaskRepository } from '../../../../tasks/index.js';
import type { GatewayService } from '../../../service.js';
import { registerTaskRoutes } from '../tasks.js';

describe('task routes', () => {
  let stateDir: string;
  let app: Hono;
  let projects: ProjectService;
  let enqueueTask: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-work-routes-'));
    vi.stubEnv('XOPC_STATE_DIR', stateDir);
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    projects = new ProjectService();
    enqueueTask = vi.fn((taskId: string) => ({
      id: 'queue-1', taskId, status: 'queued', attempts: 0, maxRetries: 2,
      enqueuedAt: Date.now(), source: 'api',
    }));
    app = new Hono();
    registerTaskRoutes(app, {
      service: {
        currentConfig: ConfigSchema.parse({}),
        projects,
        enqueueTask,
        getTaskQueueSnapshot: vi.fn(() => []),
      } as unknown as GatewayService,
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    vi.unstubAllEnvs();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('starts one durable task by queueing it without creating a chat session', async () => {
    const requestId = '47fd2a0b-f323-4eb8-b115-83ed2c8267c0';
    const response = await app.request('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, mode: 'start', objective: 'Prepare the September product launch' }),
    });

    expect(response.status).toBe(202);
    const started = TaskCreateResponseSchema.parse(await response.json());
    expect(started.mode).toBe('start');
    if (started.mode !== 'start') throw new Error('Expected a started task');
    expect(started).toMatchObject({
      mode: 'start',
      task: { objective: 'Prepare the September product launch', status: 'planning' },
      activation: { status: 'queued', queueId: 'queue-1' },
    });
    expect(enqueueTask).toHaveBeenCalledOnce();
    expect(new TaskRepository().get(started.task.id)?.execution).toMatchObject({
      source: 'api',
    });
    expect(new TaskRepository().get(started.task.id)?.execution.activeSessionKey).toBeUndefined();
    expect(TaskDetailResponseSchema.parse(
      await (await app.request(`/api/tasks/${started.task.id}`)).json(),
    ).execution).toMatchObject({
      approvedBoundaries: [],
    });
    expect(TaskValueMetricsSchema.parse((await (await app.request('/api/tasks/metrics')).json()).metrics))
      .toMatchObject({ tasks: { total: 1 } });
  });

  it('captures a project task for long-term tracking without creating a session', async () => {
    const project = projects.create({ name: 'Long-running project' });
    const dueAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const response = await app.request('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: '5fb485ad-5b94-47b0-8675-d0d4c73b7595',
        mode: 'capture',
        objective: 'Keep the partner launch moving',
        projectId: project.id,
        priority: 'high',
        dueAt,
      }),
    });

    expect(response.status).toBe(201);
    const created = TaskCreateResponseSchema.parse(await response.json());
    expect(created).toMatchObject({
      mode: 'capture',
      task: {
        objective: 'Keep the partner launch moving',
        status: 'pending',
        priority: 'high',
        dueAt,
      },
    });
    expect(enqueueTask).not.toHaveBeenCalled();
    const execution = new TaskRepository().get(created.task.id)?.execution;
    expect(execution).toMatchObject({
      projectId: project.id,
      priority: 'high',
    });
    expect(execution?.activeSessionKey).toBeUndefined();
  });

  it('persists attached files as task execution context', async () => {
    const response = await app.request('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: '3e042a56-3a7a-4c3c-b81b-8a6d8e74b58d',
        mode: 'start',
        objective: 'Review the attached launch brief',
        attachments: [{
          type: 'document',
          mimeType: 'text/plain',
          name: 'launch-brief.txt',
          size: 12,
          data: Buffer.from('Launch brief').toString('base64'),
        }],
      }),
    });

    expect(response.status).toBe(202);
    const created = TaskCreateResponseSchema.parse(await response.json());
    const context = new TaskRepository().get(created.task.id)?.execution.contextMessage;
    expect(context?.text).toBe('');
    expect(context?.attachments).toHaveLength(1);
    expect(context?.attachments[0]).toMatchObject({
      type: 'document',
      mimeType: 'text/plain',
      name: 'launch-brief.txt',
      uri: expect.stringMatching(/^media:\/\/inbound\//),
    });
  });

  it('requires callers to choose capture or start explicitly', async () => {
    const response = await app.request('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: '8f67c4ef-1827-4ac7-9f1f-45c33a1ef9d3',
        objective: 'Do not infer creation behavior',
      }),
    });

    expect(response.status).toBe(400);
    expect(new TaskRepository().list({ limit: 20 })).toHaveLength(0);
  });

  it('replays the same request id without creating a second task', async () => {
    const body = JSON.stringify({
      requestId: 'e70bb76b-2741-4c94-84f7-5a02da1ae931',
      mode: 'start',
      objective: 'Prepare a durable release plan',
    });
    const first = TaskCreateResponseSchema.parse(await (await app.request('/api/tasks', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    })).json());
    const replay = TaskCreateResponseSchema.parse(await (await app.request('/api/tasks', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    })).json());

    expect(replay.task.id).toBe(first.task.id);
    expect(new TaskRepository().list({ limit: 20 })).toHaveLength(1);
  });

  it('coalesces concurrent starts and rejects request id reuse with different input', async () => {
    const requestId = 'ed0e0755-f6a8-42bb-bd6c-fd52f7bcf254';
    const request = () => app.request('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, mode: 'start', objective: 'Ship the verified launch checklist' }),
    });
    const [first, second] = await Promise.all([request(), request()]);
    const tasks = await Promise.all([
      first.json().then((value) => TaskCreateResponseSchema.parse(value)),
      second.json().then((value) => TaskCreateResponseSchema.parse(value)),
    ]);

    expect(tasks[0].task.id).toBe(tasks[1].task.id);
    expect(new TaskRepository().list({ limit: 20 })).toHaveLength(1);
    expect(enqueueTask).toHaveBeenCalledOnce();

    const conflict = await app.request('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, mode: 'start', objective: 'A different task' }),
    });
    expect(conflict.status).toBe(409);
  });

  it('does not expose the removed WorkIntake endpoints', async () => {
    expect((await app.request('/api/work/intakes', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/work/intakes/old/confirm', { method: 'POST' })).status).toBe(404);
  });

  it('rejects stale actions and preserves the latest task state', async () => {
    const tasks = new TaskRepository();
    const task = tasks.create({ objective: 'Advance safely' });
    const changed = tasks.update(task.id, { status: 'planning' })!;
    const response = await app.request(`/api/tasks/${task.id}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'run', expectedUpdatedAt: task.updatedAt }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: 'conflict',
      latest: { status: 'planning', updatedAt: changed.updatedAt },
    });
  });

  it('enables the default delivery scenarios when monitoring an existing project', async () => {
    const project = projects.create({ name: 'Existing project' });
    const response = await app.request(`/api/projects/${project.id}/monitoring`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'ask_before_action' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      policy: { mode: 'ask_before_action', scenarios: ['blocked_work', 'project_delivery_risk'] },
    });
  });
});
