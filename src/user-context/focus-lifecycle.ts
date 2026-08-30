import type { UserFocus } from './sources/types.js';

const DAY_MS = 24 * 60 * 60 * 1_000;

const HORIZON_DAYS: Record<UserFocus['horizon'], { review: number; valid: number }> = {
  current: { review: 14, valid: 30 },
  ongoing: { review: 30, valid: 120 },
  long_term: { review: 90, valid: 365 },
};

export function focusLifecycle(
  horizon: UserFocus['horizon'],
  now = Date.now(),
): Pick<UserFocus, 'validFrom' | 'validTo' | 'reviewAt'> {
  const days = HORIZON_DAYS[horizon];
  return {
    validFrom: now,
    reviewAt: now + days.review * DAY_MS,
    validTo: now + days.valid * DAY_MS,
  };
}
