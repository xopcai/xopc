import { GoalService } from '../goals/index.js';
import {
  listUnprojectedTaskOutcomes,
  markTaskOutcomeProjected,
  type TaskOutcome,
} from '../storage/sqlite/index.js';
import { WorkItemService } from '../work-items/index.js';

export const TASK_OUTCOME_PROJECTION_VERSION = 1;

function remainingAction(outcome: TaskOutcome): string {
  if (outcome.correctionText) return outcome.correctionText;
  if (outcome.nextAction) return outcome.nextAction;
  if (outcome.failure?.recoveryAction === 'request_user_input') return 'Provide the missing approval or information.';
  if (outcome.failure?.recoveryAction === 'retry_with_changed_strategy') return 'Retry with a changed strategy.';
  if (outcome.failure?.recoveryAction === 'replan') return 'Revise the plan and address the failed verification.';
  return 'Review the outcome and decide the next concrete action.';
}

export class OutcomeProjectionService {
  readonly #goals = new GoalService();
  readonly #workItems = new WorkItemService();

  project(outcome: TaskOutcome): TaskOutcome {
    if (outcome.status === 'running' || outcome.projectionVersion >= TASK_OUTCOME_PROJECTION_VERSION) {
      return outcome;
    }
    const verdict = outcome.completionVerdict;
    const nextAction = remainingAction(outcome);

    if (outcome.context.workItemId) {
      if (verdict === 'achieved') {
        this.#workItems.updateWorkItem(outcome.context.workItemId, {
          status: 'done',
          nextAction: null,
          blockedReason: null,
        });
      } else if (verdict === 'partial') {
        this.#workItems.updateWorkItem(outcome.context.workItemId, {
          status: outcome.needsUser ? 'needs_input' : 'in_review',
          nextAction,
          blockedReason: outcome.needsUser ? outcome.summary ?? nextAction : null,
        });
      } else if (verdict === 'not_achieved') {
        this.#workItems.updateWorkItem(outcome.context.workItemId, {
          status: outcome.status === 'cancelled' ? 'cancelled' : 'blocked',
          nextAction,
          blockedReason: outcome.summary ?? nextAction,
        });
      }
    }

    if (outcome.context.goalId) {
      if (verdict === 'achieved') {
        this.#goals.update(outcome.context.goalId, { nextAction: undefined, blockedReason: undefined });
        this.#goals.setStatus(outcome.context.goalId, 'done');
      } else if (verdict === 'partial') {
        this.#goals.update(outcome.context.goalId, { nextAction, blockedReason: undefined });
        this.#goals.setStatus(
          outcome.context.goalId,
          outcome.needsUser ? 'needs_input' : 'active',
          outcome.needsUser ? { reason: outcome.summary ?? nextAction } : undefined,
        );
      } else if (verdict === 'not_achieved') {
        this.#goals.update(outcome.context.goalId, { nextAction });
        this.#goals.setStatus(
          outcome.context.goalId,
          outcome.status === 'cancelled' ? 'paused' : 'blocked',
          { reason: outcome.summary ?? nextAction },
        );
      }
    }

    return markTaskOutcomeProjected({
      runId: outcome.runId,
      projectionVersion: TASK_OUTCOME_PROJECTION_VERSION,
    }) ?? outcome;
  }

  reconcile(limit = 100): number {
    const pending = listUnprojectedTaskOutcomes({
      projectionVersion: TASK_OUTCOME_PROJECTION_VERSION,
      limit,
    });
    for (const outcome of pending) this.project(outcome);
    return pending.length;
  }
}
