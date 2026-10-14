import type {
  TaskAllocation,
  TaskAttentionItem,
  TaskDependencySummary,
  TaskOperationalState,
} from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

import { TaskAllocationRepository } from './task-allocation-repository.js';
import { TaskRepository, type TaskAggregate } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';
import { resolveTaskLocale } from './task-language.js';

export interface TaskReadModel {
  task: TaskAggregate;
  allocation?: TaskAllocation;
  operationalState: TaskOperationalState;
  attention: TaskAttentionItem[];
  allowedCommands: string[];
}

export class TaskReadModelProjector {
  readonly #tasks = new TaskRepository();
  readonly #runs = new TaskRunRepository();

  get(taskId: string): TaskReadModel | undefined {
    const task = this.#tasks.get(taskId);
    return task ? this.project(task) : undefined;
  }

  project(task: TaskAggregate, now = Date.now()): TaskReadModel {
    const activeRun = this.#runs.getActiveRoot(task.id);
    const latestRun = activeRun ?? this.#runs.getLatestRoot(task.id);
    const waits = this.#runs.listActiveWaits(task.id);
    const paused = waits.some((wait) => wait.kind === 'paused');
    const hasIncompleteDependency = Boolean(getSqliteDatabase().prepare(
      `SELECT 1 FROM task_dependencies edge
       JOIN tasks dependency ON dependency.task_id = edge.depends_on_task_id
       WHERE edge.task_id = ?
         AND NOT (dependency.phase = 'closed' AND dependency.resolution = 'done')
       LIMIT 1`,
    ).get(task.id));

    const allocation = new TaskAllocationRepository().summary(task.id);
    if (allocation && task.phase === 'closed' && allocation.status !== 'assigned') allocation.status = 'cancelled';
    const attention: TaskAttentionItem[] = [];
    if (allocation && ['blocked', 'failed'].includes(allocation.status)) attention.push({
      kind: allocation.status === 'failed' ? 'allocation_failed' : 'allocation_blocked',
      summary: allocation.selectionReason ?? allocation.reasonCode ?? 'Allocation needs attention', sourceId: allocation.id });
    for (const wait of waits) {
      const kind = wait.kind === 'approval'
        ? 'approval_required'
        : (wait.kind === 'user_input' || (wait.kind === 'external_event' && typeof wait.condition.collaborationEntryId === 'string'))
          ? 'input_required'
          : wait.kind === 'dependency'
            ? 'dependency_blocked'
            : undefined;
      if (kind) attention.push({ kind, summary: wait.reason, sourceId: wait.id });
    }
    if (latestRun?.status === 'failed') {
      const receipt = this.#runs.getReceipt(latestRun.id);
      attention.push({
        kind: receipt?.verification.status === 'failed' ? 'verification_failed' : 'run_failed',
        summary: latestRun.terminalMessage ?? receipt?.summary ?? (resolveTaskLocale(task) === 'zh' ? '最近一次执行失败' : 'The latest run failed'),
        sourceId: latestRun.id,
      });
    }
    if (task.dueAt !== undefined && task.phase !== 'closed' && task.dueAt < now) {
      attention.push({ kind: 'overdue', summary: resolveTaskLocale(task) === 'zh' ? '任务已逾期' : 'Task is overdue' });
    }

    const executionState = this.operationalState({
      task,
      activeRun,
      latestRun,
      waits,
      hasIncompleteDependency,
    });
    const allocating = allocation && ['pending', 'selecting'].includes(allocation.status);
    const allowedCommands = this.allowedCommands(task, activeRun?.status, waits.length > 0, paused)
      .filter(command => !(allocation && allocation.status !== 'assigned' && command === 'start'));
    if (allocation && ['blocked', 'failed'].includes(allocation.status) && task.phase !== 'closed' && !paused) {
      allowedCommands.push('retry_allocation');
    }
    const operationalState = task.phase !== 'closed' && !paused && !activeRun && waits.length === 0 && allocation
      ? allocating ? 'allocating' : allocation.status === 'blocked' ? 'blocked' : allocation.status === 'failed' ? 'failed' : executionState
      : executionState;
    return {
      task,
      allocation,
      operationalState,
      attention: task.phase === 'closed' || paused ? [] : attention,
      allowedCommands,
    };
  }

  summary(taskId: string): TaskDependencySummary | undefined {
    const model = this.get(taskId);
    if (!model) return undefined;
    return {
      id: model.task.id,
      title: model.task.title,
      phase: model.task.phase,
      ...(model.task.resolution ? { resolution: model.task.resolution } : {}),
      operationalState: model.operationalState,
    };
  }

  private operationalState(input: {
    task: TaskAggregate;
    activeRun: ReturnType<TaskRunRepository['getActiveRoot']>;
    latestRun: ReturnType<TaskRunRepository['getLatestRoot']>;
    waits: ReturnType<TaskRunRepository['listActiveWaits']>;
    hasIncompleteDependency: boolean;
  }): TaskOperationalState {
    if (input.task.phase === 'closed') return 'idle';
    if (input.waits.some((wait) => wait.kind === 'paused')) return 'waiting';
    if (input.activeRun?.status === 'running') return 'running';
    if (input.activeRun?.status === 'verifying') return 'verifying';
    if (input.activeRun?.status === 'queued') return 'queued';
    if (input.activeRun?.status === 'waiting') return 'waiting';
    if (input.waits.some((wait) => wait.kind !== 'dependency')) return 'waiting';
    if (input.waits.some((wait) => wait.kind === 'dependency')) return 'blocked';
    if (input.latestRun?.status === 'failed') return 'failed';
    if (input.latestRun?.status === 'cancelled') return 'cancelled';
    if (input.hasIncompleteDependency) return 'blocked';
    return 'idle';
  }

  private allowedCommands(
    task: TaskAggregate,
    activeRunStatus: NonNullable<ReturnType<TaskRunRepository['getActiveRoot']>>['status'] | undefined,
    hasWaits: boolean,
    paused: boolean,
  ): string[] {
    if (task.phase === 'closed') return ['reopen'];
    const commands = ['revise_contract', 'close'];
    if (!paused) commands.push('add_wait');
    if (!activeRunStatus && !hasWaits) commands.unshift('move');
    if (hasWaits) commands.unshift('resolve_wait');
    if (task.phase === 'backlog') commands.unshift('mark_ready');
    if (!activeRunStatus && !hasWaits && task.phase !== 'backlog') commands.unshift('start');
    if (task.phase === 'active' && !activeRunStatus && !hasWaits) commands.push('request_review');
    return commands;
  }
}
