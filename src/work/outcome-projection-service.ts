import {
  listUnprojectedExecutionReceipts,
  markExecutionReceiptProjected,
  type ExecutionReceipt,
} from '../storage/sqlite/index.js';
import { OutcomeRepository } from './outcome-repository.js';

export const EXECUTION_RECEIPT_PROJECTION_VERSION = 4;
const MAX_AUTONOMOUS_ATTEMPTS = 3;

function canRecoverAutonomously(outcome: ExecutionReceipt): boolean {
  return outcome.status === 'failed'
    && outcome.attempt < MAX_AUTONOMOUS_ATTEMPTS
    && outcome.failure?.recoveryAction !== 'request_user_input'
    && outcome.failure?.recoveryAction !== 'none';
}

export class OutcomeProjectionService {
  readonly #outcomes = new OutcomeRepository();

  project(outcome: ExecutionReceipt): ExecutionReceipt {
    if (outcome.status === 'running' || outcome.projectionVersion >= EXECUTION_RECEIPT_PROJECTION_VERSION) {
      return outcome;
    }
    const verdict = outcome.completionVerdict;
    const recovering = canRecoverAutonomously(outcome);

    if (outcome.context.outcomeId) {
      if (verdict === 'achieved') {
        this.#outcomes.updateState({
          id: outcome.context.outcomeId,
          userStatus: 'completed',
          internalStatus: 'completed',
          latestReceiptRunId: outcome.runId,
        });
      } else if (verdict === 'partial') {
        this.#outcomes.updateState({
          id: outcome.context.outcomeId,
          userStatus: outcome.needsUser ? 'needs_user' : 'running',
          internalStatus: outcome.needsUser ? 'needs_user' : 'continuing',
          latestReceiptRunId: outcome.runId,
        });
      } else if (verdict === 'not_achieved') {
        this.#outcomes.updateState({
          id: outcome.context.outcomeId,
          userStatus: outcome.status === 'cancelled' ? 'completed' : recovering ? 'running' : 'needs_user',
          internalStatus: outcome.status === 'cancelled' ? 'cancelled' : recovering ? 'continuing' : 'blocked',
          latestReceiptRunId: outcome.runId,
        });
      }
    }

    return markExecutionReceiptProjected({
      runId: outcome.runId,
      projectionVersion: EXECUTION_RECEIPT_PROJECTION_VERSION,
    }) ?? outcome;
  }

  reconcile(limit = 100): number {
    const pending = listUnprojectedExecutionReceipts({
      projectionVersion: EXECUTION_RECEIPT_PROJECTION_VERSION,
      limit,
    });
    for (const outcome of pending) this.project(outcome);
    return pending.length;
  }
}
