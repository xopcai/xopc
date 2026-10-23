import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';
import type { TaskEvidence, TaskRunReceipt, TurnOutcome } from '@xopcai/gateway-contract';

import { AgentCatalogRepository } from '../agent-catalog/repository.js';

import type { ExecutionContext } from './execution-context.js';
import { personalRequestForTask } from '../personal-agent/request-repository.js';
import { TaskAllocationRepository } from './task-allocation-repository.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { TaskApplicationService } from './task-application-service.js';
import { TaskContextRepository } from './task-context-repository.js';
import { TaskCollaborationRepository } from './task-collaboration-repository.js';
import { TaskRepository } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';
import { TaskResultDeliveryRepository } from './task-result-delivery-repository.js';
import { currentTaskResearchResult, taskInstructionSequence } from './task-research-result.js';
import { buildResearchRepair, inspectTaskPublications } from './task-research-repair.js';
import { resolveTaskLocale } from './task-language.js';
import { loadTranscriptRowsForSession } from '../storage/sqlite/index.js';
import { ACCEPTANCE_REPAIR_READ_TOOLS, canResumeAfterModelFailure } from '../agent/orchestration/turn-recovery.js';
import { isTransientProviderErrorMessage } from '../providers/model-response.js';

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
    inputOrigin?: TurnOrigin;
    fallbackObjective: string;
    timeoutMs?: number;
  }): TaskRunCoordinator | undefined {
    if (!input.context.taskId) return undefined;
    const tasks = new TaskRepository();
    const task = tasks.get(input.context.taskId);
    if (!task || (task.phase === 'closed' && task.resolution !== 'done')) return undefined;
    const runs = new TaskRunRepository();
    if (runs.listActiveWaits(task.id).length > 0) return undefined;
    let run = runs.get(input.runId);
    if (run && (run.taskId !== task.id || run.parentRunId
      || (run.conversationId && run.conversationId !== input.context.conversationId))) return undefined;
    if (!run) {
      if (task.phase === 'closed') return undefined;
      if (runs.getActiveRoot(task.id)) return undefined;
      const agentId = task.delegateAgentId ?? input.context.agentId;
      if (!agentId) return undefined;
      run = runSqliteWriteTransaction(() => {
        if (tasks.require(task.id).version !== task.version) return undefined;
        const userInitiated = input.inputOrigin?.type === 'endpoint' || input.inputOrigin?.type === 'channel'
          || (input.inputOrigin?.type === 'system' && input.inputOrigin.source === 'cli');
        if (userInitiated) tasks.authorizeAutomaticPhase(task.id);
        else if (!tasks.automaticStartAllowed(task.id)) return undefined;
        const created = runs.create({
          id: input.runId,
          taskId: task.id,
          executorKind: 'agent',
          executorRef: { agentId },
          trigger: { kind: input.context.triggerKind },
          correlationId: input.runId,
          idempotencyKey: input.runId,
          contractVersion: task.latestContractVersion,
          conversationId: input.context.conversationId,
          retryPolicy: { maxAttempts: 3 },
        });
        if (task.phase !== 'active') {
          tasks.setLifecycle({ taskId: task.id, expectedVersion: task.version, phase: 'active', runId: created.id });
        }
        return created;
      });
      if (!run) return undefined;
    }
    const startingQueuedRun = run.status === 'queued';
    if (startingQueuedRun) {
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
        timeoutAt: Date.now() + (input.timeoutMs ?? 4 * 60 * 60 * 1000),
      }) ?? run;
    }
    if (startingQueuedRun && run.status === 'running' && new TaskAllocationRepository().get(task.id)) {
      const executorAgentId = typeof run.executorRef.agentId === 'string'
        ? run.executorRef.agentId : task.delegateAgentId ?? input.context.agentId;
      const zh = resolveTaskLocale(task) === 'zh';
      const executorName = executorAgentId ? new AgentCatalogRepository().get(executorAgentId)?.profile?.name?.trim() : undefined;
      runSqliteWriteTransaction(() => new TaskAllocationRepository().publish(task.id,
        zh ? `任务「${task.title}」由 ${executorName || '执行者'} 开始执行。`
          : `Task “${task.title}” started by ${executorName || 'the assigned executor'}.`));
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
    if (run.status === 'waiting' && run.policySnapshot.continuation) return;
    if (run.status === 'waiting' && this.#runs.listActiveWaits(run.taskId).length > 0) return;
    const hasAssistantResult = Boolean(input.assistantText?.trim() && input.assistantText.trim() !== 'NO_REPLY');
    const hasBoardResult = new TaskCollaborationRepository().recent(run.taskId, undefined, 20)
      .some((entry) => entry.taskRunId === run.id && entry.kind === 'result');
    const emptySuccess = input.status === 'succeeded' && !hasAssistantResult && !hasBoardResult
      && !this.#hasDeliverables && this.#evidence.length === 0;
    const task = new TaskRepository().require(run.taskId);
    const zh = resolveTaskLocale(task) === 'zh';
    const status = emptySuccess ? 'failed' : input.status;
    const recoveryOptions = { allowFailedReadTools: ACCEPTANCE_REPAIR_READ_TOOLS };
    const unconfirmedEffects = status === 'failed' && Boolean(run.conversationId
      && !canResumeAfterModelFailure(loadTranscriptRowsForSession(run.conversationId), recoveryOptions));
    const systemSummaries: Record<string, string> = { 'Message processed': '消息已处理', Interrupted: '执行已中断', 'Agent run ended unexpectedly': '助手执行意外结束' };
    const resultSummary = status === 'succeeded' && hasAssistantResult && /^Message processed(?: successfully)?$/.test(input.summary)
      ? input.assistantText!.trim() : input.summary;
    const summary = emptySuccess ? (zh ? '助手执行未返回结果或证据' : 'Agent run returned no result or evidence')
      : zh ? systemSummaries[resultSummary] ?? resultSummary : resultSummary;
    const research = currentTaskResearchResult(run.id);
    const currentResearch = research && research.contractVersion === task.latestContractVersion
      && research.instructionSequence === taskInstructionSequence(task.id) ? research : undefined;
    const publications = inspectTaskPublications(run.id, currentResearch);
    const repair = buildResearchRepair({ research: currentResearch, stale: Boolean(research && !currentResearch),
      instructionSequence: taskInstructionSequence(task.id), publications, criteria: task.contract?.acceptanceCriteria ?? [],
      requiresReview: !personalRequestForTask(task.id) && Boolean(task.body?.includes('publish_task_result')) });
    const repairBlocked = Boolean(repair && run.conversationId && !canResumeAfterModelFailure(loadTranscriptRowsForSession(run.conversationId),
      { allowFailedReadTools: ACCEPTANCE_REPAIR_READ_TOOLS }));
    if (status === 'failed' && isTransientProviderErrorMessage(input.summary) && !unconfirmedEffects
      && this.#runs.scheduleContinuation({ runId: run.id, expectedVersion: run.version, reason: 'model_failure',
        message: ['The previous model request failed transiently. Continue this same task from recorded completed operations; do not replay external effects.',
          ...(repair ? [repair.message] : ['Finish only the remaining work.'])].join('\n') })) return;
    if (status === 'succeeded' && repair && !repairBlocked && this.#runs.scheduleContinuation({ runId: run.id,
      expectedVersion: run.version, reason: 'acceptance_repair', repairFingerprint: repair.fingerprint, message: repair.message })) return;
    const researchEvidence: TaskEvidence[] = currentResearch?.claims.map(claim => ({ kind: 'source',
      title: `Research claim: ${claim.id}`, summary: claim.statement,
      uri: currentResearch.sources.find(source => claim.sourceIds.includes(source.id))?.url,
      provenance: 'judge', strength: claim.support === 'supported' ? 'verified' : 'observed', observedAt: Date.now(),
      verifies: currentResearch.checks.filter(check => check.status === 'passed' && check.claimIds.includes(claim.id)).map(check => check.criterion),
    })) ?? [];
    const checks = currentResearch?.checks.map(check => ({ criterion: check.criterion, status: check.status,
      evidenceTitles: check.claimIds.map(id => `Research claim: ${id}`), note: check.note,
      method: currentResearch.review === 'model_reviewed' ? 'model_reviewed' as const : 'unverified' as const }))
      ?? (task.contract?.acceptanceCriteria ?? []).map(criterion => ({ criterion, status: 'unverified' as const, evidenceTitles: [],
        method: 'unverified' as const, note: zh ? '未提交有证据关联的核验结果。' : 'No evidence-linked verification result was submitted.' }));
    const instructionChecks = (currentResearch?.instructionChecks ?? []).map(check => ({ criterion: check.instruction,
      status: check.status, evidenceTitles: check.claimIds.map(id => `Research claim: ${id}`), note: check.note, method: 'model_reviewed' as const }));
    const achieved = status === 'succeeded' && checks.length > 0 && checks.length === task.contract?.acceptanceCriteria.length
      && checks.every(check => check.status === 'passed') && !repair && currentResearch!.claims.every(claim => claim.support === 'supported');
    this.#application.completeRun({
      runId: run.id,
      expectedRunVersion: run.version,
      resultText: input.assistantText,
      receipt: {
        status,
        summary,
        changes: this.#evidence.filter((item) => item.kind === 'state'),
        evidence: [...this.#evidence, ...researchEvidence],
        verification: { status: achieved ? 'passed' : [...checks, ...instructionChecks].some(check => check.status === 'failed') ? 'failed' : 'unverified', checks: [...checks, ...instructionChecks] },
        remainingWork: repair ? repair.gaps : emptySuccess ? [task.contract?.objective ?? (zh ? '完成任务' : 'Complete the task')]
          : achieved ? [] : status === 'succeeded' ? currentResearch
            ? [...currentResearch.checks.filter(check => check.status !== 'passed').map(check => check.criterion),
              ...currentResearch.claims.filter(claim => claim.support !== 'supported').map(claim => claim.note ?? claim.statement)]
            : task.contract?.acceptanceCriteria ?? [] : [],
        needsUser: unconfirmedEffects || repairBlocked,
        ...(repairBlocked ? { nextAction: zh ? '先确认上次未确认操作的实际影响，再继续补查。' : 'Confirm the effects of the unconfirmed operation before repair.' } : {}),
        completionVerdict: achieved ? 'achieved' : status === 'succeeded' ? 'partial' : 'not_achieved',
        ...(status === 'failed' ? { failure: { code: unconfirmedEffects ? 'tool_outcome_unconfirmed' : emptySuccess ? 'empty_agent_run' : 'agent_run_failed', phase: 'execution',
          recoveryAction: unconfirmedEffects ? (zh ? '检查上次操作的实际影响后再恢复任务' : 'Confirm the previous operation effects before resuming')
            : zh ? '使用其他可用助手或模型重试任务' : 'Retry the task run with another available Agent or model' } } : {}),
      },
    });
  }
}
