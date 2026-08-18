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
import { OutcomeProjectionService } from './outcome-projection-service.js';
import { OutcomeRepository } from './outcome-repository.js';
import { ContextCompiler } from '../user-context/context-compiler.js';
import { recordOutcomeContextFeedback } from './outcome-context-feedback.js';

export class OutcomeRunCoordinator {
  readonly #evidence: ExecutionEvidence[] = [];
  readonly #outcomes = new OutcomeRepository();
  readonly #projection = new OutcomeProjectionService();
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
    const outcome = context.outcomeId ? this.#outcomes.get(context.outcomeId) : undefined;
    const contract = outcome?.contract;
    this.contract = contract ? {
      objective: contract.objective,
      deliverables: contract.deliverables,
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
      objective: outcome?.objective ?? contract?.objective ?? fallbackObjective.trim(),
      context: executionReceiptContext(context),
      ...(this.contract ? { contract: this.contract } : {}),
      ...(contract ? { contractVersion: contract.version } : {}),
      ...(context.strategy ? { strategy: context.strategy } : {}),
    });
    if (outcome) {
      this.#outcomes.updateState({
        id: outcome.id,
        userStatus: 'running',
        internalStatus: 'running',
      });
    }
  }

  static start(input: {
    runId: string;
    context: ExecutionContext;
    fallbackObjective: string;
    onFinalized?: (receipt: ExecutionReceipt) => void;
  }): OutcomeRunCoordinator {
    return new OutcomeRunCoordinator(
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
        outcomeId: this.context.outcomeId,
        runId: this.runId,
      });
    }
    for (const evidence of judgedReceipt?.evidence ?? []) {
      this.addEvidence(evidence);
    }
    if (this.context.outcomeId) {
      this.#outcomes.updateState({
        id: this.context.outcomeId,
        userStatus: judgedReceipt?.needsUser ? 'needs_user' : 'running',
        internalStatus: judgedReceipt?.needsUser ? 'needs_user' : 'verifying',
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
    const outcome = completeExecutionReceipt({
      runId: this.runId,
      status: input.status,
      summary: input.summary,
    });
    if (!outcome) return undefined;
    const projected = this.#projection.project(outcome);
    recordOutcomeContextFeedback(projected);
    this.#onFinalized?.(projected);
    return projected;
  }
}
