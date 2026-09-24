import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  getSqliteDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import {
  calculateExecutionValue,
  deleteUserAssertion,
  getUserAssertion,
  setAssertionStatus,
  getAssertionSlot,
  listSlotAssertions,
  listUserModelObservations,
  linkAssertionEvidence,
  linkUserAssertions,
  recordUserModelObservation,
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
  it('deletes the correction chain and prevents automatic reconstruction', () => {
    const first = reconcileAssertion(candidate(), 2_000).assertion;
    const corrected = reconcileAssertion(candidate({ normalizedValue: 'detailed', value: 'detailed',
      statement: 'Detailed answers.', correctionOfAssertionId: first.id, observedAt: 3_000 }), 3_000).assertion;
    expect(deleteUserAssertion(corrected.id, 4_000)).toBe(true);
    expect(getUserAssertion(first.id)).toBeUndefined();
    expect(getUserAssertion(corrected.id)).toBeUndefined();
    expect(reconcileAssertion(candidate({ authority: 'system_inferred' }), 5_000).action).toBe('suppressed');
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM user_assertions_fts').get()).toMatchObject({ n: 0 });
    expect(reconcileAssertion(candidate(), 6_000, { restoreDeleted: true }).action).toBe('created');
  });

  it('records explicit confirmation independently of automatic activation', () => {
    const item = reconcileAssertion(candidate({ authority: 'system_inferred' }), 2_000).assertion;
    setAssertionStatus(item.id, 'active', { actor: 'maintenance', reason: 'Evidence threshold.' });
    expect(getUserAssertion(item.id)?.authority).toBe('system_inferred');
    setAssertionStatus(item.id, 'active', { actor: 'user', reason: 'Explicit confirmation.' });
    expect(getUserAssertion(item.id)?.authority).toBe('user_explicit');
  });

  it('does not recreate an understanding the user stopped using', () => {
    const item = reconcileAssertion(candidate(), 2_000).assertion;
    setAssertionStatus(item.id, 'rejected', { actor: 'user', reason: 'Not true.' });
    expect(reconcileAssertion(candidate({ authority: 'system_inferred' }), 3_000).action).toBe('suppressed');
  });

  it('does not admit inferred high-risk domains even when mislabeled normal', () => {
    expect(reconcileAssertion(candidate({
      kind: 'derived_insight', domain: 'health', authority: 'system_inferred', createdBy: 'runtime',
      predicate: 'health.inferred', statement: 'Possible health pattern.',
      value: 'pattern', normalizedValue: 'pattern',
    })).action).toBe('suppressed');
  });

  it('does not recreate an old value after a correction in a multiple-value slot', () => {
    const old = candidate({ cardinality: 'multiple', authority: 'system_inferred' });
    const item = reconcileAssertion(old, 2_000).assertion;
    reconcileAssertion({ ...old, authority: 'user_explicit', normalizedValue: 'detailed', value: 'detailed',
      statement: 'Detailed responses.', correctionOfAssertionId: item.id, observedAt: 3_000 }, 3_000);
    expect(reconcileAssertion(old, 4_000).action).toBe('suppressed');
  });

  it('keeps deletion scoped to the project where the understanding was formed', () => {
    const first = reconcileAssertion(candidate({ scope: { type: 'project', id: 'one' } })).assertion;
    deleteUserAssertion(first.id);
    expect(reconcileAssertion(candidate({ scope: { type: 'project', id: 'one' } })).action).toBe('suppressed');
    expect(reconcileAssertion(candidate({ scope: { type: 'project', id: 'two' } })).action).toBe('created');
  });

  it('supersedes newer event state without creating a permanent conflict', () => {
    const first = reconcileAssertion(candidate({
      subject: { type: 'goal', id: 'launch' }, predicate: 'goal.current_state',
      kind: 'current_state', authority: 'user_observed', createdBy: 'connector',
      volatility: 'event', value: 'planning', normalizedValue: 'planning',
      statement: 'Launch is being planned.', validFrom: 1_000, validTo: 9_000,
    }), 1_100).assertion;
    const next = reconcileAssertion(candidate({
      subject: { type: 'goal', id: 'launch' }, predicate: 'goal.current_state',
      kind: 'current_state', authority: 'user_observed', createdBy: 'connector',
      volatility: 'event', value: 'review', normalizedValue: 'review',
      statement: 'Launch is in review.', observedAt: 2_000, validFrom: 2_000, validTo: 10_000,
    }), 2_100);
    expect(next.action).toBe('superseded');
    expect(next.assertion.supersedesAssertionId).toBe(first.id);
    expect(next.previousAssertion).toMatchObject({ status: 'archived', validTo: 1_999 });
  });

  it('tracks evidence strength, observations, and assertion relationships', () => {
    const db = getSqliteDatabase();
    db.prepare(`INSERT INTO context_evidence (
      evidence_id, principal_id, source_type, source_instance_id, source_ref,
      trust_level, observed_at, created_at
    ) VALUES (?, 'local-owner', 'connector', ?, ?, 'owner', ?, ?)`)
      .run('evidence-1', 'mail-one', 'mail://one', 1_500, 1_500);
    const first = reconcileAssertion(candidate({
      authority: 'user_observed', createdBy: 'connector', evidenceId: 'evidence-1',
    }), 2_000).assertion;
    expect(first).toMatchObject({
      domain: 'preferences', layer: 'pattern', supportCount: 1, independentSourceCount: 1,
      lastSupportedAt: 1_500,
    });
    db.prepare(`INSERT INTO context_evidence (
      evidence_id, principal_id, source_type, source_instance_id, source_ref,
      trust_level, observed_at, created_at
    ) VALUES (?, 'local-owner', 'connector', ?, ?, 'owner', ?, ?)`)
      .run('evidence-2', 'calendar-one', 'calendar://one', 1_700, 1_700);
    linkAssertionEvidence(first.id, 'evidence-2', 'supports', 0.8, 2_100);
    expect(getUserAssertion(first.id)).toMatchObject({ supportCount: 2, independentSourceCount: 2, lastSupportedAt: 1_700 });

    const second = reconcileAssertion(candidate({
      predicate: 'routine.focus.morning', cardinality: 'multiple', kind: 'routine',
      normalizedValue: 'morning', value: 'morning', statement: 'Focused work often happens in the morning.',
    }), 2_200).assertion;
    linkUserAssertions({ fromAssertionId: first.id, toAssertionId: second.id, relation: 'supports', confidence: 0.7 });
    expect(db.prepare('SELECT relation FROM user_assertion_edges').get()).toEqual({ relation: 'supports' });

    const observation = recordUserModelObservation({
      domain: 'behavior', type: 'focus_window', subject: { type: 'user', id: 'self' },
      value: { period: 'morning' }, context: { source: 'calendar' }, sensitivityCategories: [],
      ownerAttribution: 'user', observedAt: 1_700, sourceItemId: 'event-1',
    });
    expect(listUserModelObservations({ domain: 'behavior' })).toEqual([observation]);
    expect(deleteUserAssertion(first.id)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM user_assertion_edges').get()).toEqual({ count: 0 });
  });

});
