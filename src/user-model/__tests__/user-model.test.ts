import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  getSqliteDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import {
  calculateExecutionValue,
  getAssertionSlot,
  listSlotAssertions,
  reconcileAssertion,
  resolveCurrentAssertion,
  type AssertionCandidate,
} from '../index.js';

function candidate(overrides: Partial<AssertionCandidate> = {}): AssertionCandidate {
  return {
    subject: { type: 'user', id: 'self' },
    predicate: 'preference.response.detail',
    cardinality: 'single',
    scope: { type: 'global' },
    kind: 'preference',
    value: 'concise',
    normalizedValue: 'concise',
    statement: 'I prefer concise responses.',
    authority: 'user_explicit',
    confidence: 1,
    inferredImportance: 0.5,
    consequence: 'medium',
    actionability: 0.9,
    volatility: 'stable',
    sensitivity: 'normal',
    disclosurePolicy: 'referenceable',
    observedAt: 1_000,
    createdBy: 'user',
    ...overrides,
  };
}

describe('user model foundation', () => {
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('resolves one global slot independently from assertion values', () => {
    const first = reconcileAssertion(candidate(), 2_000);
    const repeated = reconcileAssertion(candidate({ statement: 'Keep responses concise.' }), 3_000);

    expect(repeated.action).toBe('deduplicated');
    expect(repeated.assertion.id).toBe(first.assertion.id);
    expect(getAssertionSlot(first.assertion.slotId)?.predicate).toBe('preference.response.detail');
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS count FROM user_assertion_slots')
      .get()).toMatchObject({ count: 1 });
  });

  it('rejects a scope that could be silently widened', () => {
    expect(() => reconcileAssertion(candidate({ scope: { type: 'project' } })))
      .toThrow('project user-model scope requires an id');
    expect(() => reconcileAssertion(candidate({ scope: { type: 'global', id: 'project-1' } })))
      .toThrow('Global user-model scope must not have an id');
  });

  it('handles an explicit correction before duplicate detection', () => {
    const first = reconcileAssertion(candidate(), 2_000).assertion;
    const result = reconcileAssertion(candidate({
      value: 'detailed',
      normalizedValue: 'detailed',
      statement: 'Correction: I prefer detailed responses.',
      observedAt: 4_000,
      validFrom: 4_000,
      correctionOfAssertionId: first.id,
    }), 5_000);

    expect(result.action).toBe('superseded');
    expect(result.assertion.supersedesAssertionId).toBe(first.id);
    expect(result.previousAssertion?.validTo).toBe(3_999);
    expect(listSlotAssertions(first.slotId)).toHaveLength(2);
  });

  it('keeps an explicit current value when a conflicting inference arrives', () => {
    const explicit = reconcileAssertion(candidate(), 2_000).assertion;
    const result = reconcileAssertion(candidate({
      value: 'detailed',
      normalizedValue: 'detailed',
      statement: 'The user may prefer detailed responses.',
      authority: 'system_inferred',
      confidence: 0.7,
      createdBy: 'runtime',
    }), 3_000);

    expect(result.action).toBe('conflicted');
    expect(result.assertion.status).toBe('conflicted');
    expect(resolveCurrentAssertion(listSlotAssertions(explicit.slotId), 3_000).assertion?.id)
      .toBe(explicit.id);
  });

  it('preserves non-overlapping historical assertions', () => {
    const old = reconcileAssertion(candidate({ validFrom: 100, validTo: 200 }), 300).assertion;
    const current = reconcileAssertion(candidate({
      value: 'detailed',
      normalizedValue: 'detailed',
      statement: 'I now prefer detailed responses.',
      validFrom: 201,
    }), 400).assertion;

    expect(current.supersedesAssertionId).toBeUndefined();
    expect(resolveCurrentAssertion([old, current], 150).assertion?.id).toBe(old.id);
    expect(resolveCurrentAssertion([old, current], 250).assertion?.id).toBe(current.id);
  });

  it('abstains when equal-authority current assertions disagree', () => {
    const left = reconcileAssertion(candidate(), 2_000).assertion;
    const right = { ...left, id: 'other', normalizedValue: 'detailed', recordedAt: 2_001 };
    expect(resolveCurrentAssertion([left, right], 3_000)).toMatchObject({
      conflict: true,
      assertion: undefined,
    });
  });

  it('ranks execution value without treating confidence as importance', () => {
    const critical = calculateExecutionValue({
      inferredImportance: 0.2,
      consequence: 'critical',
      actionability: 1,
      taskRelevance: 1,
      urgency: 0.7,
    });
    const incidental = calculateExecutionValue({
      inferredImportance: 0.2,
      consequence: 'low',
      actionability: 0.1,
      taskRelevance: 0.2,
      urgency: 0,
    });
    expect(critical).toBeGreaterThan(incidental);
  });
});
