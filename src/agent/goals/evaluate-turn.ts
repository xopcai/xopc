import type { PersistentGoalState } from './state.js';
import { judgeGoalHermesStyle } from './judge.js';

/** Hermes `CONTINUATION_PROMPT_TEMPLATE` (exact wording). */
export const CONTINUATION_PROMPT_TEMPLATE =
  '[Continuing toward your standing goal]\n' +
  'Goal: {goal}\n\n' +
  'Continue working toward this goal. Take the next concrete step. ' +
  'If you believe the goal is complete, state so explicitly and stop. ' +
  'If you are blocked and need input from the user, say so clearly and stop.';

export type GoalPostTurnDecision = {
  newState: PersistentGoalState | null;
  shouldContinue: boolean;
  continuationPrompt: string | null;
  verdict: 'done' | 'continue' | 'skipped' | 'inactive';
  reason: string;
  message: string;
};

function cloneState(s: PersistentGoalState): PersistentGoalState {
  return { ...s };
}

/**
 * Hermes `GoalManager.evaluate_after_turn` equivalent (minus SessionDB I/O).
 */
export async function evaluateAfterTurnHermesLike(
  state: PersistentGoalState,
  lastResponse: string,
  judgeModelRef: string,
  signal?: AbortSignal,
): Promise<GoalPostTurnDecision> {
  if (state.status !== 'active') {
    return {
      newState: state,
      shouldContinue: false,
      continuationPrompt: null,
      verdict: 'inactive',
      reason: 'no active goal',
      message: '',
    };
  }

  const next = cloneState(state);
  next.turnsUsed += 1;
  next.lastTurnAt = Date.now();

  const { verdict, reason } = await judgeGoalHermesStyle(state.goal, lastResponse, judgeModelRef, signal);
  next.lastVerdict = verdict === 'skipped' ? 'skipped' : verdict;
  next.lastReason = reason;

  if (verdict === 'done') {
    next.status = 'done';
    return {
      newState: next,
      shouldContinue: false,
      continuationPrompt: null,
      verdict: 'done',
      reason,
      message: `✓ Goal achieved: ${reason}`,
    };
  }

  if (next.turnsUsed >= next.maxTurns) {
    next.status = 'paused';
    next.pausedReason = `turn budget exhausted (${next.turnsUsed}/${next.maxTurns})`;
    return {
      newState: next,
      shouldContinue: false,
      continuationPrompt: null,
      verdict: 'continue',
      reason,
      message:
        `⏸ Goal paused — ${next.turnsUsed}/${next.maxTurns} turns used. ` +
        'Use /goal resume to keep going, or /goal clear to stop.',
    };
  }

  return {
    newState: next,
    shouldContinue: true,
    continuationPrompt: CONTINUATION_PROMPT_TEMPLATE.replace('{goal}', next.goal),
    verdict: 'continue',
    reason,
    message: `↻ Continuing toward goal (${next.turnsUsed}/${next.maxTurns}): ${reason}`,
  };
}
