import {
  listExecutionReceipts,
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

function nextStrategy(receipt: ExecutionReceipt, stalled: boolean): string {
  if (stalled) return 'strategy_reset';
  if (receipt.attempt >= 3) return 'independent_research';
  if (receipt.attempt >= 2) return 'changed_approach';
  return 'close_verification_gaps';
}

function continuationPrompt(receipt: ExecutionReceipt, strategy: string): string {
  if (receipt.correctionText?.trim()) return receipt.correctionText.trim();
  const guidance: Record<string, string> = {
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
      guidance[strategy],
      'Do not report completion without fresh, checkable evidence.',
    ].join('\n');
  }
  return [
    'Continue working until the outcome is genuinely complete.',
    ...(nextAction ? [`Recommended next action: ${nextAction}`] : []),
    guidance[strategy],
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
    if (receipt.completionVerdict === 'achieved' || receipt.needsUser) return undefined;

    const execution = this.#executions.get(outcomeId);
    if (!execution) {
      this.#outcomes.updateState({ id: outcomeId, userStatus: 'needs_user', internalStatus: 'blocked' });
      log.warn({ outcomeId, runId: receipt.runId }, 'Outcome cannot continue because execution state is missing');
      return undefined;
    }

    const recent = listExecutionReceipts({ outcomeId, limit: 3 });
    const evidenceFingerprints = recent.map((item) => item.evidence
      .filter((evidence) => evidence.strength === 'verified')
      .map((evidence) => `${evidence.kind}:${evidence.title}:${evidence.verifies?.join('|') ?? ''}`)
      .sort()
      .join('\n'));
    const stalled = evidenceFingerprints.length >= 2
      && evidenceFingerprints[0] === evidenceFingerprints[1];
    const strategy = nextStrategy(receipt, stalled);
    const prompt = continuationPrompt(receipt, strategy);
    this.#executions.update(outcomeId, { nextAction: prompt, blockedReason: null });
    this.#outcomes.updateState({ id: outcomeId, userStatus: 'running', internalStatus: 'continuing' });
    return this.execution.enqueue(outcomeId, {
      userTurn: { text: prompt, clientCreatedAtMs: Date.now() },
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
