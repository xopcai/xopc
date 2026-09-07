import type { AssertionKind, AssertionVolatility, UserAssertion } from './domain.js';

const REVIEW_INTERVAL_MS: Record<AssertionVolatility, number | undefined> = {
  stable: undefined,
  slow: 180 * 24 * 60 * 60 * 1_000,
  dynamic: 30 * 24 * 60 * 60 * 1_000,
  event: 7 * 24 * 60 * 60 * 1_000,
};

export function defaultReviewAt(
  volatility: AssertionVolatility,
  observedAt: number,
): number | undefined {
  const interval = REVIEW_INTERVAL_MS[volatility];
  return interval === undefined ? undefined : observedAt + interval;
}

export function requiresBoundedValidity(kind: AssertionKind, volatility: AssertionVolatility): boolean {
  return kind === 'current_state' || volatility === 'event';
}

export function isAssertionValidAt(assertion: UserAssertion, asOf: number): boolean {
  return assertion.status === 'active'
    && (assertion.validFrom === undefined || assertion.validFrom <= asOf)
    && (assertion.validTo === undefined || assertion.validTo >= asOf);
}

const AUTHORITY_RANK = {
  external_untrusted: 0,
  system_inferred: 1,
  user_observed: 2,
  user_explicit: 3,
} as const;

export interface CurrentAssertionResolution {
  assertion?: UserAssertion;
  conflict: boolean;
  contenders: UserAssertion[];
}

export function resolveCurrentAssertion(
  assertions: UserAssertion[],
  asOf = Date.now(),
): CurrentAssertionResolution {
  const contenders = assertions.filter((item) => isAssertionValidAt(item, asOf));
  if (!contenders.length) return { conflict: false, contenders: [] };

  contenders.sort((left, right) =>
    AUTHORITY_RANK[right.authority] - AUTHORITY_RANK[left.authority]
    || right.recordedAt - left.recordedAt);
  const best = contenders[0];
  const ambiguous = contenders.filter((item) =>
    AUTHORITY_RANK[item.authority] === AUTHORITY_RANK[best.authority]
    && item.normalizedValue !== best.normalizedValue);
  if (ambiguous.length) return { assertion: undefined, conflict: true, contenders };
  return { assertion: best, conflict: false, contenders };
}
