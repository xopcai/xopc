import type { GoalsConfig } from '../../config/schema.js';

import { decomposeGoalChecklist, evaluateGoalChecklistJudge } from './checklist-judge.js';
import { allChecklistTerminal, checklistCounts } from './checklist-types.js';
import {
  buildContinuationPromptFromState,
  checklistProgressSuffix,
  CONTINUATION_PROMPT_TEMPLATE_EN,
  CONTINUATION_PROMPT_WITH_CHECKLIST_TEMPLATE_EN,
  goalEvaluateUserCopy,
  resolveGoalUiLocale,
  type GoalUiLocale,
} from './goal-locale.js';
import { judgeGoalHermesStyle } from './judge.js';
import {
  applyJudgeChecklistUpdates,
  mergeDecomposedChecklistItems,
  renderChecklistNumbered,
  type PersistentGoalState,
} from './state.js';

/** Hermes `CONTINUATION_PROMPT_TEMPLATE` (English; parity / tests). */
export const CONTINUATION_PROMPT_TEMPLATE = CONTINUATION_PROMPT_TEMPLATE_EN;

/** Hermes `CONTINUATION_PROMPT_WITH_CHECKLIST_TEMPLATE` (English; parity / tests). */
export const CONTINUATION_PROMPT_WITH_CHECKLIST_TEMPLATE = CONTINUATION_PROMPT_WITH_CHECKLIST_TEMPLATE_EN;

export type GoalsEvaluateConfigSlice = Pick<
  GoalsConfig,
  'checklistMode' | 'maxConsecutiveParseFailures' | 'judgeTimeoutMs' | 'checklistHistoryChars'
>;

export type GoalPostTurnDecision = {
  newState: PersistentGoalState | null;
  shouldContinue: boolean;
  continuationPrompt: string | null;
  verdict: 'done' | 'continue' | 'blocked' | 'needs_input' | 'skipped' | 'inactive' | 'decompose';
  reason: string;
  message: string;
  confidence?: number;
  missingEvidence?: string[];
  userQuestion?: string;
  completedChecklistItemIndexes?: number[];
};

function cloneState(s: PersistentGoalState): PersistentGoalState {
  return {
    ...s,
    checklist: s.checklist?.map((it) => ({ ...it })),
  };
}

/**
 * Hermes `GoalManager.evaluate_after_turn` equivalent (minus SessionDB I/O).
 */
export async function evaluateAfterTurnHermesLike(
  state: PersistentGoalState,
  lastResponse: string,
  judgeModelRef: string,
  signal?: AbortSignal,
  opts?: { goalsSlice?: Partial<GoalsEvaluateConfigSlice>; historyExcerpt?: string; uiLocale?: GoalUiLocale },
): Promise<GoalPostTurnDecision> {
  const locale = opts?.uiLocale ?? resolveGoalUiLocale(state);
  const copy = goalEvaluateUserCopy(locale);

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
      message: copy.pauseParse(n),
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
      message: copy.pauseBudget(next.turnsUsed, next.maxTurns),
    };
  };

  // ── Phase A: decompose (once per goal when checklist mode is on) ──
  if (checklistMode && !next.decomposed) {
    const dec = await decomposeGoalChecklist({
      goal: next.goal,
      judgeModelRef,
      signal,
      judgeTimeoutMs,
      uiLocale: locale,
    });
    next.decomposed = true;
    if (!dec.parseFailed && dec.items.length > 0) {
      const prior = next.checklist ?? [];
      next.checklist = mergeDecomposedChecklistItems(prior, dec.items);
      const mergedCount = next.checklist.length;
      next.lastVerdict = 'decompose';
      next.lastReason = copy.decomposedReason(mergedCount);
      resetParse();
      const budgetEarly = pauseIfBudget(next.lastReason);
      if (budgetEarly) return budgetEarly;
      return {
        newState: next,
        shouldContinue: true,
        continuationPrompt: buildContinuationPromptFromState(next, locale),
        verdict: 'decompose',
        reason: next.lastReason ?? '',
        message: copy.checklistReady(mergedCount),
      };
    }
    next.lastReason = dec.errorReason
      ? copy.decomposeFallbackReason(dec.errorReason)
      : copy.noChecklistFallback();
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
      uiLocale: locale,
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

    const completedChecklistItemIndexes = evalResult.parsed.updates
      .filter((update) => update.status === 'completed' || update.status === 'impossible')
      .map((update) => update.index);
    const structuredNextAction = evalResult.parsed.nextAction?.trim();
    const continuationPrompt = structuredNextAction || buildContinuationPromptFromState(next, locale);

    if (!evalResult.parseFailed && allChecklistTerminal(next.checklist ?? [])) {
      next.status = 'done';
      next.lastVerdict = 'done';
      return {
        newState: next,
        shouldContinue: false,
        continuationPrompt: null,
        verdict: 'done',
        reason: evalResult.parsed.reason,
        message: copy.goalAchieved(evalResult.parsed.reason),
        confidence: evalResult.parsed.confidence,
        missingEvidence: evalResult.parsed.missingEvidence,
        userQuestion: evalResult.parsed.userQuestion,
        completedChecklistItemIndexes,
      };
    }

    if (!evalResult.parseFailed && (evalResult.parsed.verdict === 'blocked' || evalResult.parsed.verdict === 'needs_input')) {
      next.status = 'paused';
      next.pausedReason = evalResult.parsed.reason;
      return {
        newState: next,
        shouldContinue: false,
        continuationPrompt: null,
        verdict: evalResult.parsed.verdict,
        reason: evalResult.parsed.reason,
        message: evalResult.parsed.verdict === 'needs_input'
          ? `Goal needs input: ${evalResult.parsed.userQuestion || evalResult.parsed.reason}`
          : `Goal blocked: ${evalResult.parsed.reason}`,
        confidence: evalResult.parsed.confidence,
        missingEvidence: evalResult.parsed.missingEvidence,
        userQuestion: evalResult.parsed.userQuestion,
        completedChecklistItemIndexes,
      };
    }

    const parseStorm = pauseIfParseStorm(evalResult.parsed.reason);
    if (parseStorm) return parseStorm;

    const budget = pauseIfBudget(evalResult.parsed.reason);
    if (budget) return budget;

    const { total, completed, impossible } = checklistCounts(next.checklist ?? []);
    const done = completed + impossible;
    const progressSuffix = checklistProgressSuffix(done, total, locale);

    return {
      newState: next,
      shouldContinue: true,
      continuationPrompt,
      verdict: 'continue',
      reason: evalResult.parsed.reason,
      message: copy.continuingWithProgress(
        next.turnsUsed,
        next.maxTurns,
        progressSuffix,
        evalResult.parsed.reason,
      ),
      confidence: evalResult.parsed.confidence,
      missingEvidence: evalResult.parsed.missingEvidence,
      userQuestion: evalResult.parsed.userQuestion,
      completedChecklistItemIndexes,
    };
  }

  // ── Freeform judge (no checklist) ──
  const j = await judgeGoalHermesStyle(state.goal, lastResponse, judgeModelRef, signal, {
    judgeTimeoutMs,
    uiLocale: locale,
  });
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
      message: copy.goalAchieved(j.reason),
    };
  }

  const parseStorm = pauseIfParseStorm(j.reason);
  if (parseStorm) return parseStorm;

  const budget = pauseIfBudget(j.reason);
  if (budget) return budget;

  return {
    newState: next,
    shouldContinue: true,
    continuationPrompt: buildContinuationPromptFromState(next, locale),
    verdict: 'continue',
    reason: j.reason,
    message: copy.continuing(next.turnsUsed, next.maxTurns, j.reason),
  };
}
