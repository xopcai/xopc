import goalsEn from './locales/goals.en.json';
import goalsZh from './locales/goals.zh.json';

import { formatI18n } from './format.js';
import type { ServerLocale } from './locale.js';
import { serverLocaleOrFallback } from './locale.js';

export type GoalsMessages = typeof goalsEn;

export type JudgeReasonId = keyof GoalsMessages['judgeReason'];

/** Canonical English strings for judge parse / API contract (from `goals.en.json`). */
export const JUDGE_REASON_EN = goalsEn.judgeReason;

const byLocale: Record<ServerLocale, GoalsMessages> = {
  en: goalsEn,
  zh: goalsZh,
};

export function goalsMessages(locale: ServerLocale): GoalsMessages {
  return byLocale[serverLocaleOrFallback(locale)];
}

export function goalsJudgeReason(id: JudgeReasonId, locale: ServerLocale): string {
  const m = goalsMessages(locale).judgeReason[id] ?? goalsEn.judgeReason[id];
  return m ?? String(id);
}

export function goalsJudgeResponseLanguageNote(locale: ServerLocale): string {
  return goalsMessages(locale).judge.responseLanguageNote;
}

export function goalsContinuationPlainTemplate(locale: ServerLocale): string {
  return goalsMessages(locale).continuation.plain;
}

export function goalsContinuationChecklistTemplate(locale: ServerLocale): string {
  return goalsMessages(locale).continuation.checklist;
}

export function goalsChecklistProgressSuffix(done: number, total: number, locale: ServerLocale): string {
  if (total <= 0) return '';
  return formatI18n(goalsMessages(locale).checklistProgressSuffix, { done, total });
}

export function goalsEvaluateCopy(locale: ServerLocale) {
  const ev = goalsMessages(locale).evaluate;
  return {
    pauseBudget: (turnsUsed: number, maxTurns: number) =>
      formatI18n(ev.pauseBudget, { turnsUsed, maxTurns }),
    pauseParse: (failures: number) => formatI18n(ev.pauseParse, { failures }),
    goalAchieved: (reason: string) => formatI18n(ev.goalAchieved, { reason }),
    continuingWithProgress: (
      turnsUsed: number,
      maxTurns: number,
      progressSuffix: string,
      reason: string,
    ) => formatI18n(ev.continuingWithProgress, { turnsUsed, maxTurns, progressSuffix, reason }),
    continuing: (turnsUsed: number, maxTurns: number, reason: string) =>
      formatI18n(ev.continuing, { turnsUsed, maxTurns, reason }),
    checklistReady: (n: number) => formatI18n(ev.checklistReady, { n }),
    decomposedReason: (n: number) => formatI18n(ev.decomposedReason, { n }),
    decomposeFallbackReason: (detail: string) => formatI18n(ev.decomposeFallbackReason, { detail }),
    noChecklistFallback: () => ev.noChecklistFallback,
  };
}
