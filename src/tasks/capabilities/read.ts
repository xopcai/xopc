import {
  ProductReadContracts,
} from '@xopcai/gateway-contract';

import { CapabilityError, defineReadCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { TaskRepository } from '../task-repository.js';
import { TaskRunRepository } from '../task-run-repository.js';
import { TaskReadModelProjector } from '../task-read-model-projector.js';
import { TaskContextRepository } from '../task-context-repository.js';
import { TaskConversationRepository } from '../task-conversation-repository.js';
import { TaskDependencyService } from '../task-dependency-service.js';
import { TaskValueMetricsService } from '../task-value-metrics-service.js';

export function registerTaskReadCapabilities(dispatcher: CapabilityDispatcher): void {
  dispatcher.register(defineReadCapability({
    id: 'xopc.tasks.metrics', majorVersion: 1, description: 'Read task outcome metrics for this personal workspace.',
    effect: 'read', surfaces: ['http', 'agent', 'cli'], scopes: ['tasks.read'],
    ...ProductReadContracts['xopc.tasks.metrics'],
    execute: () => ({ ok: true as const, metrics: new TaskValueMetricsService().get() }),
  }));
  const tasks = new TaskRepository();
  const runs = new TaskRunRepository();
  const projector = new TaskReadModelProjector();
  const context = new TaskContextRepository();
  const conversations = new TaskConversationRepository();
  const dependencies = new TaskDependencyService();
  dispatcher.register(defineReadCapability({
    id: 'xopc.task_runs.get', majorVersion: 1, description: 'Read a task run, receipt, events and active waits.',
    effect: 'read', surfaces: ['http', 'agent', 'cli'], scopes: ['tasks.read'],
    ...ProductReadContracts['xopc.task_runs.get'],
    execute({ id }) {
      const run = runs.get(id);
      if (!run) throw new CapabilityError('NOT_FOUND', `TaskRun not found: ${id}`);
      return { ok: true as const, run, receipt: runs.getReceipt(id), events: runs.listEvents(id), activeWaits: runs.listActiveWaits(run.taskId) };
    },
  }));
  dispatcher.register(defineReadCapability({
    id: 'xopc.task_runs.list', majorVersion: 1, description: 'List executions and receipts for a task.',
    effect: 'read', surfaces: ['http', 'agent', 'cli'], scopes: ['tasks.read'],
    ...ProductReadContracts['xopc.task_runs.list'],
    execute({ taskId, limit }) {
      if (!tasks.get(taskId)) throw new CapabilityError('NOT_FOUND', `Task not found: ${taskId}`);
      return { ok: true as const, taskId, items: runs.listByTask(taskId, limit),
        receipts: runs.listReceipts(taskId, limit), activeWaits: runs.listActiveWaits(taskId) };
    },
  }));
  dispatcher.register(defineReadCapability({
    id: 'xopc.tasks.get', majorVersion: 1, description: 'Read a task, its current execution, context and dependencies.',
    effect: 'read', surfaces: ['http', 'agent', 'cli', 'extension'], scopes: ['tasks.read'],
    ...ProductReadContracts['xopc.tasks.get'],
    execute({ id }) {
      const task = tasks.get(id);
      if (!task) throw new CapabilityError('NOT_FOUND', `Task not found: ${id}`);
      const model = projector.project(task);
      return {
        ok: true as const, ...model,
        waits: runs.listActiveWaits(id), runs: runs.listByTask(id), receipts: runs.listReceipts(id),
        context: context.list(id), conversation: conversations.requireState(id), sessions: conversations.listSessions(id),
        authorityGrants: context.listActiveGrants(id),
        dependencies: dependencies.listDependencies(id), dependents: dependencies.listDependents(id),
      };
    },
  }));
  dispatcher.register(defineReadCapability({
    id: 'xopc.tasks.list', majorVersion: 1, description: 'List tasks with filters and pagination.',
    effect: 'read', surfaces: ['http', 'agent', 'cli', 'extension'], scopes: ['tasks.read'],
    ...ProductReadContracts['xopc.tasks.list'],
    execute(input) {
      return { ok: true as const, items: tasks.list(input).map(task => projector.project(task)), total: tasks.count(input) };
    },
  }));
}
