import { TaskBoardPositionRequestSchema, TaskPatchRequestSchema, TaskSchema, TaskRunSchema, type TaskChangedField } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { CapabilityError, defineAtomicCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { enqueueTaskChangedEvent } from '../task-change-events.js';
import { TaskDeletionService } from '../task-deletion-service.js';
import { TaskRepository } from '../task-repository.js';

export const TaskEditOutputSchema = z.object({ ok: z.literal(true), task: TaskSchema });
export const TaskDeleteOutputSchema = z.union([
  z.object({ ok: z.literal(true), task: TaskSchema }),
  z.object({ ok: z.literal(false), reason: z.literal('not_found') }),
  z.object({ ok: z.literal(false), reason: z.literal('active_run'), run: TaskRunSchema }),
]);

export function registerTaskManagementCapabilities(dispatcher: CapabilityDispatcher, wake?: (runs: boolean) => void): void {
  const tasks = new TaskRepository();
  const policy = { majorVersion: 1, effect: 'local-write' as const, surfaces: ['http'] as const, scopes: ['tasks.write'] as const,
    afterCommit: () => wake?.(false) };
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.tasks.update', description: 'Update task metadata at an exact version.',
    input: TaskPatchRequestSchema.extend({ taskId: z.string().min(1) }), output: TaskEditOutputSchema,
    execute({ taskId, ...patch }, caller) {
      const task = tasks.update(taskId, patch);
      if (!task) throw new CapabilityError('REVISION_CONFLICT', 'Task changed or was not found');
      enqueueTaskChangedEvent(getSqliteDatabase(), { taskId, projectId: task.projectId, version: task.version,
        changedFields: Object.keys(patch).filter((field): field is TaskChangedField => field !== 'expectedVersion'), actor: caller.actor });
      return { ok: true as const, task };
    },
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.tasks.reorder', description: 'Reorder a task in its current board at an exact version.',
    input: TaskBoardPositionRequestSchema.extend({ taskId: z.string().min(1) }), output: TaskEditOutputSchema,
    execute(input, caller) {
      let task;
      try { task = tasks.reorder(input); }
      catch (error) { throw new CapabilityError('INVALID_INPUT', error instanceof Error ? error.message : 'Invalid board position'); }
      if (!task) throw new CapabilityError('REVISION_CONFLICT', 'Task changed or was not found');
      enqueueTaskChangedEvent(getSqliteDatabase(), { taskId: task.id, projectId: task.projectId,
        version: task.version, changedFields: ['boardRank'], actor: caller.actor });
      return { ok: true as const, task };
    },
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, surfaces: ['http', 'agent'], id: 'xopc.tasks.delete', description: 'Delete a task only when no active run exists.',
    input: z.strictObject({ taskId: z.string().min(1), expectedVersion: z.number().int().positive().optional() }), output: TaskDeleteOutputSchema,
    execute(input) {
      const task = tasks.get(input.taskId);
      if (task && input.expectedVersion !== undefined && task.version !== input.expectedVersion) throw new CapabilityError('REVISION_CONFLICT', 'Task changed');
      return new TaskDeletionService().delete(input.taskId);
    },
  }));
}
