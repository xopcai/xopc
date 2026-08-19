import type { Hono } from 'hono';
import {
  ProjectMonitoringUpdateSchema,
  TaskActionRequestSchema,
  TaskCreateRequestSchema,
  TaskDependencyUpdateRequestSchema,
  TaskStatusSchema,
} from '@xopcai/gateway-contract';

import { ProjectMonitoringService } from '../../../tasks/project-monitoring-service.js';
import { validateWebchatAttachments } from '../../chat-limits.js';
import { getTaskContextManifest } from '../../../tasks/task-context-assembler.js';
import { TaskCommandService } from '../../../tasks/task-command-service.js';
import {
  TaskDependencyError,
  TaskDependencyService,
} from '../../../tasks/task-dependency-service.js';
import { TaskRepository } from '../../../tasks/task-repository.js';
import { TaskProgressProjectionService } from '../../../tasks/task-progress-projection-service.js';
import { TaskReceiptService } from '../../../tasks/task-receipt-service.js';
import { ProjectOperatingViewService } from '../../../tasks/project-operating-view-service.js';
import { TaskValueMetricsService } from '../../../tasks/task-value-metrics-service.js';
import { TaskCreateService } from '../../service/task-create-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerTaskRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const creator = new TaskCreateService({
    getConfig: () => deps.service.currentConfig,
    projects: deps.service.projects,
    enqueueTask: (taskId, options) => deps.service.enqueueTask(taskId, options),
  });
  const operatingViews = new ProjectOperatingViewService(
    deps.service.projects,
    () => deps.service.getTaskQueueSnapshot(),
  );
  const monitoring = new ProjectMonitoringService();
  const metrics = new TaskValueMetricsService();
  const tasks = new TaskRepository();
  const receipts = new TaskReceiptService();
  const progress = new TaskProgressProjectionService();
  const commands = new TaskCommandService((taskId, options) => deps.service.enqueueTask(taskId, options));
  const dependencies = new TaskDependencyService();

  authenticated.get('/api/tasks', (c) => {
    const status = TaskStatusSchema.safeParse(c.req.query('status'));
    const rawLimit = Number(c.req.query('limit') ?? 50);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
    return c.json({
      ok: true,
      items: tasks.list({ ...(status.success ? { status: status.data } : {}), limit }),
    });
  });

  authenticated.post('/api/tasks', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = TaskCreateRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid task request' }, 400);
    const attachmentError = validateWebchatAttachments(parsed.data.attachments);
    if (attachmentError) return c.json({ ok: false, error: attachmentError }, 400);
    try {
      const created = await creator.create(parsed.data);
      return created.mode === 'capture'
        ? c.json(created, 201)
        : c.json(created, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, error: message }, message === 'Project not found' ? 404 : 409);
    }
  });

  authenticated.get('/api/tasks/metrics', (c) => c.json({ ok: true, metrics: metrics.get() }));

  authenticated.get('/api/tasks/:id', (c) => {
    const task = tasks.get(c.req.param('id'));
    if (!task) return c.json({ ok: false, error: 'Task not found' }, 404);
    const execution = task.execution;
    const liveProjection = progress.project(task);
    const nextCheckAt = deps.service.getTaskQueueSnapshot()
      .filter((item) => item.taskId === task.id && item.status === 'scheduled' && item.nextRunAt !== undefined)
      .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))[0]?.nextRunAt;
    return c.json({
      ok: true,
      task,
      receipts: receipts.list({ taskId: task.id, limit: 100 }),
      ...(execution ? {
        execution: {
          ...(execution.activeSessionKey ? { sessionKey: execution.activeSessionKey } : {}),
          ...(execution.nextAction ? { nextAction: execution.nextAction } : {}),
          ...(execution.blockedReason ? { blockedReason: execution.blockedReason } : {}),
          approvedBoundaries: execution.approvedBoundaries,
          updatedAt: execution.updatedAt,
        },
      } : {}),
      ...liveProjection,
      ...(nextCheckAt === undefined ? {} : { nextCheckAt }),
      dependencies: dependencies.listDependencies(task.id),
      dependents: dependencies.listDependents(task.id),
      contextManifest: getTaskContextManifest(task.id),
    });
  });

  authenticated.put('/api/tasks/:id/dependencies', deps.strictRateLimitMiddleware, async (c) => {
    const parsed = TaskDependencyUpdateRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid task dependencies' }, 400);
    try {
      const task = dependencies.replace({ taskId: c.req.param('id'), ...parsed.data });
      return c.json({
        ok: true,
        task,
        dependencies: dependencies.listDependencies(task.id),
        dependents: dependencies.listDependents(task.id),
      });
    } catch (error) {
      if (!(error instanceof TaskDependencyError)) throw error;
      const status = error.code === 'not_found'
        ? 404
        : error.code === 'conflict'
          ? 409
          : 400;
      return c.json({ ok: false, code: error.code, error: error.message }, status);
    }
  });

  authenticated.post('/api/tasks/:id/actions', deps.strictRateLimitMiddleware, async (c) => {
    const parsed = TaskActionRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid task action' }, 400);
    const result = commands.execute({ taskId: c.req.param('id'), ...parsed.data });
    if (result.ok === false) {
      if (result.reason === 'not_found') return c.json({ ok: false, error: 'Task not found' }, 404);
      if (result.reason === 'approval_required') {
        return c.json({
          ok: false,
          code: result.reason,
          error: 'Required execution boundaries must be approved',
          requiredBoundaries: result.requiredBoundaries,
          latest: result.latest,
        }, 409);
      }
      return c.json({
        ok: false,
        code: result.reason,
        error: result.reason === 'conflict'
          ? 'Task changed; refresh and try again'
          : 'Action is not valid for the current task state',
        latest: result.latest,
      }, 409);
    }
    return c.json({ ok: true, task: result.task, queued: result.queued });
  });

  authenticated.get('/api/projects/:projectId/operating-view', (c) => {
    const view = operatingViews.get(c.req.param('projectId'));
    return view
      ? c.json({ ok: true, view })
      : c.json({ ok: false, error: 'Project not found' }, 404);
  });

  authenticated.get('/api/projects/:projectId/monitoring', (c) => {
    const projectId = c.req.param('projectId');
    if (!deps.service.projects.get(projectId)) return c.json({ ok: false, error: 'Project not found' }, 404);
    return c.json({ ok: true, policy: monitoring.get(projectId) });
  });

  authenticated.patch('/api/projects/:projectId/monitoring', deps.strictRateLimitMiddleware, async (c) => {
    const projectId = c.req.param('projectId');
    if (!deps.service.projects.get(projectId)) return c.json({ ok: false, error: 'Project not found' }, 404);
    const parsed = ProjectMonitoringUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid monitoring policy' }, 400);
    const current = monitoring.get(projectId);
    try {
      const policy = monitoring.configure({
        projectId,
        mode: parsed.data.mode ?? current.mode,
        quietHours: parsed.data.quietHours === null
          ? undefined
          : parsed.data.quietHours ?? current.quietHours,
        allowedActions: parsed.data.allowedActions ?? current.allowedActions,
        confidenceThreshold: parsed.data.confidenceThreshold ?? current.confidenceThreshold,
        scenarios: parsed.data.scenarios ?? (current.configured ? current.scenarios : undefined),
      });
      return c.json({ ok: true, policy });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
}
