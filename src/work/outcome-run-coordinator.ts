import { GoalService } from '../goals/index.js';
import {
  completeExecutionReceipt,
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

export class OutcomeRunCoordinator {
  readonly #evidence: ExecutionEvidence[] = [];
  readonly #goals = new GoalService();
  readonly #outcomes = new OutcomeRepository();
  readonly #projection = new OutcomeProjectionService();
  readonly #contextCompiler = new ContextCompiler();
  readonly #startedAt = Date.now();
  readonly contract?: ExecutionContract;

  private constructor(
    readonly runId: string,
    readonly context: ExecutionContext,
    fallbackObjective: string,
  ) {
    const outcome = context.outcomeId ? this.#outcomes.get(context.outcomeId) : undefined;
    const contract = outcome?.contract;
    this.contract = contract ? {
      objective: contract.objective,
      deliverables: contract.deliverables,
      acceptanceCriteria: contract.acceptanceCriteria,
      constraints: contract.constraints,
      approvalRequired: contract.approvalRequired,
    } : undefined;
    startExecutionReceipt({
      runId,
      sessionKey: context.sessionKey,
      channel: context.channel,
      objective: outcome?.objective ?? contract?.objective ?? fallbackObjective.trim(),
      context: executionReceiptContext(context),
      ...(this.contract ? { contract: this.contract } : {}),
      ...(contract ? { contractVersion: contract.version } : {}),
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
  }): OutcomeRunCoordinator {
    return new OutcomeRunCoordinator(input.runId, input.context, input.fallbackObjective);
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
      });
    }
  }

  capturePatch(added: number, removed: number): void {
    this.addEvidence({
      kind: 'state',
      title: 'Changes applied',
      summary: `${added} additions and ${removed} removals`,
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
    });
  }

  finalize(input: {
    status: Exclude<ExecutionReceiptStatus, 'running'>;
    summary: string;
  }): ExecutionReceipt | undefined {
    const goal = this.context.goalId ? this.#goals.get(this.context.goalId) : undefined;
    const contextSnapshot = this.#contextCompiler.latestForSession(this.context.sessionKey, this.#startedAt);
    if (contextSnapshot) {
      this.#contextCompiler.linkToRun({
        snapshotId: contextSnapshot.id,
        outcomeId: this.context.outcomeId,
        runId: this.runId,
      });
    }
    const criteria = new Set(this.contract?.acceptanceCriteria ?? []);
    for (const item of goal?.checklist ?? []) {
      if (item.status !== 'completed' || !criteria.has(item.text)) continue;
      this.addEvidence({
        kind: 'state',
        title: `Independently verified: ${item.text}`,
        summary: item.evidenceSummary ?? 'The goal judge marked this acceptance criterion complete.',
        verifies: [item.text],
      });
    }
    if (this.context.outcomeId) {
      this.#outcomes.updateState({
        id: this.context.outcomeId,
        userStatus: goal?.status === 'needs_input' ? 'needs_user' : 'running',
        internalStatus: goal?.status === 'needs_input' ? 'needs_user' : 'verifying',
      });
    }
    updateExecutionReceipt({
      runId: this.runId,
      ...(this.contract ? { contract: this.contract } : {}),
      evidence: this.#evidence,
      nextAction: goal?.nextAction ?? null,
      needsUser: goal?.status === 'needs_input',
      contextTraceId: contextSnapshot?.id ?? this.context.contextTraceId ?? null,
    });
    const outcome = completeExecutionReceipt({
      runId: this.runId,
      status: input.status,
      summary: input.summary,
    });
    return outcome ? this.#projection.project(outcome) : undefined;
  }
}
