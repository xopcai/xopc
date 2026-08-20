import type { Hono } from 'hono';
import {
  ProjectMonitoringUpdateSchema,
  TaskCommandRequestSchema,
  TaskContextInputSchema,
  TaskCreateRequestSchema,
  TaskDependencyUpdateRequestSchema,
  TaskPatchRequestSchema,
  TaskPhaseSchema,
} from '@xopcai/gateway-contract';

import { ProjectMonitoringService } from '../../../tasks/project-monitoring-service.js';
import { TaskApplicationService } from '../../../tasks/task-application-service.js';
import { TaskContextRepository } from '../../../tasks/task-context-repository.js';
import {
  TaskDependencyError,
  TaskDependencyService,
} from '../../../tasks/task-dependency-service.js';
import { TaskRepository } from '../../../tasks/task-repository.js';
import { TaskReadModelProjector } from '../../../tasks/task-read-model-projector.js';
import { TaskRunRepository } from '../../../tasks/task-run-repository.js';
import { TaskSignalService } from '../../../tasks/task-signal-service.js';
import { ProjectOperatingViewService } from '../../../tasks/project-operating-view-service.js';
import { TaskValueMetricsService } from '../../../tasks/task-value-metrics-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerTaskRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const application = new TaskApplicationService();
  const operatingViews = new ProjectOperatingViewService(deps.service.projects);
  const monitoring = new ProjectMonitoringService();
  const metrics = new TaskValueMetricsService();
  const tasks = new TaskRepository();
  const runs = new TaskRunRepository();
  const context = new TaskContextRepository();
  const projector = new TaskReadModelProjector();
  const signals = new TaskSignalService(() => deps.service.dispatchTaskRuns());
  const dependencies = new TaskDependencyService();

  authenticated.get('/api/tasks', (c) => {
    const phase = TaskPhaseSchema.safeParse(c.req.query('phase'));
    const rawLimit = Number(c.req.query('limit') ?? 50);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
    return c.json({
      ok: true,
      items: tasks.list({ ...(phase.success ? { phase: phase.data } : {}), limit })
        .map((task) => {
          const model = projector.project(task);
          return { task, operationalState: model.operationalState, attention: model.attention };
        }),
    });
  });

  authenticated.post('/api/tasks', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = TaskCreateRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid task request' }, 400);
    try {
      const created = application.create(parsed.data);
      if (created.ok === false) return c.json({ ok: false, code: created.reason, error: created.reason }, 409);
      if (created.runId) deps.service.dispatchTaskRuns();
      return c.json({
        ok: true,
        task: created.model.task,
        operationalState: created.model.operationalState,
        ...(created.runId ? { run: runs.get(created.runId) } : {}),
      }, created.runId ? 202 : 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, error: message }, message === 'Project not found' ? 404 : 409);
    }
  });

  authenticated.get('/api/tasks/metrics', (c) => c.json({ ok: true, metrics: metrics.get() }));

  authenticated.get('/api/tasks/:id', (c) => {
    const task = tasks.get(c.req.param('id'));
    if (!task) return c.json({ ok: false, error: 'Task not found' }, 404);
    const model = projector.project(task);
    return c.json({
      ok: true,
      task,
      operationalState: model.operationalState,
      attention: model.attention,
      waits: runs.listActiveWaits(task.id),
      runs: runs.listByTask(task.id),
      receipts: runs.listReceipts(task.id),
      context: context.list(task.id),
      authorityGrants: context.listActiveGrants(task.id),
      dependencies: dependencies.listDependencies(task.id),
      dependents: dependencies.listDependents(task.id),
      allowedCommands: model.allowedCommands,
    });
  });

  authenticated.patch('/api/tasks/:id', deps.strictRateLimitMiddleware, async (c) => {
    const parsed = TaskPatchRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid task patch' }, 400);
    const updated = tasks.update(c.req.param('id'), parsed.data);
    if (!updated) return c.json({ ok: false, error: 'Task changed or was not found' }, 409);
    return c.json({ ok: true, task: updated });
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

  authenticated.post('/api/tasks/:id/commands', deps.strictRateLimitMiddleware, async (c) => {
    const parsed = TaskCommandRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid task command' }, 400);
    const result = application.execute({
      taskId: c.req.param('id'),
      idempotencyKey: parsed.data.idempotencyKey,
      expectedVersion: parsed.data.expectedVersion,
      command: parsed.data.command!,
    });
    if (result.ok === false) {
      if (result.reason === 'not_found') return c.json({ ok: false, error: 'Task not found' }, 404);
      return c.json({
        ok: false,
        code: result.reason,
        error: result.reason,
        latest: result.model,
      }, 409);
    }
    if (result.runId || parsed.data.command?.type === 'resolve_wait') deps.service.dispatchTaskRuns();
    if (parsed.data.command?.type === 'close' && parsed.data.command.resolution === 'done') {
      signals.dependencyClosed(c.req.param('id'));
    }
    return c.json({ ok: true, ...result.model, ...(result.runId ? { run: runs.get(result.runId) } : {}) });
  });

  authenticated.post('/api/tasks/:id/context', deps.strictRateLimitMiddleware, async (c) => {
    const task = tasks.get(c.req.param('id'));
    if (!task) return c.json({ ok: false, error: 'Task not found' }, 404);
    const parsed = TaskContextInputSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid task context edge' }, 400);
    return c.json({
      ok: true,
      edge: context.add({ taskId: task.id, ...parsed.data, createdBy: { kind: 'user' } }),
    }, 201);
  });

  authenticated.delete('/api/tasks/:id/context/:edgeId', deps.strictRateLimitMiddleware, (c) => {
    const removed = context.remove(c.req.param('id'), c.req.param('edgeId'));
    return removed
      ? c.json({ ok: true })
      : c.json({ ok: false, error: 'Task context edge not found' }, 404);
  });

  authenticated.get('/api/task-runs/:runId', (c) => {
    const run = runs.get(c.req.param('runId'));
    return run
      ? c.json({ ok: true, run, receipt: runs.getReceipt(run.id) })
      : c.json({ ok: false, error: 'TaskRun not found' }, 404);
  });

  authenticated.get('/api/task-runs/:runId/events', (c) => {
    const run = runs.get(c.req.param('runId'));
    return run
      ? c.json({ ok: true, items: runs.listEvents(run.id) })
      : c.json({ ok: false, error: 'TaskRun not found' }, 404);
  });

  authenticated.post('/api/task-runs/:runId/cancel', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const run = runs.get(c.req.param('runId'));
    if (!run) return c.json({ ok: false, error: 'TaskRun not found' }, 404);
    if (!Number.isInteger(body.expectedVersion) || body.expectedVersion !== run.version) {
      return c.json({ ok: false, error: 'TaskRun changed', run }, 409);
    }
    const task = tasks.require(run.taskId);
    const result = application.completeRun({
      runId: run.id,
      expectedRunVersion: run.version,
      actor: { kind: 'user' },
      terminalCode: 'cancelled_by_user',
      terminalMessage: typeof body.reason === 'string' ? body.reason : 'Cancelled by user',
      receipt: {
        status: 'cancelled',
        summary: typeof body.reason === 'string' ? body.reason : 'TaskRun cancelled by user',
        changes: [],
        evidence: [],
        verification: { status: 'unverified', checks: [] },
        remainingWork: [task.contract?.objective ?? task.title],
        needsUser: false,
        completionVerdict: 'not_achieved',
      },
    });
    if (result.ok === false) return c.json({ ok: false, error: result.reason }, 409);
    return c.json({ ok: true, run: runs.get(run.id), receipt: runs.getReceipt(run.id) });
  });

  authenticated.post('/api/task-runs/:runId/feedback', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (body.rating !== 'helpful' && body.rating !== 'not_helpful') {
      return c.json({ ok: false, error: 'Invalid feedback rating' }, 400);
    }
    try {
      const feedback = runs.recordFeedback({
        runId: c.req.param('runId'),
        rating: body.rating,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
      });
      return c.json({ ok: true, feedback });
    } catch {
      return c.json({ ok: false, error: 'TaskRun not found' }, 404);
    }
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
