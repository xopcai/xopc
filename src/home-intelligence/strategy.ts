import type { HomeOpportunity } from '@xopcai/gateway-contract';

export const HOME_ADVICE_STRATEGY_VERSION = 'home-v1';
export const HOME_FEEDBACK_WINDOW_MS = 90 * 24 * 60 * 60_000;
export const HOME_NEGATIVE_FEEDBACK_THRESHOLD = 3;

export interface HomeAdvicePersonalization {
  highConfidenceKinds: ReadonlySet<HomeOpportunity['kind']>;
}

export interface HomeSuccessfulPattern {
  projectId?: string;
  title: string;
  outcome: string;
  successCount: number;
}

export function homePatternKey(projectId: string | undefined, outcome: string): string {
  const normalizedOutcome = outcome.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
  return `${projectId ?? 'global'}:${normalizedOutcome}`;
}
