import type { GoalsConfig } from '../../config/schema.js';

import { decomposeGoalChecklist, evaluateGoalChecklistJudge } from './checklist-judge.js';
import { allChecklistTerminal, checklistCounts, CHECKLIST_ITEM_PENDING } from './checklist-types.js';
import { judgeGoalHermesStyle } from './judge.js';
import {
  applyJudgeChecklistUpdates,
  renderChecklistPlain,
  renderChecklistNumbered,
  type PersistentGoalState,
} from './state.js';

/** Hermes `CONTINUATION_PROMPT_TEMPLATE` (exact wording). */
export const CONTINUATION_PROMPT_TEMPLATE =
  '[Continuing toward your standing goal]\n' +
  'Goal: {goal}\n\n' +
  'Continue working toward this goal. Take the next concrete step. ' +
  'If you believe the goal is complete, state so explicitly and stop. ' +
  'If you are blocked and need input from the user, say so clearly and stop.';

/** Hermes `CONTINUATION_PROMPT_WITH_CHECKLIST_TEMPLATE` (exact wording). */
export const CONTINUATION_PROMPT_WITH_CHECKLIST_TEMPLATE =
  '[Continuing toward your standing goal]\n' +
  'Goal: {goal}\n\n' +
  'Checklist progress ({done}/{total} done):\n' +
  '{checklist}\n\n' +
  'Work on the unchecked items above. Do not declare items done yourself ' +
  '— a judge marks them based on evidence in your output. If an item is ' +
  'genuinely impossible in this environment, explain why so the judge can ' +
  'mark it impossible. If you are blocked on a remaining item and need ' +
  'user input, say so clearly and stop.';

export type GoalsEvaluateConfigSlice = Pick<
  GoalsConfig,
  'checklistMode' | 'maxConsecutiveParseFailures' | 'judgeTimeoutMs' | 'checklistHistoryChars'
>;

export type GoalPostTurnDecision = {
  newState: PersistentGoalState | null;
  shouldContinue: boolean;
  continuationPrompt: string | null;
  verdict: 'done' | 'continue' | 'skipped' | 'inactive' | 'decompose';
  reason: string;
  message: string;
};

function cloneState(s: PersistentGoalState): PersistentGoalState {
  return {
    ...s,
    checklist: s.checklist?.map((it) => ({ ...it })),
  };
}

function buildContinuationPrompt(s: PersistentGoalState): string {
  const cl = s.checklist ?? [];
  if (cl.length) {
    const { total, completed, impossible } = checklistCounts(cl);
    const done = completed + impossible;
    return CONTINUATION_PROMPT_WITH_CHECKLIST_TEMPLATE.replace('{goal}', s.goal)
      .replace('{done}', String(done))
      .replace('{total}', String(total))
      .replace('{checklist}', renderChecklistPlain(cl));
  }
  return CONTINUATION_PROMPT_TEMPLATE.replace('{goal}', s.goal);
}

function parsePauseMessage(turnsUsed: number, maxTurns: number): string {
  return (
    `⏸ Goal paused — ${turnsUsed}/${maxTurns} turns used. ` +
    'Use /goal resume to keep going, or /goal clear to stop.'
  );
}

function parseFailurePauseMessage(failures: number): string {
  return (
    `⏸ Goal paused — the judge returned unparseable output ${failures} turns in a row. ` +
    'Configure a stricter model under `goals.judgeModelRef` in your xopc config, then /goal resume.'
  );
}

/**
 * Hermes `GoalManager.evaluate_after_turn` equivalent (minus SessionDB I/O).
 */
export async function evaluateAfterTurnHermesLike(
  state: PersistentGoalState,
  lastResponse: string,
  judgeModelRef: string,
  signal?: AbortSignal,
  opts?: { goalsSlice?: Partial<GoalsEvaluateConfigSlice>; historyExcerpt?: string },
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

  const slice = opts?.goalsSlice;
  const checklistMode = slice?.checklistMode !== false;
  const maxParseFailures = slice?.maxConsecutiveParseFailures ?? 3;
  const judgeTimeoutMs = slice?.judgeTimeoutMs;

  const next = cloneState(state);
  next.turnsUsed += 1;
  next.lastTurnAt = Date.now();

  const bumpParse = () => {
    next.consecutiveParseFailures = (next.consecutiveParseFailures ?? 0) + 1;
  };
  const resetParse = () => {
    next.consecutiveParseFailures = 0;
  };

  const pauseIfParseStorm = (reason: string): GoalPostTurnDecision | null => {
    const n = next.consecutiveParseFailures ?? 0;
    if (n < maxParseFailures) return null;
    next.status = 'paused';
    next.pausedReason = `judge parse failures (${n} consecutive)`;
    return {
      newState: next,
      shouldContinue: false,
      continuationPrompt: null,
      verdict: 'continue',
      reason,
      message: parseFailurePauseMessage(n),
    };
  };

  const pauseIfBudget = (reason: string): GoalPostTurnDecision | null => {
    if (next.turnsUsed < next.maxTurns) return null;
    next.status = 'paused';
    next.pausedReason = `turn budget exhausted (${next.turnsUsed}/${next.maxTurns})`;
    return {
      newState: next,
      shouldContinue: false,
      continuationPrompt: null,
      verdict: 'continue',
      reason,
      message: parsePauseMessage(next.turnsUsed, next.maxTurns),
    };
  };

  // ── Phase A: decompose (once per goal when checklist mode is on) ──
  if (checklistMode && !next.decomposed) {
    const dec = await decomposeGoalChecklist({
      goal: next.goal,
      judgeModelRef,
      signal,
      judgeTimeoutMs,
    });
    next.decomposed = true;
    if (!dec.parseFailed && dec.items.length > 0) {
      const now = Date.now();
      next.checklist = dec.items.map((it) => ({
        text: it.text,
        status: CHECKLIST_ITEM_PENDING,
        addedBy: 'judge' as const,
        addedAt: now,
      }));
      next.lastVerdict = 'decompose';
      next.lastReason = `decomposed into ${dec.items.length} items`;
      resetParse();
      const budgetEarly = pauseIfBudget(next.lastReason);
      if (budgetEarly) return budgetEarly;
      return {
        newState: next,
        shouldContinue: true,
        continuationPrompt: buildContinuationPrompt(next),
        verdict: 'decompose',
        reason: next.lastReason ?? '',
        message:
          `⊙ Checklist ready (${dec.items.length} criteria). ` +
          'Use /subgoal to view or edit. Continuing...',
      };
    }
    next.lastReason = dec.errorReason ? `decompose: ${dec.errorReason}` : 'decompose produced no checklist';
  }

  // ── Phase B: checklist judge ──
  const checklist = next.checklist ?? [];
  if (checklist.length > 0) {
    const evalResult = await evaluateGoalChecklistJudge({
      goal: next.goal,
      numberedChecklist: renderChecklistNumbered(checklist),
      lastResponse,
      historyExcerpt: opts?.historyExcerpt ?? '',
      judgeModelRef,
      signal,
      judgeTimeoutMs,
    });

    if (evalResult.parseFailed) {
      bumpParse();
    } else {
      resetParse();
      next.checklist = applyJudgeChecklistUpdates(checklist, {
        updates: evalResult.parsed.updates,
        newItems: evalResult.parsed.newItems,
      });
    }

    next.lastVerdict = 'continue';
    next.lastReason = evalResult.parsed.reason;

    if (!evalResult.parseFailed && allChecklistTerminal(next.checklist ?? [])) {
      next.status = 'done';
      next.lastVerdict = 'done';
      return {
        newState: next,
        shouldContinue: false,
        continuationPrompt: null,
        verdict: 'done',
        reason: evalResult.parsed.reason,
        message: `✓ Goal achieved: ${evalResult.parsed.reason}`,
      };
    }

    const parseStorm = pauseIfParseStorm(evalResult.parsed.reason);
    if (parseStorm) return parseStorm;

    const budget = pauseIfBudget(evalResult.parsed.reason);
    if (budget) return budget;

    const { total, completed, impossible } = checklistCounts(next.checklist ?? []);
    const done = completed + impossible;
    const progress = total ? ` — ${done}/${total} done` : '';

    return {
      newState: next,
      shouldContinue: true,
      continuationPrompt: buildContinuationPrompt(next),
      verdict: 'continue',
      reason: evalResult.parsed.reason,
      message: `↻ Continuing toward goal (${next.turnsUsed}/${next.maxTurns}${progress}): ${evalResult.parsed.reason}`,
    };
  }

  // ── Freeform judge (no checklist) ──
  const j = await judgeGoalHermesStyle(state.goal, lastResponse, judgeModelRef, signal, { judgeTimeoutMs });
  next.lastVerdict = j.verdict === 'skipped' ? 'skipped' : j.verdict;
  next.lastReason = j.reason;

  if (j.parseFailed) bumpParse();
  else resetParse();

  if (j.verdict === 'done') {
    next.status = 'done';
    return {
      newState: next,
      shouldContinue: false,
      continuationPrompt: null,
      verdict: 'done',
      reason: j.reason,
      message: `✓ Goal achieved: ${j.reason}`,
    };
  }

  const parseStorm = pauseIfParseStorm(j.reason);
  if (parseStorm) return parseStorm;

  const budget = pauseIfBudget(j.reason);
  if (budget) return budget;

  return {
    newState: next,
    shouldContinue: true,
    continuationPrompt: buildContinuationPrompt(next),
    verdict: 'continue',
    reason: j.reason,
    message: `↻ Continuing toward goal (${next.turnsUsed}/${next.maxTurns}): ${j.reason}`,
  };
}
