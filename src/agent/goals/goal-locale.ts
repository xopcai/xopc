import { checklistCounts } from './checklist-types.js';
import {
  renderChecklistPlain,
  type PersistentGoalState,
} from './state.js';

import { formatI18n } from '../../i18n/format.js';
import {
  goalsChecklistProgressSuffix,
  goalsContinuationChecklistTemplate,
  goalsContinuationPlainTemplate,
  goalsEvaluateCopy,
  goalsJudgeReason,
  goalsJudgeResponseLanguageNote,
  JUDGE_REASON_EN,
  type JudgeReasonId,
} from '../../i18n/goals-bundle.js';
import {
  DEFAULT_SERVER_LOCALE,
  normalizeServerLocale,
  SERVER_LOCALES,
  type ServerLocale,
  serverLocaleOrFallback,
  isServerLocale,
} from '../../i18n/locale.js';

// ── Goal-facing aliases (persistent goal uses same locale set as server i18n) ──

export const GOAL_UI_LOCALES = SERVER_LOCALES;
export type GoalUiLocale = ServerLocale;
export const DEFAULT_GOAL_UI_LOCALE = DEFAULT_SERVER_LOCALE;

export const isGoalUiLocale = isServerLocale;
export const normalizeGoalUiLocale = normalizeServerLocale;
export const goalUiLocaleOrFallback = serverLocaleOrFallback;

export function resolveGoalUiLocale(state: PersistentGoalState | undefined | null): GoalUiLocale {
  return goalUiLocaleOrFallback(state?.uiLocale);
}

// ── Hermes-style English continuation (tests / parity; sourced from server i18n JSON) ──

export const CONTINUATION_PROMPT_TEMPLATE_EN = goalsContinuationPlainTemplate('en');
export const CONTINUATION_PROMPT_WITH_CHECKLIST_TEMPLATE_EN = goalsContinuationChecklistTemplate('en');

export function buildContinuationPromptFromState(state: PersistentGoalState, locale: GoalUiLocale): string {
  const L = goalUiLocaleOrFallback(locale);
  const cl = state.checklist ?? [];
  if (cl.length) {
    const plain = renderChecklistPlain(cl);
    const { total, completed, impossible } = checklistCounts(cl);
    const done = completed + impossible;
    const tpl = goalsContinuationChecklistTemplate(L);
    return formatI18n(tpl, {
      goal: state.goal,
      done,
      total,
      checklist: plain,
    });
  }
  return formatI18n(goalsContinuationPlainTemplate(L), { goal: state.goal });
}

export function judgeResponseLanguageNote(locale: GoalUiLocale): string {
  return goalsJudgeResponseLanguageNote(goalUiLocaleOrFallback(locale));
}

export { JUDGE_REASON_EN, type JudgeReasonId };

const JUDGE_REASON_ID_BY_EN = new Map<string, JudgeReasonId>(
  (Object.entries(JUDGE_REASON_EN) as [JudgeReasonId, string][]).map(([id, s]) => [s, id]),
);

export function judgeReasonText(id: JudgeReasonId, locale: GoalUiLocale): string {
  return goalsJudgeReason(id, goalUiLocaleOrFallback(locale));
}

export function localizeJudgeReasonText(reason: string, locale: GoalUiLocale): string {
  const id = JUDGE_REASON_ID_BY_EN.get(reason);
  if (!id) return reason;
  return judgeReasonText(id, locale);
}

export function judgeFreeformBuiltinMessages(locale: GoalUiLocale) {
  const L = goalUiLocaleOrFallback(locale);
  return {
    emptyGoal: judgeReasonText('empty_goal', L),
    emptyResponse: judgeReasonText('empty_response', L),
    noModel: judgeReasonText('judge_model_not_configured', L),
    callFailed: judgeReasonText('judge_call_failed', L),
  };
}

export function checklistProgressSuffix(done: number, total: number, locale: GoalUiLocale): string {
  return goalsChecklistProgressSuffix(done, total, goalUiLocaleOrFallback(locale));
}

export type GoalEvaluateUserCopyPack = ReturnType<typeof goalsEvaluateCopy>;

export function goalEvaluateUserCopy(locale: GoalUiLocale): GoalEvaluateUserCopyPack {
  return goalsEvaluateCopy(goalUiLocaleOrFallback(locale));
}
