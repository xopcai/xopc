import { TaskContextEdgeSchema, TaskContextInputSchema, TaskDependencySummarySchema, TaskDependencyUpdateRequestSchema, TaskDetailResponseSchema } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { CapabilityError, defineAtomicCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { enqueueTaskChangedEvent } from '../task-change-events.js';
import { TaskContextRepository } from '../task-context-repository.js';
import { TaskDependencyError, TaskDependencyService } from '../task-dependency-service.js';
import { TaskRepository } from '../task-repository.js';

export const TaskDependenciesOutputSchema = z.object({ ok: z.literal(true), task: TaskDetailResponseSchema.shape.task,
  dependencies: z.array(TaskDependencySummarySchema), dependents: z.array(TaskDependencySummarySchema) });
export const TaskContextMutationOutputSchema = z.object({ ok: z.literal(true), taskId: z.string(), edgeId: z.string(),
  version: z.number().int().positive(), edge: TaskContextEdgeSchema.optional(), context: z.array(TaskContextEdgeSchema) });

export function registerTaskRelationCapabilities(dispatcher: CapabilityDispatcher, wake?: (runs: boolean) => void): void {
  const tasks = new TaskRepository();
  const dependencies = new TaskDependencyService();
  const context = new TaskContextRepository();
  const policy = { majorVersion: 1, effect: 'local-write' as const, surfaces: ['http', 'agent'] as const, scopes: ['tasks.write'] as const,
    afterCommit: () => wake?.(false) };
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.tasks.update_dependencies', description: 'Replace dependencies at an exact task version.',
    input: TaskDependencyUpdateRequestSchema.extend({ taskId: z.string().min(1) }), output: TaskDependenciesOutputSchema,
    execute(input, caller) {
      try {
        const task = dependencies.replace(input);
        enqueueTaskChangedEvent(getSqliteDatabase(), { taskId: task.id, projectId: task.projectId,
          version: task.version, changedFields: ['dependencies'], actor: caller.actor });
        return { ok: true as const, task, dependencies: dependencies.listDependencies(task.id), dependents: dependencies.listDependents(task.id) };
      } catch (error) {
        if (error instanceof TaskDependencyError) throw new CapabilityError(error.code === 'not_found' ? 'NOT_FOUND'
          : error.code === 'conflict' ? 'REVISION_CONFLICT' : 'INVALID_INPUT', error.message);
        throw error;
      }
    },
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.tasks.add_context', description: 'Attach task context once and advance the task revision.',
    input: z.strictObject({ taskId: z.string().min(1), edge: TaskContextInputSchema, expectedVersion: z.number().int().positive().optional() }),
    output: TaskContextMutationOutputSchema,
    execute(input, caller) {
      const task = tasks.get(input.taskId);
      if (!task) throw new CapabilityError('NOT_FOUND', 'Task not found');
      const updated = tasks.update(task.id, { expectedVersion: input.expectedVersion ?? task.version });
      if (!updated) throw new CapabilityError('REVISION_CONFLICT', 'Task changed');
      const edge = context.add({ taskId: task.id, ...input.edge, createdBy: caller.actor ?? { kind: 'system' } });
      enqueueTaskChangedEvent(getSqliteDatabase(), { taskId: task.id, projectId: task.projectId,
        version: updated.version, changedFields: ['context'], actor: caller.actor });
      return { ok: true as const, taskId: task.id, edgeId: edge.id, edge, version: updated.version, context: context.list(task.id) };
    },
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.tasks.remove_context', description: 'Remove a task context edge once and advance the task revision.',
    input: z.strictObject({ taskId: z.string().min(1), edgeId: z.string().min(1), expectedVersion: z.number().int().positive().optional() }),
    output: TaskContextMutationOutputSchema,
    execute(input, caller) {
      const task = tasks.get(input.taskId);
      if (!task) throw new CapabilityError('NOT_FOUND', 'Task not found');
      const updated = tasks.update(task.id, { expectedVersion: input.expectedVersion ?? task.version });
      if (!updated) throw new CapabilityError('REVISION_CONFLICT', 'Task changed');
      if (!context.remove(task.id, input.edgeId)) throw new CapabilityError('NOT_FOUND', 'Task context edge not found');
      enqueueTaskChangedEvent(getSqliteDatabase(), { taskId: task.id, projectId: task.projectId,
        version: updated.version, changedFields: ['context'], actor: caller.actor });
      return { ok: true as const, taskId: task.id, edgeId: input.edgeId, version: updated.version, context: context.list(task.id) };
    },
  }));
}
