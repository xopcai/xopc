import type { UserAssertion } from './domain.js';

export function isWorkingAssumption(assertion: UserAssertion): boolean {
  return assertion.status === 'candidate'
    && (assertion.authority === 'user_observed' || assertion.authority === 'system_inferred')
    && assertion.confidence >= 0.7
    && assertion.consequence !== 'critical'
    && assertion.sensitivity === 'normal'
    && assertion.disclosurePolicy !== 'ask_before_reference';
}
