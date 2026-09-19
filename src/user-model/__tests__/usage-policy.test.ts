import { describe, expect, it } from 'vitest';
import { canUseAssertion } from '../usage-policy.js';
import type { UserAssertion } from '../domain.js';

const inference = {
  status: 'active', authority: 'system_inferred', confidence: 0.8,
  sensitivity: 'normal', disclosurePolicy: 'referenceable', consequence: 'low',
} as UserAssertion;

describe('automatic personalization policy', () => {
  it('applies the same evidence and risk limits after automatic activation', () => {
    expect(canUseAssertion(inference)).toBe(true);
    expect(canUseAssertion({ ...inference, confidence: 0.5 })).toBe(false);
    expect(canUseAssertion({ ...inference, consequence: 'high' })).toBe(false);
    expect(canUseAssertion({ ...inference, sensitivity: 'personal' })).toBe(false);
  });
  it('stops using overdue and expired memories before maintenance runs', () => {
    expect(canUseAssertion({ ...inference, reviewAt: 100 }, 100)).toBe(false);
    expect(canUseAssertion({ ...inference, validTo: 100 }, 101)).toBe(false);
  });
});
