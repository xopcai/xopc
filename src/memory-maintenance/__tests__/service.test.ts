import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  createContextEvidence,
  getSqliteDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { reconcileAssertion, type AssertionCandidate } from '../../user-model/index.js';
import { runMemoryMaintenance } from '../service.js';

function candidate(overrides: Partial<AssertionCandidate> = {}): AssertionCandidate {
  return {
    subject: { type: 'user', id: 'self' },
    predicate: 'routine.work.start',
    cardinality: 'single',
    scope: { type: 'global' },
    kind: 'routine',
    value: '09:00',
    normalizedValue: '09:00',
    statement: 'I start work at 09:00.',
    authority: 'user_explicit',
    confidence: 1,
    inferredImportance: 0.4,
    consequence: 'low',
    actionability: 0.5,
    volatility: 'slow',
    sensitivity: 'normal',
    disclosurePolicy: 'referenceable',
    observedAt: 100,
    createdBy: 'user',
    ...overrides,
  };
}

describe('memory maintenance', () => {
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('expires temporal state once and records the decision', () => {
    const assertion = reconcileAssertion(candidate({ validFrom: 100, validTo: 200 }), 150).assertion;
    const first = runMemoryMaintenance({ jobType: 'temporal_sweep', now: 300 });
    const repeated = runMemoryMaintenance({ jobType: 'temporal_sweep', now: 350 });

    expect(first.metrics.stale).toBe(1);
    expect(repeated).toMatchObject({ skipped: true, runId: first.runId });
    expect(getSqliteDatabase().prepare('SELECT status FROM user_assertions WHERE assertion_id = ?')
      .get(assertion.id)).toMatchObject({ status: 'stale' });
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS count FROM memory_maintenance_decisions')
      .get()).toMatchObject({ count: 1 });
  });

  it('uses the assertion evidence relation as the sole contradiction source', () => {
    const assertion = reconcileAssertion(candidate(), 150).assertion;
    const evidence = createContextEvidence({
      sourceType: 'conversation',
      sourceRef: 'turn:contradiction',
      trustLevel: 'owner',
      observedAt: 200,
    });
    getSqliteDatabase().prepare(`INSERT INTO user_assertion_evidence (
      assertion_id, evidence_id, relation, confidence, created_at
    ) VALUES (?, ?, 'contradicts', 1, 200)`).run(assertion.id, evidence.id);

    const result = runMemoryMaintenance({
      jobType: 'daily_reconciliation',
      now: 300,
      idempotencyKey: 'daily:contradiction',
    });
    expect(result.metrics.needsReview).toBe(1);
    expect(getSqliteDatabase().prepare('SELECT status FROM user_assertions WHERE assertion_id = ?')
      .get(assertion.id)).toMatchObject({ status: 'needs_review' });
  });

  it('promotes an inferred candidate only after two independent owner sources', () => {
    const assertion = reconcileAssertion(candidate({
      authority: 'system_inferred',
      createdBy: 'runtime',
      confidence: 0.7,
    }), 150).assertion;
    for (const sourceRef of ['turn:1', 'turn:2']) {
      const evidence = createContextEvidence({
        sourceType: 'conversation',
        sourceRef,
        trustLevel: 'owner',
        observedAt: 100,
      });
      getSqliteDatabase().prepare(`INSERT INTO user_assertion_evidence (
        assertion_id, evidence_id, relation, confidence, created_at
      ) VALUES (?, ?, 'supports', 0.7, 200)`).run(assertion.id, evidence.id);
    }

    const result = runMemoryMaintenance({
      jobType: 'daily_reconciliation',
      now: 300,
      idempotencyKey: 'daily:promotion',
    });
    expect(result.metrics.activated).toBe(1);
    expect(getSqliteDatabase().prepare('SELECT status FROM user_assertions WHERE assertion_id = ?')
      .get(assertion.id)).toMatchObject({ status: 'active' });
  });

  it('honors the configured independent evidence threshold', () => {
    const assertion = reconcileAssertion(candidate({
      predicate: 'preference.response.structure',
      authority: 'system_inferred',
      createdBy: 'runtime',
      confidence: 0.7,
    }), 150).assertion;
    for (const sourceRef of ['turn:1', 'turn:2']) {
      const evidence = createContextEvidence({
        sourceType: 'conversation', sourceRef, trustLevel: 'owner', observedAt: 100,
      });
      getSqliteDatabase().prepare(`INSERT INTO user_assertion_evidence (
        assertion_id, evidence_id, relation, confidence, created_at
      ) VALUES (?, ?, 'supports', 0.7, 200)`).run(assertion.id, evidence.id);
    }

    const result = runMemoryMaintenance({
      jobType: 'daily_reconciliation',
      now: 300,
      idempotencyKey: 'daily:threshold',
      evidenceThreshold: 3,
    });
    expect(result.metrics.activated).toBe(0);
    expect(getSqliteDatabase().prepare('SELECT status FROM user_assertions WHERE assertion_id = ?')
      .get(assertion.id)).toMatchObject({ status: 'candidate' });
  });
});
