import type { UserAssertion } from './domain.js';

/** Automatic personalization never grants execution authority. */
export function isWorkingAssumption(assertion: UserAssertion): boolean {
  return (assertion.status === 'candidate' || assertion.status === 'active')
    && (assertion.authority === 'user_observed' || assertion.authority === 'system_inferred')
    && assertion.confidence >= 0.7
    && (assertion.consequence === 'low' || assertion.consequence === 'medium')
    && assertion.sensitivity === 'normal'
    && assertion.disclosurePolicy !== 'ask_before_reference';
}

export function canUseAssertion(assertion: UserAssertion, asOf = Date.now()): boolean {
  return (assertion.validFrom === undefined || assertion.validFrom <= asOf)
    && (assertion.validTo === undefined || assertion.validTo >= asOf)
    && (assertion.reviewAt === undefined || assertion.reviewAt > asOf)
    && assertion.sensitivity !== 'secret'
    && assertion.sensitivity !== 'regulated'
    && assertion.disclosurePolicy !== 'ask_before_reference'
    && ((assertion.status === 'active' && assertion.authority === 'user_explicit')
      || isWorkingAssumption(assertion));
}
