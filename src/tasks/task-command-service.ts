import type { TaskAction } from '@xopcai/gateway-contract';

import type { EnqueueTaskOptions, TaskQueueItem } from './task-queue.js';
import { TaskDependencyService } from './task-dependency-service.js';
import { TaskRepository, type TaskAggregate } from './task-repository.js';

export type TaskCommandResult =
  | { ok: true; task: TaskAggregate; queued?: TaskQueueItem; waitingOn?: ReturnType<TaskDependencyService['listBlocking']> }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'conflict'; latest: TaskAggregate }
  | { ok: false; reason: 'invalid_transition'; latest: TaskAggregate }
  | { ok: false; reason: 'approval_required'; latest: TaskAggregate; requiredBoundaries: string[] };

type EnqueueTask = (taskId: string, options?: EnqueueTaskOptions) => TaskQueueItem;

const ACTIVE_STATUSES = new Set(['planning', 'running', 'verifying']);
const RESUMABLE_STATUSES = new Set(['paused', 'needs_user', 'blocked']);
const VERIFIABLE_STATUSES = new Set([...ACTIVE_STATUSES, ...RESUMABLE_STATUSES]);

export class TaskCommandService {
  readonly #tasks = new TaskRepository();
  readonly #dependencies = new TaskDependencyService();

  constructor(private readonly enqueueTask: EnqueueTask) {}

  execute(input: {
    taskId: string;
    action: TaskAction;
    expectedUpdatedAt: number;
    approvedBoundaries?: string[];
  }): TaskCommandResult {
    const task = this.#tasks.get(input.taskId);
    if (!task) return { ok: false, reason: 'not_found' };
    if (task.updatedAt !== input.expectedUpdatedAt) {
      return { ok: false, reason: 'conflict', latest: task };
    }

    if (input.action === 'pause') {
      if (!ACTIVE_STATUSES.has(task.status)) {
        return { ok: false, reason: 'invalid_transition', latest: task };
      }
      return this.update(task, { status: 'paused', blockedReason: null }, input.expectedUpdatedAt);
    }

    if (input.action === 'cancel') {
      if (task.status === 'completed' || task.status === 'cancelled') {
        return { ok: false, reason: 'invalid_transition', latest: task };
      }
      return this.update(task, { status: 'cancelled', blockedReason: null }, input.expectedUpdatedAt);
    }

    if (input.action === 'verify') {
      if (!VERIFIABLE_STATUSES.has(task.status)) {
        return { ok: false, reason: 'invalid_transition', latest: task };
      }
      const result = this.update(task, {
        status: 'verifying',
        blockedReason: null,
      }, input.expectedUpdatedAt);
      if (!result.ok) return result;
      return this.enqueueUpdatedTask(task, result.task, {
        source: 'api',
        userTurn: {
          text: 'Verify this task against every acceptance criterion using concrete evidence. If any criterion is not proven, continue the work or identify the exact user input required. Do not mark it complete without verified evidence.',
        },
        executionContext: { triggerKind: 'user', strategy: 'verification' },
      });
    }

    const canStart = input.action === 'run' && task.status === 'pending';
    const canResume = input.action === 'resume' && RESUMABLE_STATUSES.has(task.status);
    if (!canStart && !canResume) {
      return { ok: false, reason: 'invalid_transition', latest: task };
    }

    const approved = new Set([
      ...task.execution.approvedBoundaries,
      ...(input.approvedBoundaries ?? []),
    ]);
    const requiredBoundaries = task.contract?.approvalRequired ?? [];
    const missingBoundaries = requiredBoundaries.filter((boundary) => !approved.has(boundary));
    if (missingBoundaries.length > 0) {
      return { ok: false, reason: 'approval_required', latest: task, requiredBoundaries: missingBoundaries };
    }

    const waitingOn = this.#dependencies.listBlocking(task.id);
    if (waitingOn.length > 0) {
      const result = this.update(task, {
        status: 'waiting_dependency',
        approvedBoundaries: requiredBoundaries,
        blockedReason: null,
      }, input.expectedUpdatedAt);
      return result.ok ? { ...result, waitingOn } : result;
    }

    const nextStatus = canStart ? 'planning' : 'running';
    const result = this.update(task, {
      status: nextStatus,
      approvedBoundaries: requiredBoundaries,
      blockedReason: null,
    }, input.expectedUpdatedAt);
    if (!result.ok) return result;
    return this.enqueueUpdatedTask(task, result.task, {
      source: 'api',
      executionContext: { triggerKind: input.action === 'resume' ? 'retry' : 'user' },
    });
  }

  private enqueueUpdatedTask(
    previous: TaskAggregate,
    updated: TaskAggregate,
    options: EnqueueTaskOptions,
  ): TaskCommandResult {
    try {
      return {
        ok: true,
        task: updated,
        queued: this.enqueueTask(previous.id, options),
      };
    } catch (error) {
      this.#tasks.update(previous.id, {
        status: previous.status,
        approvedBoundaries: previous.execution.approvedBoundaries,
        blockedReason: previous.execution.blockedReason ?? null,
        expectedUpdatedAt: updated.updatedAt,
      });
      throw error;
    }
  }

  private update(
    current: TaskAggregate,
    patch: Parameters<TaskRepository['update']>[1],
    expectedUpdatedAt: number,
  ): TaskCommandResult {
    const updated = this.#tasks.update(current.id, { ...patch, expectedUpdatedAt });
    return updated
      ? { ok: true, task: updated }
      : { ok: false, reason: 'conflict', latest: this.#tasks.get(current.id) ?? current };
  }
}
