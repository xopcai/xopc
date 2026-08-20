import type {
  TaskAttentionItem,
  TaskDependencySummary,
  TaskOperationalState,
} from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

import { TaskRepository, type TaskAggregate } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';

export interface TaskReadModel {
  task: TaskAggregate;
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
    const hasIncompleteDependency = Boolean(getSqliteDatabase().prepare(
      `SELECT 1 FROM task_dependencies edge
       JOIN tasks dependency ON dependency.task_id = edge.depends_on_task_id
       WHERE edge.task_id = ?
         AND NOT (dependency.phase = 'closed' AND dependency.resolution = 'done')
       LIMIT 1`,
    ).get(task.id));

    const attention: TaskAttentionItem[] = [];
    for (const wait of waits) {
      const kind = wait.kind === 'approval'
        ? 'approval_required'
        : wait.kind === 'user_input'
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
        summary: latestRun.terminalMessage ?? receipt?.summary ?? 'The latest run failed',
        sourceId: latestRun.id,
      });
    }
    if (task.dueAt !== undefined && task.phase !== 'closed' && task.dueAt < now) {
      attention.push({ kind: 'overdue', summary: 'Task is overdue' });
    }

    const operationalState = this.operationalState({
      task,
      activeRun,
      latestRun,
      waits,
      hasIncompleteDependency,
    });
    return {
      task,
      operationalState,
      attention,
      allowedCommands: this.allowedCommands(task, activeRun?.status, waits.length > 0),
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
    if (input.activeRun?.status === 'running') return 'running';
    if (input.activeRun?.status === 'verifying') return 'verifying';
    if (input.activeRun?.status === 'queued') return 'queued';
    if (input.waits.some((wait) => wait.kind !== 'dependency')) return 'waiting';
    if (input.waits.some((wait) => wait.kind === 'dependency')) return 'blocked';
    if (input.latestRun?.status === 'failed') return 'blocked';
    if (input.hasIncompleteDependency) return 'blocked';
    return 'idle';
  }

  private allowedCommands(
    task: TaskAggregate,
    activeRunStatus: NonNullable<ReturnType<TaskRunRepository['getActiveRoot']>>['status'] | undefined,
    hasWaits: boolean,
  ): string[] {
    if (task.phase === 'closed') return ['reopen'];
    const commands = ['revise_contract', 'delegate', 'close'];
    if (hasWaits) commands.unshift('resolve_wait');
    else if (activeRunStatus === 'running' || activeRunStatus === 'verifying') commands.unshift('add_wait');
    if (task.phase === 'backlog') commands.unshift('mark_ready');
    if (!activeRunStatus && !hasWaits && task.phase !== 'backlog') commands.unshift('start');
    if (task.phase === 'active') commands.push('request_review');
    return commands;
  }
}
