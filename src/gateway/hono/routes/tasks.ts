import { patchChatModelConfig } from './chat-model-config.js';
import type { Hono } from 'hono';
import {
  ProjectMonitoringUpdateSchema,
  TaskBoardPositionRequestSchema,
  TaskCommandRequestSchema,
  TaskContextInputSchema,
  TaskCreateRequestSchema,
  type TaskChangedField,
  TaskDependencyUpdateRequestSchema,
  TaskHandoffRequestSchema,
  TaskPatchRequestSchema,
  TaskPhaseSchema,
} from '@xopcai/gateway-contract';

import { runSqliteWriteTransaction } from '../../../storage/sqlite/transaction.js';
import { ProjectMonitoringService } from '../../../tasks/project-monitoring-service.js';
import { resolveProjectAgentId } from '../../../projects/project-agent.js';
import { TaskApplicationService } from '../../../tasks/task-application-service.js';
import { TaskContextRepository } from '../../../tasks/task-context-repository.js';
import { TaskConversationRepository } from '../../../tasks/task-conversation-repository.js';
import { TaskConversationQueryService } from '../../service/task-conversation-query-service.js';
import { TaskHandoffService } from '../../../tasks/task-handoff-service.js';
import { enqueueTaskChangedEvent } from '../../../tasks/task-change-events.js';
import {
  TaskDependencyError,
  TaskDependencyService,
} from '../../../tasks/task-dependency-service.js';
import { TaskDeletionService } from '../../../tasks/task-deletion-service.js';
import { TaskRepository } from '../../../tasks/task-repository.js';
import { TaskReadModelProjector } from '../../../tasks/task-read-model-projector.js';
import { TaskRunRepository } from '../../../tasks/task-run-repository.js';
import { TaskSignalService } from '../../../tasks/task-signal-service.js';
import { ProjectOperatingViewService } from '../../../tasks/project-operating-view-service.js';
import { TaskValueMetricsService } from '../../../tasks/task-value-metrics-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { submitSessionInput } from './session-input-handler.js';

export function registerTaskRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const taskRateLimit = deps.taskRateLimitMiddleware ?? deps.strictRateLimitMiddleware;
  const application = new TaskApplicationService();
  const operatingViews = new ProjectOperatingViewService(deps.service.projects);
  const monitoring = new ProjectMonitoringService();
  const metrics = new TaskValueMetricsService();
  const tasks = new TaskRepository();
  const runs = new TaskRunRepository();
  const context = new TaskContextRepository();
  const conversations = new TaskConversationRepository();
  const conversationQuery = new TaskConversationQueryService(deps.service.sessions);
  const projector = new TaskReadModelProjector();
  const signals = new TaskSignalService(() => deps.service.dispatchTaskRuns());
  const dependencies = new TaskDependencyService();
  const deletion = new TaskDeletionService(tasks, runs);
  const handoffs = new TaskHandoffService({
    getConfig: () => deps.service.currentConfig,
    sessionIndex: deps.service.sessionIndexInstance,
    getActiveRunId: (sessionKey) => deps.service.getActiveWebchatRunId(sessionKey),
    abortRun: (runId) => deps.service.abortAgentRun(runId),
  });

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

  authenticated.post('/api/tasks', taskRateLimit, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = TaskCreateRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid task request' }, 400);
    try {
      const requestedAgentId = parsed.data.delegateAgentId
        ?? (parsed.data.activation.mode === 'start' && parsed.data.activation.executor?.kind === 'agent'
          ? parsed.data.activation.executor.agentId
          : undefined);
      const agentId = resolveProjectAgentId({
        config: deps.service.currentConfig,
        projects: deps.service.projects,
        explicitAgentId: requestedAgentId,
        projectId: parsed.data.projectId,
      });
      const input = {
        ...parsed.data,
        delegateAgentId: agentId,
        activation: parsed.data.activation.mode === 'start'
          ? {
              ...parsed.data.activation,
              executor: parsed.data.activation.executor?.kind === 'agent' || !parsed.data.activation.executor
                ? { kind: 'agent' as const, agentId }
                : parsed.data.activation.executor,
            }
          : parsed.data.activation,
      };
      const created = application.create(input);
      if (created.ok === false) return c.json({ ok: false, code: created.reason, error: created.reason }, 409);
      if (created.runId) deps.service.dispatchTaskRuns();
      else deps.service.dispatchTaskEvents();
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
      conversation: conversations.requireState(task.id),
      sessions: conversations.listSessions(task.id),
      authorityGrants: context.listActiveGrants(task.id),
      dependencies: dependencies.listDependencies(task.id),
      dependents: dependencies.listDependents(task.id),
      allowedCommands: model.allowedCommands,
    });
  });

  authenticated.post('/api/tasks/:id/conversation', taskRateLimit, async (c) => {
    try {
      const result = await deps.service.ensureTaskConversation(c.req.param('id'));
      if (result.created) {
        const task = tasks.require(c.req.param('id'));
        runSqliteWriteTransaction((db) => enqueueTaskChangedEvent(db, {
          taskId: task.id,
          projectId: task.projectId,
          version: task.version,
          changedFields: ['conversation'],
          actor: { kind: 'user' },
        }));
        deps.service.dispatchTaskEvents();
      }
      return c.json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, error: message }, message.startsWith('Task not found') ? 404 : 409);
    }
  });

  authenticated.post('/api/tasks/:id/handoff', taskRateLimit, async (c) => {
    const parsed = TaskHandoffRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid task handoff request' }, 400);
    try {
      const result = await handoffs.handoff({ taskId: c.req.param('id'), ...parsed.data });
      runSqliteWriteTransaction((db) => enqueueTaskChangedEvent(db, {
        taskId: result.task.id,
        projectId: result.task.projectId,
        version: result.task.version,
        changedFields: ['delegateAgentId', 'conversation'],
        actor: { kind: 'user' },
      }));
      deps.service.dispatchTaskEvents();
      return c.json({
        ok: true,
        task: result.task,
        conversation: result.conversation,
        ...(result.fromAgentId ? { fromAgentId: result.fromAgentId } : {}),
        toAgentId: result.toAgentId,
        activeSessionKey: result.activeSessionKey,
        assignmentEpoch: result.assignmentEpoch,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, error: message }, message.startsWith('Agent not found') || message.startsWith('Task not found') ? 404 : 409);
    }
  });

  authenticated.post('/api/tasks/:id/inputs', deps.chatRateLimitMiddleware, async (c) => {
    const active = conversations.getActiveSession(c.req.param('id'));
    if (!active?.sessionKey) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task has no active conversation' } }, 404);
    }
    const expectedSessionKey = c.req.header('X-Xopc-Expected-Session-Key')?.trim();
    if (expectedSessionKey && expectedSessionKey !== active.sessionKey) {
      return c.json({ ok: false, error: { code: 'CONFLICT', message: 'Task executor changed; refresh the conversation' } }, 409);
    }
    return submitSessionInput(c, deps, active.sessionKey);
  });

  authenticated.patch('/api/tasks/:id/conversation/config', taskRateLimit, async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return c.json({ ok: false, error: 'Invalid configuration' }, 400);
    const active = conversations.getActiveSession(c.req.param('id'));
    if (!active?.sessionKey) return c.json({ ok: false, error: 'Task has no active conversation' }, 404);
    return patchChatModelConfig(c, deps.service, active.sessionKey, body);
  });

  authenticated.get('/api/tasks/:id/conversation/history', async (c) => {
    const parsedLimit = Number.parseInt(c.req.query('limit') ?? '50', 10);
    const parsedOffset = Number.parseInt(c.req.query('offset') ?? '0', 10);
    const rawBefore = c.req.query('before')?.trim();
    const before = rawBefore === undefined ? undefined : Number.parseInt(rawBefore, 10);
    if (rawBefore !== undefined && (!Number.isInteger(before) || before! < 0)) {
      return c.json({ error: 'Invalid conversation history cursor' }, 400);
    }
    const result = await conversationQuery.getMessagePage(c.req.param('id'), {
      limit: Number.isFinite(parsedLimit) ? Math.min(200, Math.max(1, parsedLimit)) : 50,
      offset: Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0,
      ...(before === undefined ? {} : { before }),
    });
    return result ? c.json(result) : c.json({ error: 'Task conversation not found' }, 404);
  });

  authenticated.get('/api/tasks/:id/conversation/timeline', async (c) => {
    const items = await conversationQuery.getTimeline(c.req.param('id'));
    return items ? c.json({ ok: true, items }) : c.json({ ok: false, error: 'Task conversation not found' }, 404);
  });

  authenticated.patch('/api/tasks/:id', taskRateLimit, async (c) => {
    const parsed = TaskPatchRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid task patch' }, 400);
    const updated = runSqliteWriteTransaction((db) => {
      const task = tasks.update(c.req.param('id'), parsed.data);
      if (!task) return undefined;
      const changedFields = Object.keys(parsed.data)
        .filter((field): field is TaskChangedField => field !== 'expectedVersion');
      enqueueTaskChangedEvent(db, {
        taskId: task.id,
        projectId: task.projectId,
        version: task.version,
        changedFields,
        actor: { kind: 'user' },
      });
      return task;
    });
    if (!updated) return c.json({ ok: false, error: 'Task changed or was not found' }, 409);
    deps.service.dispatchTaskEvents();
    return c.json({ ok: true, task: updated });
  });

  authenticated.delete('/api/tasks/:id', taskRateLimit, (c) => {
    const taskId = c.req.param('id');
    const result = deletion.delete(taskId);
    if (result.ok === true) {
      deps.service.dispatchTaskEvents();
      return c.json({ ok: true, deleted: true, taskId });
    }
    if (result.reason === 'active_run') {
      return c.json({
        ok: false,
        code: 'task_active',
        error: 'Cancel the active TaskRun before deleting the Task',
        runId: result.run.id,
      }, 409);
    }
    return c.json({ ok: false, code: 'task_not_found', error: 'Task not found' }, 404);
  });

  authenticated.put('/api/tasks/:id/dependencies', taskRateLimit, async (c) => {
    const parsed = TaskDependencyUpdateRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid task dependencies' }, 400);
    try {
      const task = runSqliteWriteTransaction((db) => {
        const changed = dependencies.replace({ taskId: c.req.param('id'), ...parsed.data });
        enqueueTaskChangedEvent(db, {
          taskId: changed.id,
          projectId: changed.projectId,
          version: changed.version,
          changedFields: ['dependencies'],
          actor: { kind: 'user' },
        });
        return changed;
      });
      deps.service.dispatchTaskEvents();
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

  authenticated.put('/api/tasks/:id/board-position', taskRateLimit, async (c) => {
    const parsed = TaskBoardPositionRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid task board position' }, 400);
    try {
      const task = runSqliteWriteTransaction((db) => {
        const reordered = tasks.reorder({ taskId: c.req.param('id'), ...parsed.data });
        if (!reordered) return undefined;
        enqueueTaskChangedEvent(db, {
          taskId: reordered.id,
          projectId: reordered.projectId,
          version: reordered.version,
          changedFields: ['boardRank'],
          actor: { kind: 'user' },
        });
        return reordered;
      });
      if (!task) return c.json({ ok: false, error: 'Task changed or was not found' }, 409);
      deps.service.dispatchTaskEvents();
      return c.json({ ok: true, task });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/tasks/:id/commands', taskRateLimit, async (c) => {
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
    else deps.service.dispatchTaskEvents();
    if (parsed.data.command?.type === 'close' && parsed.data.command.resolution === 'done') {
      signals.dependencyClosed(c.req.param('id'));
    }
    return c.json({ ok: true, ...result.model, ...(result.runId ? { run: runs.get(result.runId) } : {}) });
  });

  authenticated.post('/api/tasks/:id/context', taskRateLimit, async (c) => {
    const task = tasks.get(c.req.param('id'));
    if (!task) return c.json({ ok: false, error: 'Task not found' }, 404);
    const parsed = TaskContextInputSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid task context edge' }, 400);
    const edge = runSqliteWriteTransaction((db) => {
      const created = context.add({ taskId: task.id, ...parsed.data, createdBy: { kind: 'user' } });
      enqueueTaskChangedEvent(db, {
        taskId: task.id,
        projectId: task.projectId,
        version: task.version,
        changedFields: ['context'],
        actor: { kind: 'user' },
      });
      return created;
    });
    deps.service.dispatchTaskEvents();
    return c.json({ ok: true, edge }, 201);
  });

  authenticated.delete('/api/tasks/:id/context/:edgeId', taskRateLimit, (c) => {
    const task = tasks.get(c.req.param('id'));
    const removed = task ? runSqliteWriteTransaction((db) => {
      const didRemove = context.remove(task.id, c.req.param('edgeId'));
      if (didRemove) {
        enqueueTaskChangedEvent(db, {
          taskId: task.id,
          projectId: task.projectId,
          version: task.version,
          changedFields: ['context'],
          actor: { kind: 'user' },
        });
      }
      return didRemove;
    }) : false;
    if (removed) deps.service.dispatchTaskEvents();
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

  authenticated.post('/api/task-runs/:runId/cancel', taskRateLimit, async (c) => {
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
    deps.service.dispatchTaskEvents();
    return c.json({ ok: true, run: runs.get(run.id), receipt: runs.getReceipt(run.id) });
  });

  authenticated.post('/api/task-runs/:runId/feedback', taskRateLimit, async (c) => {
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

  authenticated.patch('/api/projects/:projectId/monitoring', taskRateLimit, async (c) => {
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
