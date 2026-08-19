import {
  listExecutionReceipts,
  updateExecutionReceipt,
  type ExecutionReceipt,
} from '../storage/sqlite/execution-receipt-repository.js';
import {
  type EnqueueOutcomeOptions,
  type OutcomeQueueItem,
} from './outcome-queue.js';
import { createLogger } from '../utils/logger.js';
import { OutcomeExecutionStateRepository } from './outcome-execution-state.js';
import { OutcomeRepository } from './outcome-repository.js';

const log = createLogger('OutcomeController');

export interface OutcomeExecutionPort {
  enqueue(outcomeId: string, options: EnqueueOutcomeOptions): OutcomeQueueItem;
}

export type OutcomeRecoveryDecision =
  | { action: 'continue'; strategy: string }
  | { action: 'needs_user'; reason: string }
  | { action: 'stop'; reason: string };

export interface ProactiveContinuationInput {
  scopeRelation: 'same_outcome' | 'adjacent' | 'new_outcome';
  reversible: boolean;
  authorized: boolean;
  confidence: number;
}

export function decideProactiveContinuation(
  input: ProactiveContinuationInput,
): { action: 'auto_continue' } | { action: 'ask'; reason: string } {
  if (input.scopeRelation !== 'same_outcome') {
    return { action: 'ask', reason: 'The next action expands beyond the current outcome.' };
  }
  if (!input.authorized) {
    return { action: 'ask', reason: 'The next action requires an execution boundary the user has not approved.' };
  }
  if (!input.reversible) {
    return { action: 'ask', reason: 'The next action is not safely reversible.' };
  }
  if (input.confidence < 0.7) {
    return { action: 'ask', reason: 'The next action is not yet clear enough to run autonomously.' };
  }
  return { action: 'auto_continue' };
}

export function decideOutcomeRecovery(
  receipt: ExecutionReceipt,
  consecutiveNoGain: number,
): OutcomeRecoveryDecision {
  if (receipt.correctionText?.trim()) return { action: 'continue', strategy: 'apply_user_correction' };
  if (receipt.failure?.recoveryAction === 'request_user_input') {
    return {
      action: 'needs_user',
      reason: receipt.summary?.trim() || 'User approval or permission is required.',
    };
  }
  if (receipt.failure?.recoveryAction === 'none') {
    return { action: 'stop', reason: receipt.summary?.trim() || 'Execution cannot continue.' };
  }
  if (consecutiveNoGain >= 3) {
    return {
      action: 'needs_user',
      reason: 'Multiple changed approaches produced no new verified evidence. Provide the missing access or fact, revise the outcome, or choose to stop.',
    };
  }
  if (receipt.attempt >= 12) {
    return {
      action: 'needs_user',
      reason: 'The outcome remains incomplete after extensive execution and verification. Review the remaining criteria and choose whether to revise or continue.',
    };
  }
  if (consecutiveNoGain >= 2) return { action: 'continue', strategy: 'independent_research' };
  if (consecutiveNoGain >= 1) return { action: 'continue', strategy: 'strategy_reset' };
  if (receipt.failure?.recoveryAction === 'replan') {
    return { action: 'continue', strategy: `replan_${receipt.failure.phase}` };
  }
  if (receipt.failure?.recoveryAction === 'retry_with_changed_strategy') {
    return { action: 'continue', strategy: `recover_${receipt.failure.code}` };
  }
  if (receipt.attempt >= 3) return { action: 'continue', strategy: 'independent_research' };
  if (receipt.attempt >= 2) return { action: 'continue', strategy: 'changed_approach' };
  return { action: 'continue', strategy: 'close_verification_gaps' };
}

export function countConsecutiveNoGain(receipts: ExecutionReceipt[]): number {
  if (receipts.length < 2) return 0;
  const fingerprint = (receipt: ExecutionReceipt) => JSON.stringify({
    passedCriteria: receipt.verification.checks
      .filter((check) => check.status === 'passed')
      .map((check) => check.criterion)
      .sort(),
    verifiedEvidence: receipt.evidence
      .filter((evidence) => evidence.strength === 'verified')
      .map((evidence) => [
        evidence.kind,
        evidence.title,
        evidence.summary,
        evidence.uri ?? '',
        evidence.verifies?.slice().sort().join('|') ?? '',
      ].join(':'))
      .sort(),
  });
  const latest = fingerprint(receipts[0]!);
  let noGain = 0;
  for (const receipt of receipts.slice(1)) {
    if (fingerprint(receipt) !== latest) break;
    noGain += 1;
  }
  return noGain;
}

function continuationPrompt(receipt: ExecutionReceipt, strategy: string): string {
  if (receipt.correctionText?.trim()) {
    return [
      'The user corrected the result. Treat this correction as authoritative:',
      receipt.correctionText.trim(),
      'Re-open the affected work, discard any evidence invalidated by the correction, and verify the corrected result against every acceptance criterion.',
      'Do not report completion without fresh, checkable evidence.',
    ].join('\n');
  }
  const guidance: Record<string, string> = {
    apply_user_correction: 'Treat the user correction as authoritative. Re-check prior work, replace incorrect evidence, and verify the corrected result.',
    strategy_reset: 'The last attempts produced no new verified evidence. Stop repeating the same approach. Re-check assumptions, decompose the smallest verifiable milestone, and use different tools or sources.',
    independent_research: 'Use independent sources or a stronger verification path. Challenge prior assumptions and verify external state directly.',
    changed_approach: 'Change the approach rather than repeating the previous attempt. Inspect failures and choose different tools, sources, or execution steps.',
    close_verification_gaps: 'Make concrete progress and close the remaining verification gaps.',
  };
  const nextAction = receipt.nextAction?.trim();
  const missingCriteria = receipt.verification.checks
    .filter((check) => check.status !== 'passed')
    .map((check) => check.criterion);
  if (missingCriteria.length > 0) {
    return [
      'Continue working until the outcome is genuinely complete.',
      'Resolve these remaining acceptance criteria:',
      ...missingCriteria.map((criterion) => `- ${criterion}`),
      ...(nextAction ? [`Recommended next action: ${nextAction}`] : []),
      guidance[strategy] ?? 'Inspect the failure, change the approach, and produce fresh verification evidence.',
      'Do not report completion without fresh, checkable evidence.',
    ].join('\n');
  }
  return [
    'Continue working until the outcome is genuinely complete.',
    ...(nextAction ? [`Recommended next action: ${nextAction}`] : []),
    guidance[strategy] ?? 'Inspect the failure, change the approach, and produce fresh verification evidence.',
  ].join('\n');
}

export class OutcomeController {
  readonly #outcomes = new OutcomeRepository();
  readonly #executions = new OutcomeExecutionStateRepository();

  constructor(private readonly execution: OutcomeExecutionPort) {}

  handleCompletedRun(receipt: ExecutionReceipt): OutcomeQueueItem | undefined {
    const outcomeId = receipt.context.outcomeId;
    if (!outcomeId || receipt.status === 'running' || receipt.status === 'cancelled') return undefined;

    const outcome = this.#outcomes.get(outcomeId);
    if (!outcome || outcome.internalStatus === 'completed' || outcome.internalStatus === 'cancelled') {
      return undefined;
    }
    if (receipt.completionVerdict === 'achieved') return undefined;

    const execution = this.#executions.get(outcomeId);
    if (!execution) {
      this.#outcomes.updateState({ id: outcomeId, userStatus: 'needs_user', internalStatus: 'blocked' });
      log.warn({ outcomeId, runId: receipt.runId }, 'Outcome cannot continue because execution state is missing');
      return undefined;
    }
    if (receipt.needsUser) {
      const reason = receipt.nextAction?.trim() || receipt.summary?.trim() || 'User input is required.';
      this.#executions.update(outcomeId, { nextAction: reason, blockedReason: reason });
      this.#outcomes.updateState({ id: outcomeId, userStatus: 'needs_user', internalStatus: 'needs_user' });
      return undefined;
    }

    const recent = listExecutionReceipts({ outcomeId, limit: 4 });
    const recovery = decideOutcomeRecovery(receipt, countConsecutiveNoGain(recent));
    if (recovery.action !== 'continue') {
      this.#executions.update(outcomeId, {
        nextAction: recovery.reason,
        blockedReason: recovery.reason,
      });
      this.#outcomes.updateState({
        id: outcomeId,
        userStatus: 'needs_user',
        internalStatus: recovery.action === 'needs_user' ? 'needs_user' : 'blocked',
      });
      updateExecutionReceipt({
        runId: receipt.runId,
        nextAction: recovery.reason,
        needsUser: true,
      });
      return undefined;
    }
    const approved = new Set(execution.approvedBoundaries);
    const proactive = decideProactiveContinuation({
      scopeRelation: 'same_outcome',
      reversible: receipt.failure?.phase !== 'approval',
      authorized: receipt.failure?.phase !== 'approval'
        || (outcome.contract?.approvalRequired ?? []).every((item) => approved.has(item)),
      confidence: receipt.correctionText ? 1 : receipt.failure ? 0.85 : 0.8,
    });
    if (proactive.action === 'ask') {
      this.#executions.update(outcomeId, {
        nextAction: proactive.reason,
        blockedReason: proactive.reason,
      });
      this.#outcomes.updateState({ id: outcomeId, userStatus: 'needs_user', internalStatus: 'needs_user' });
      updateExecutionReceipt({ runId: receipt.runId, nextAction: proactive.reason, needsUser: true });
      return undefined;
    }
    const strategy = recovery.strategy;
    const prompt = continuationPrompt(receipt, strategy);
    this.#executions.update(outcomeId, { nextAction: prompt, blockedReason: null });
    this.#outcomes.updateState({ id: outcomeId, userStatus: 'running', internalStatus: 'continuing' });
    return this.execution.enqueue(outcomeId, {
      userTurn: { text: prompt },
      source: 'system',
      executionContext: {
        parentRunId: receipt.runId,
        contextTraceId: receipt.context.contextTraceId,
        workItemId: receipt.context.workItemId,
        triggerKind: 'retry',
        strategy,
      },
    });
  }
}
