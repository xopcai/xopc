import { patchChatModelConfig } from './chat-model-config.js';
import type { Context, Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { TaskContextMutationOutputSchema } from '../../../tasks/capabilities/relations.js';
import { capabilityHttpContext, capabilityHttpError } from '../../../capabilities/adapters/http.js';
import { CapabilityError } from '../../../capabilities/runtime/dispatcher.js';
import { createProductDispatcher } from '../../../capabilities/runtime/product.js';
import { TaskMutationOutputSchema } from '../../../tasks/capabilities/write.js';
import { TaskDeleteOutputSchema } from '../../../tasks/capabilities/management.js';
import {
  TaskCommandRequestSchema,
  TaskCreateRequestSchema,
  TaskHandoffRequestSchema,
  TaskRunCancelOutputSchema,
  TaskRunFeedbackOutputSchema,
  ProductReadContracts,
} from '@xopcai/gateway-contract';

import { runSqliteWriteTransaction } from '../../../storage/sqlite/transaction.js';
import { TaskConversationRepository } from '../../../tasks/task-conversation-repository.js';
import { TaskConversationQueryService } from '../../service/task-conversation-query-service.js';
import { TaskHandoffService } from '../../../tasks/task-handoff-service.js';
import { enqueueTaskChangedEvent } from '../../../tasks/task-change-events.js';
import { TaskRepository } from '../../../tasks/task-repository.js';
import { TaskRunRepository } from '../../../tasks/task-run-repository.js';
import { ProjectOperatingViewService } from '../../../tasks/project-operating-view-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { submitSessionInput } from './session-input-handler.js';

export function registerTaskRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const capabilities = createProductDispatcher(() => deps.service.notesServiceInstance, {
    getConfig: () => deps.service.currentConfig, getProjects: () => deps.service.projects,
    wake: runId => runId ? deps.service.dispatchTaskRuns() : deps.service.dispatchTaskEvents(),
    abortConversation: async conversationId => {
      const liveRunId = deps.service.getActiveWebchatRunId(conversationId);
      if (liveRunId) await deps.service.abortAgentRun(liveRunId);
    },
  });
  const taskRateLimit = deps.taskRateLimitMiddleware ?? deps.strictRateLimitMiddleware;
  const invokeRelation = async (c: Context, operation: string, input: unknown) => {
    const caller = capabilityHttpContext(c);
    return capabilities.call(operation, input, caller, { ...capabilities.describe(operation, caller),
      idempotencyKey: c.req.header('idempotency-key') ?? randomUUID() });
  };
  const operatingViews = new ProjectOperatingViewService(deps.service.projects);
  const tasks = new TaskRepository();
  const runs = new TaskRunRepository();
  const conversations = new TaskConversationRepository();
  const conversationQuery = new TaskConversationQueryService(deps.service.sessions);
  const handoffs = new TaskHandoffService({
    sessionIndex: deps.service.sessionIndexInstance,
    getActiveRunId: (conversationId) => deps.service.getActiveWebchatRunId(conversationId),
    abortRun: (runId) => deps.service.abortAgentRun(runId),
  });

  authenticated.get('/api/tasks', async (c) => {
    try {
      const input: Record<string, unknown> = { ...c.req.query() };
      for (const key of ['limit', 'offset']) if (input[key] !== undefined) input[key] = Number(input[key]);
      return c.json(await capabilities.call('xopc.tasks.list', input, capabilityHttpContext(c)));
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.post('/api/tasks', taskRateLimit, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = TaskCreateRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid task request' }, 400);
    try {
      const context = capabilityHttpContext(c);
      const { idempotencyKey, ...input } = parsed.data;
      const created = TaskMutationOutputSchema.parse(await capabilities.call(
        'xopc.tasks.create', input, context,
        { ...capabilities.describe('xopc.tasks.create', context), idempotencyKey },
      ));
      if (created.ok === false) return c.json({ ok: false, code: created.reason, error: created.reason }, 409);
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

  authenticated.get('/api/tasks/metrics', async (c) => {
    try { return c.json(await capabilities.call('xopc.tasks.metrics', {}, capabilityHttpContext(c))); }
    catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/tasks/:id', async (c) => {
    try {
      return c.json(await capabilities.call('xopc.tasks.get', { id: c.req.param('id') }, capabilityHttpContext(c)));
    } catch (error) { return capabilityHttpError(c, error); }
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
        activeConversationId: result.activeConversationId,
        assignmentEpoch: result.assignmentEpoch,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, error: message }, message.startsWith('Agent not found') || message.startsWith('Task not found') ? 404 : 409);
    }
  });

  authenticated.post('/api/tasks/:id/inputs', deps.chatRateLimitMiddleware, async (c) => {
    const active = conversations.getActiveSession(c.req.param('id'));
    if (!active?.conversationId) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task has no active conversation' } }, 404);
    }
    const expectedConversationId = c.req.header('X-Xopc-Expected-Session-Key')?.trim();
    if (expectedConversationId && expectedConversationId !== active.conversationId) {
      return c.json({ ok: false, error: { code: 'CONFLICT', message: 'Task executor changed; refresh the conversation' } }, 409);
    }
    return submitSessionInput(c, deps, active.conversationId, { taskConversation: true });
  });

  authenticated.patch('/api/tasks/:id/conversation/config', taskRateLimit, async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return c.json({ ok: false, error: 'Invalid configuration' }, 400);
    const active = conversations.getActiveSession(c.req.param('id'));
    if (!active?.conversationId) return c.json({ ok: false, error: 'Task has no active conversation' }, 404);
    return patchChatModelConfig(c, deps.service, active.conversationId, body);
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

  authenticated.get('/api/tasks/:id/conversation/find', async (c) => {
    const query = c.req.query('q')?.trim() ?? '';
    if (!query || query.length > 256) {
      return c.json({ ok: false, error: 'q must contain 1 to 256 characters' }, 400);
    }
    const result = await conversationQuery.findMessages(c.req.param('id'), query);
    return result ? c.json({ ok: true, ...result }) : c.json({ ok: false, error: 'Task conversation not found' }, 404);
  });

  authenticated.patch('/api/tasks/:id', taskRateLimit, async (c) => {
    try {
      return c.json(await invokeRelation(c, 'xopc.tasks.update', { ...await c.req.json().catch(() => ({})), taskId: c.req.param('id') }));
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.delete('/api/tasks/:id', taskRateLimit, async (c) => {
    const taskId = c.req.param('id');
    let result;
    try { result = TaskDeleteOutputSchema.parse(await invokeRelation(c, 'xopc.tasks.delete', { taskId })); }
    catch (error) { return capabilityHttpError(c, error); }
    if (result.ok === true) {
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
    try {
      return c.json(await invokeRelation(c, 'xopc.tasks.update_dependencies', {
        ...await c.req.json().catch(() => ({})), taskId: c.req.param('id'),
      }));
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.put('/api/tasks/:id/board-position', taskRateLimit, async (c) => {
    try {
      return c.json(await invokeRelation(c, 'xopc.tasks.reorder', { ...await c.req.json().catch(() => ({})), taskId: c.req.param('id') }));
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.post('/api/tasks/:id/commands', taskRateLimit, async (c) => {
    const parsed = TaskCommandRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid task command' }, 400);
    const capabilityContext = capabilityHttpContext(c);
    const { idempotencyKey, ...input } = parsed.data;
    let result;
    try {
      result = TaskMutationOutputSchema.parse(await capabilities.call('xopc.tasks.command',
        { ...input, taskId: c.req.param('id') }, capabilityContext,
        { ...capabilities.describe('xopc.tasks.command', capabilityContext), idempotencyKey }));
    } catch (error) { return capabilityHttpError(c, error); }
    if (result.ok === false) {
      if (result.reason === 'not_found') return c.json({ ok: false, error: 'Task not found' }, 404);
      return c.json({
        ok: false,
        code: result.reason,
        error: result.reason,
        latest: result.model,
      }, 409);
    }
    return c.json({ ok: true, ...result.model, ...(result.runId ? { run: runs.get(result.runId) } : {}) });
  });

  authenticated.post('/api/tasks/:id/context', taskRateLimit, async (c) => {
    try {
      const { expectedVersion, ...edge } = (await c.req.json().catch(() => ({}))) ?? {};
      const result = TaskContextMutationOutputSchema.parse(await invokeRelation(c, 'xopc.tasks.add_context', {
        taskId: c.req.param('id'), edge, expectedVersion,
      }));
      return c.json({ ok: true, edge: result.edge }, 201);
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.delete('/api/tasks/:id/context/:edgeId', taskRateLimit, async (c) => {
    try {
      await invokeRelation(c, 'xopc.tasks.remove_context', { taskId: c.req.param('id'), edgeId: c.req.param('edgeId') });
      return c.json({ ok: true });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/task-runs/:runId', async (c) => {
    try {
      const { run, receipt } = ProductReadContracts['xopc.task_runs.get'].output.parse(
        await capabilities.call('xopc.task_runs.get', { id: c.req.param('runId') }, capabilityHttpContext(c)));
      return c.json({ ok: true, run, receipt });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/task-runs/:runId/events', async (c) => {
    try {
      const { events } = ProductReadContracts['xopc.task_runs.get'].output.parse(
        await capabilities.call('xopc.task_runs.get', { id: c.req.param('runId') }, capabilityHttpContext(c)));
      return c.json({ ok: true, items: events });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.post('/api/task-runs/:runId/cancel', taskRateLimit, async (c) => {
    try {
      const body = await c.req.json().catch(() => { throw new CapabilityError('INVALID_INPUT', 'Invalid JSON body'); });
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CapabilityError('INVALID_INPUT', 'Expected an object');
      const { run, receipt, executionStopConfirmed } = TaskRunCancelOutputSchema.parse(await invokeRelation(c, 'xopc.task_runs.cancel', {
        id: c.req.param('runId'), expectedVersion: body.expectedVersion, reason: body.reason,
      }));
      return c.json({ ok: true, run, receipt, executionStopConfirmed });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.post('/api/task-runs/:runId/feedback', taskRateLimit, async (c) => {
    try {
      const body = await c.req.json().catch(() => { throw new CapabilityError('INVALID_INPUT', 'Invalid JSON body'); });
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CapabilityError('INVALID_INPUT', 'Expected an object');
      return c.json(TaskRunFeedbackOutputSchema.parse(await invokeRelation(c, 'xopc.task_runs.feedback', {
        ...body, id: c.req.param('runId'),
      })));
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/projects/:projectId/operating-view', (c) => {
    const view = operatingViews.get(c.req.param('projectId'));
    return view
      ? c.json({ ok: true, view })
      : c.json({ ok: false, error: 'Project not found' }, 404);
  });


}
