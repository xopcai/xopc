import type { PersistentGoalStatus } from './state.js';

/** Matches {@link GoalPostTurnDecision} `verdict` for persisted runs. */
export type GoalRunVerdict = 'done' | 'continue' | 'skipped' | 'inactive' | 'decompose';

export const GOAL_RUN_FILE_VERSION = 1 as const;

export interface GoalRunChecklistProgress {
  done: number;
  total: number;
}

/** One persisted evaluation after an assistant turn (Hermes post-turn). */
export interface GoalRunRecord {
  id: string;
  at: number;
  goalTitle: string;
  turnsUsed: number;
  maxTurns: number;
  verdict: GoalRunVerdict;
  statusAfter: PersistentGoalStatus;
  reason?: string;
  willContinue: boolean;
  checklistProgress?: GoalRunChecklistProgress;
  /** Truncated assistant visible text for this turn (context, not full transcript). */
  assistantPreview?: string;
}

export interface GoalRunFileV1 {
  version: typeof GOAL_RUN_FILE_VERSION;
  sessionKey: string;
  runs: GoalRunRecord[];
}
