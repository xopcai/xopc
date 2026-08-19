import {
  completeExecutionReceipt,
  getExecutionReceipt,
  startExecutionReceipt,
  updateExecutionReceipt,
  type ExecutionContract,
  type ExecutionEvidence,
  type ExecutionReceipt,
  type ExecutionReceiptStatus,
} from '../storage/sqlite/index.js';
import type { ExecutionContext } from './execution-context.js';
import { executionReceiptContext } from './execution-context.js';
import { TaskProjectionService } from './task-projection-service.js';
import { TaskRepository } from './task-repository.js';
import { ContextCompiler } from '../user-context/context-compiler.js';
import { recordTaskContextFeedback } from './task-context-feedback.js';

export class TaskRunCoordinator {
  readonly #evidence: ExecutionEvidence[] = [];
  readonly #tasks = new TaskRepository();
  readonly #projection = new TaskProjectionService();
  readonly #contextCompiler = new ContextCompiler();
  readonly #startedAt = Date.now();
  readonly #onFinalized?: (receipt: ExecutionReceipt) => void;
  readonly contract?: ExecutionContract;

  private constructor(
    readonly runId: string,
    readonly context: ExecutionContext,
    fallbackObjective: string,
    onFinalized?: (receipt: ExecutionReceipt) => void,
  ) {
    const task = context.taskId ? this.#tasks.get(context.taskId) : undefined;
    const contract = task?.contract;
    this.contract = contract ? {
      objective: contract.objective,
      expectedOutputs: contract.expectedOutputs,
      acceptanceCriteria: contract.acceptanceCriteria,
      constraints: contract.constraints,
      approvalRequired: contract.approvalRequired,
      assumptions: contract.assumptions,
      risks: contract.risks,
    } : undefined;
    this.#onFinalized = onFinalized;
    startExecutionReceipt({
      runId,
      sessionKey: context.sessionKey,
      channel: context.channel,
      objective: task?.objective ?? contract?.objective ?? fallbackObjective.trim(),
      context: executionReceiptContext(context),
      ...(this.contract ? { contract: this.contract } : {}),
      ...(contract ? { contractVersion: contract.version } : {}),
      ...(context.strategy ? { strategy: context.strategy } : {}),
    });
    if (task) {
      this.#tasks.update(task.id, {
        status: 'running',
      });
    }
  }

  static start(input: {
    runId: string;
    context: ExecutionContext;
    fallbackObjective: string;
    onFinalized?: (receipt: ExecutionReceipt) => void;
  }): TaskRunCoordinator {
    return new TaskRunCoordinator(
      input.runId,
      input.context,
      input.fallbackObjective,
      input.onFinalized,
    );
  }

  addEvidence(evidence: ExecutionEvidence): void {
    if (this.#evidence.some((item) => item.kind === evidence.kind && item.title === evidence.title)) return;
    this.#evidence.push(evidence);
  }

  capturePlan(items: Array<{ title: string; status: string }>): void {
    for (const item of items) {
      if (item.status !== 'completed') continue;
      this.addEvidence({
        kind: 'state',
        title: `Plan item completed: ${item.title}`,
        summary: 'The execution agent marked this plan item as completed.',
        provenance: 'tool',
        strength: 'observed',
        observedAt: Date.now(),
      });
    }
  }

  capturePatch(added: number, removed: number): void {
    this.addEvidence({
      kind: 'state',
      title: 'Changes applied',
      summary: `${added} additions and ${removed} removals`,
      provenance: 'tool',
      strength: 'observed',
      observedAt: Date.now(),
    });
  }

  captureCommand(command: string, durationMs?: number): void {
    if (!/(^|\s)(test|vitest|jest|pytest|lint|typecheck|build)(\s|$|:)/i.test(command)) return;
    this.addEvidence({
      kind: 'test',
      title: command.slice(0, 120),
      summary: durationMs === undefined
        ? 'Command completed successfully'
        : `Command completed successfully in ${durationMs} ms`,
      provenance: 'tool',
      strength: 'verified',
      observedAt: Date.now(),
    });
  }

  finalize(input: {
    status: Exclude<ExecutionReceiptStatus, 'running'>;
    summary: string;
  }): ExecutionReceipt | undefined {
    const judgedReceipt = getExecutionReceipt(this.runId);
    const contextSnapshot = this.#contextCompiler.latestForSession(this.context.sessionKey, this.#startedAt);
    if (contextSnapshot) {
      this.#contextCompiler.linkToRun({
        snapshotId: contextSnapshot.id,
        taskId: this.context.taskId,
        runId: this.runId,
      });
    }
    for (const evidence of judgedReceipt?.evidence ?? []) {
      this.addEvidence(evidence);
    }
    if (this.context.taskId) {
      this.#tasks.update(this.context.taskId, {
        status: judgedReceipt?.needsUser ? 'needs_user' : 'verifying',
      });
    }
    updateExecutionReceipt({
      runId: this.runId,
      ...(this.contract ? { contract: this.contract } : {}),
      evidence: this.#evidence,
      nextAction: judgedReceipt?.nextAction ?? null,
      needsUser: judgedReceipt?.needsUser ?? false,
      contextTraceId: contextSnapshot?.id ?? this.context.contextTraceId ?? null,
    });
    const task = completeExecutionReceipt({
      runId: this.runId,
      status: input.status,
      summary: input.summary,
    });
    if (!task) return undefined;
    const projected = this.#projection.project(task);
    recordTaskContextFeedback(projected);
    this.#onFinalized?.(projected);
    return projected;
  }
}
