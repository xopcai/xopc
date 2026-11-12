import type {
  TaskAllocation,
  TaskAttentionItem,
  TaskDependencySummary,
  TaskOperationalState,
  TaskPresentation,
  TaskAcceptanceTarget,
} from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

import { TaskAllocationRepository } from './task-allocation-repository.js';
import { TaskRepository, type TaskAggregate } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';
import { resolveTaskLocale } from './task-language.js';
import { TaskCriterionReviewRepository } from './task-criterion-review-repository.js';
import { taskInstructionSequence } from './task-instruction-sequence.js';

export interface TaskReadModel {
  task: TaskAggregate;
  allocation?: TaskAllocation;
  operationalState: TaskOperationalState;
  presentation: TaskPresentation;
  acceptanceTarget?: TaskAcceptanceTarget;
  attention: TaskAttentionItem[];
  allowedCommands: string[];
  revisionBaseline?: { resultId: string; baselineVersion: string; resultRevision: number; expectedVersion: number };
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
      if (wait.kind === 'external_event' && wait.condition.type === 'run_decision') {
        attention.push({ kind: 'run_decision_required', summary: wait.reason, sourceId: wait.taskRunId });
        continue;
      }
      const kind = wait.kind === 'approval'
        ? 'approval_required'
        : (wait.kind === 'user_input' || (wait.kind === 'external_event' && typeof wait.condition.collaborationEntryId === 'string'))
          ? 'input_required'
          : wait.kind === 'dependency'
            ? 'dependency_blocked'
            : undefined;
      if (kind) attention.push({ kind, summary: wait.reason, sourceId: wait.id });
    }
    if (!attention.some(item => item.kind === 'run_decision_required')
      && latestRun?.status === 'failed' && latestRun.contractVersion === task.latestContractVersion) {
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
    const hasResolvableWait = waits.some(wait => wait.condition.type !== 'connection' && wait.condition.type !== 'run_decision');
    const allowedCommands = this.allowedCommands(task, activeRun?.status, waits.length > 0, hasResolvableWait, paused)
      .filter(command => !(allocation && allocation.status !== 'assigned' && command === 'start'))
      .filter(command => command !== 'start' || !hasIncompleteDependency)
      .filter(command => command!=='start' || !getSqliteDatabase().prepare('SELECT 1 FROM home_followups WHERE root_task_id=?').get(task.id));
    if (allocation && ['blocked', 'failed'].includes(allocation.status) && task.phase !== 'closed' && !activeRun && !waits.length) {
      allowedCommands.push('retry_allocation');
    }
    const resultRow = getSqliteDatabase().prepare(`SELECT payload_json FROM task_result_deliveries WHERE task_run_id IN
      (SELECT run_id FROM task_runs WHERE task_id = ?) AND status IN ('pending','delivered','stale') ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .get(task.id) as { payload_json: string } | undefined;
    const result = resultRow ? JSON.parse(resultRow.payload_json) : undefined;
    const revisionBaseline = result ? { resultId: String(result.deliveryId), baselineVersion: `${result.taskRunId}:${result.assignmentEpoch}:${result.outcome.outcomeId}`,
      resultRevision: Number(result.resultRevision ?? 1), expectedVersion: task.version } : undefined;
    if (revisionBaseline && !activeRun && !waits.length && ['closed', 'review'].includes(task.phase) && (!task.resolution || task.resolution === 'done')
      && !getSqliteDatabase().prepare('SELECT 1 FROM personal_requests WHERE task_id = ?').get(task.id)) allowedCommands.push('revise');
    const operationalState = task.phase !== 'closed' && !paused && !activeRun && waits.length === 0 && allocation
      ? allocating ? 'allocating' : allocation.status === 'blocked' ? 'blocked' : allocation.status === 'failed' ? 'failed' : executionState
      : executionState;
    const reviews = new TaskCriterionReviewRepository();
    const target = reviews.target(task);
    const workspaceBlocked = task.phase === 'review' && !reviews.workspaceVerified(task, target);
    const acceptanceTarget = target ? { id: target.id, ...(target.runId ? { runId: target.runId } : {}),
      canSignOff: !waits.length && !workspaceBlocked && reviews.canSignOff(task, target) } : undefined;
    return {
      task,
      allocation,
      operationalState,
      presentation: this.presentation(task, operationalState, waits, attention, allowedCommands, latestRun, workspaceBlocked, acceptanceTarget),
      acceptanceTarget,
      attention: (task.phase === 'closed' && (task.resolution !== 'done' || waits.length === 0)) || paused ? [] : attention,
      allowedCommands,
      ...(revisionBaseline ? { revisionBaseline } : {}),
    };
  }

  private presentation(task: TaskAggregate, state: TaskOperationalState, waits: ReturnType<TaskRunRepository['listActiveWaits']>,
    attention: TaskAttentionItem[], commands: string[], latestRun: ReturnType<TaskRunRepository['getLatestRoot']>, workspaceBlocked: boolean,
    acceptance?: TaskAcceptanceTarget): TaskPresentation {
    if (task.phase === 'closed') {
      return { status: task.resolution === 'done' ? 'completed' : 'ended', primaryAction: { type: 'view_results' } };
    }
    const pause = waits.find(wait => wait.kind === 'paused');
    if (pause) return { status: 'paused', reason: pause.reason, primaryAction: { type: 'resume', waitId: pause.id } };
    const pending = attention.find(item => item.kind === 'input_required' || item.kind === 'approval_required');
    if (pending?.sourceId) return { status: 'needsUser', reason: pending.summary, primaryAction: { type: 'resolve_wait', waitId: pending.sourceId } };
    const decision = attention.find(item => item.kind === 'run_decision_required');
    if (decision?.sourceId) return { status: 'needsUser', reason: decision.summary, primaryAction: { type: 'inspect_run', runId: decision.sourceId } };
    if (state === 'failed') {
      const failure = attention.find(item => item.kind === 'run_failed' || item.kind === 'verification_failed');
      const canRetryExecutor = latestRun?.executorKind === 'agent' && typeof latestRun.executorRef.agentId === 'string';
      if (failure?.sourceId) return { status: 'failed', reason: failure.summary,
        primaryAction: { type: commands.includes('start') && canRetryExecutor ? 'retry_run' : 'inspect_run', runId: failure.sourceId } };
    }
    if (commands.includes('retry_allocation')) return { status: state === 'failed' ? 'failed' : 'blocked',
      reason: attention.find(item => item.kind === 'allocation_failed' || item.kind === 'allocation_blocked')?.summary,
      primaryAction: { type: 'retry_allocation' } };
    if (state !== 'idle') return { status: state, reason: waits[0]?.reason };
    if (task.phase === 'review') {
      if (workspaceBlocked) return { status: 'blocked', reason: resolveTaskLocale(task) === 'zh'
        ? '尚未确认成果已写入指定工作区。' : 'The file has not been verified in the requested workspace.',
        ...(latestRun ? { primaryAction: { type: 'inspect_run', runId: latestRun.id } } : {}) };
      if (!acceptance && latestRun?.status === 'succeeded'
        && taskInstructionSequence(task.id) !== (latestRun.instructionSequenceAtStart ?? 0)) {
        return { status: 'blocked', reason: resolveTaskLocale(task) === 'zh'
          ? '尚未核验补充指令是否已落实。' : 'Adoption of supplemental directions still needs verification.',
        primaryAction: { type: 'inspect_run', runId: latestRun.id } };
      }
      if (!acceptance) return { status: 'blocked', reason: resolveTaskLocale(task) === 'zh'
        ? '当前成果版本需要重新核验。' : 'Verify the current result again.' };
      return { status: 'review', primaryAction: acceptance.canSignOff ? { type: 'signoff', resultId: acceptance.id } : { type: 'review' } };
    }
    if (commands.includes('mark_ready')) return { status: 'captured', primaryAction: { type: 'mark_ready' } };
    return { status: 'ready', primaryAction: commands.includes('start') ? { type: 'start' } : undefined };
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
    if (input.task.phase === 'closed' && (input.task.resolution !== 'done'
      || (!input.activeRun && input.waits.length === 0))) return 'idle';
    if (input.waits.some((wait) => wait.kind === 'paused')) return 'waiting';
    if (input.activeRun?.status === 'running') return 'running';
    if (input.activeRun?.status === 'verifying') return 'verifying';
    if (input.activeRun?.status === 'queued') return 'queued';
    if (input.activeRun?.status === 'waiting') return 'waiting';
    if (input.waits.some((wait) => wait.kind !== 'dependency')) return 'waiting';
    if (input.waits.some((wait) => wait.kind === 'dependency')) return 'blocked';
    if (input.latestRun?.contractVersion === input.task.latestContractVersion && input.latestRun.status === 'failed') return 'failed';
    if (input.latestRun?.contractVersion === input.task.latestContractVersion && input.latestRun.status === 'cancelled') return 'cancelled';
    if (input.hasIncompleteDependency) return 'blocked';
    return 'idle';
  }

  private allowedCommands(
    task: TaskAggregate,
    activeRunStatus: NonNullable<ReturnType<TaskRunRepository['getActiveRoot']>>['status'] | undefined,
    hasWaits: boolean,
    hasResolvableWait: boolean,
    paused: boolean,
  ): string[] {
    if (task.phase === 'closed') return ['move', 'reopen', ...(activeRunStatus ? ['close'] : []),
      ...(task.resolution === 'done' && hasResolvableWait ? ['resolve_wait'] : [])];
    const commands = ['move', 'revise_contract', 'close'];
    if (!paused) commands.push('add_wait');
    if (hasResolvableWait) commands.unshift('resolve_wait');
    if (task.phase === 'backlog') commands.unshift('mark_ready');
    if (!activeRunStatus && !hasWaits && task.phase !== 'backlog') commands.unshift('start');
    if (task.phase === 'active' && !activeRunStatus && !hasWaits) commands.push('request_review');
    return commands;
  }
}
