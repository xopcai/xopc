import type { TaskEvidence, TaskRunReceipt, TurnOutcome } from '@xopcai/gateway-contract';

import type { ExecutionContext } from './execution-context.js';
import { TaskApplicationService } from './task-application-service.js';
import { TaskContextRepository } from './task-context-repository.js';
import { TaskCollaborationRepository } from './task-collaboration-repository.js';
import { TaskRepository } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';
import { TaskResultDeliveryRepository } from './task-result-delivery-repository.js';
import { resolveTaskLocale } from './task-language.js';

export class TaskRunCoordinator {
  readonly #evidence: TaskEvidence[] = [];
  readonly #application = new TaskApplicationService();
  readonly #runs = new TaskRunRepository();
  #hasDeliverables = false;

  readonly #zh: boolean;

  private constructor(readonly runId: string) {
    const run = this.#runs.require(runId);
    this.#zh = resolveTaskLocale(new TaskRepository().require(run.taskId)) === 'zh';
  }

  static start(input: {
    runId: string;
    context: ExecutionContext;
    fallbackObjective: string;
  }): TaskRunCoordinator | undefined {
    if (!input.context.taskId) return undefined;
    const tasks = new TaskRepository();
    const task = tasks.get(input.context.taskId);
    if (!task || task.phase === 'closed') return undefined;
    const runs = new TaskRunRepository();
    if (runs.listActiveWaits(task.id).length > 0) return undefined;
    let run = runs.get(input.runId);
    if (run && (run.taskId !== task.id || run.parentRunId
      || (run.conversationId && run.conversationId !== input.context.conversationId))) return undefined;
    if (!run) {
      if (runs.getActiveRoot(task.id)) return undefined;
      const agentId = task.delegateAgentId ?? input.context.agentId;
      if (!agentId) return undefined;
      run = runs.create({
        id: input.runId,
        taskId: task.id,
        executorKind: 'agent',
        executorRef: { agentId },
        trigger: { kind: input.context.triggerKind },
        correlationId: input.runId,
        idempotencyKey: input.runId,
        contractVersion: task.latestContractVersion,
        conversationId: input.context.conversationId,
      });
      if (task.phase !== 'active') {
        tasks.setLifecycle({ taskId: task.id, expectedVersion: task.version, phase: 'active' });
      }
    }
    if (run.status === 'queued') {
      const context = new TaskContextRepository();
      const snapshot = context.captureSnapshot({
        ownerKind: 'task_run',
        ownerId: run.id,
        conversationId: input.context.conversationId,
        query: task.contract?.objective ?? input.fallbackObjective,
        selectedItems: context.list(task.id),
        authorizationSnapshot: { grants: context.listActiveGrants(task.id) },
      });
      run = runs.start({
        runId: run.id,
        expectedVersion: run.version,
        contextSnapshotId: snapshot.id,
        policySnapshot: { executorKind: 'agent' },
        conversationId: input.context.conversationId,
      }) ?? run;
    }
    return run.status === 'running' ? new TaskRunCoordinator(run.id) : undefined;
  }

  addEvidence(evidence: TaskEvidence): void {
    if (this.#evidence.some((item) => item.kind === evidence.kind && item.title === evidence.title)) return;
    this.#evidence.push(evidence);
  }

  capturePlan(items: Array<{ title: string; status: string }>): void {
    for (const item of items) {
      if (item.status !== 'completed') continue;
      this.addEvidence({ kind: 'state', title: this.#zh ? `计划项已完成：${item.title}` : `Plan item completed: ${item.title}`,
        summary: this.#zh ? '助手已完成此计划项。' : 'The agent completed this plan item.', provenance: 'tool', strength: 'observed', observedAt: Date.now() });
    }
  }

  captureOutcome(outcome: TurnOutcome): void {
    new TaskResultDeliveryRepository().capture(this.runId, outcome);
    this.#hasDeliverables ||= outcome.deliverables.some(item => item.availability === 'available');
    for (const item of outcome.evidence) {
      if (item.kind !== 'check') continue;
      this.addEvidence({ kind: 'test', title: item.label,
        summary: this.#zh ? `最终工作区检查：${({ passed: '通过', failed: '失败', warning: '警告' })[item.status]}` : `Final workspace check: ${item.status}`,
        provenance: 'tool', strength: item.status === 'passed' ? 'verified' : 'observed', observedAt: Date.now() });
    }
  }

  capturePatch(added: number, removed: number): void {
    this.addEvidence({ kind: 'state', title: this.#zh ? '已应用变更' : 'Changes applied', summary: this.#zh ? `新增 ${added} 处，删除 ${removed} 处` : `${added} additions and ${removed} removals`,
      provenance: 'tool', strength: 'observed', observedAt: Date.now() });
  }

  finalize(input: { status: TaskRunReceipt['status']; summary: string; assistantText?: string }): void {
    const run = this.#runs.get(this.runId);
    if (!run || !['running', 'waiting', 'verifying'].includes(run.status)) return;
    if (run.status === 'waiting' && this.#runs.listActiveWaits(run.taskId).length > 0) return;
    const hasAssistantResult = Boolean(input.assistantText?.trim() && input.assistantText.trim() !== 'NO_REPLY');
    const hasBoardResult = new TaskCollaborationRepository().recent(run.taskId, undefined, 20)
      .some((entry) => entry.taskRunId === run.id && entry.kind === 'result');
    const emptySuccess = input.status === 'succeeded' && !hasAssistantResult && !hasBoardResult
      && !this.#hasDeliverables && this.#evidence.length === 0;
    const task = new TaskRepository().require(run.taskId);
    const zh = resolveTaskLocale(task) === 'zh';
    const status = emptySuccess ? 'failed' : input.status;
    const systemSummaries: Record<string, string> = { 'Message processed': '消息已处理', Interrupted: '执行已中断', 'Agent run ended unexpectedly': '助手执行意外结束' };
    const summary = emptySuccess ? (zh ? '助手执行未返回结果或证据' : 'Agent run returned no result or evidence')
      : zh ? systemSummaries[input.summary] ?? input.summary : input.summary;
    this.#application.completeRun({
      runId: run.id,
      expectedRunVersion: run.version,
      resultText: input.assistantText,
      receipt: {
        status,
        summary,
        changes: this.#evidence.filter((item) => item.kind === 'state'),
        evidence: this.#evidence,
        verification: { status: 'unverified', checks: [] },
        remainingWork: emptySuccess ? [task.contract?.objective ?? (zh ? '完成任务' : 'Complete the task')] : [],
        needsUser: false,
        completionVerdict: status === 'succeeded' ? 'partial' : 'not_achieved',
        ...(status === 'failed' ? { failure: { code: emptySuccess ? 'empty_agent_run' : 'agent_run_failed', phase: 'execution', recoveryAction: zh ? '使用其他可用助手或模型重试任务' : 'Retry the task run with another available Agent or model' } } : {}),
      },
    });
  }
}
