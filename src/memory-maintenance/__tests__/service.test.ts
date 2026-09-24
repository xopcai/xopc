import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  createContextEvidence,
  getSqliteDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import {
  getUserAssertion,
  listUserModelObservations,
  reconcileAssertion,
  recordUserModelObservation,
  type AssertionCandidate,
} from '../../user-model/index.js';
import { getKnowledgeItem, writeKnowledgeItem } from '../../knowledge-memory/index.js';
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

  it('deletes observations when their consent retention window ends', () => {
    const observation = recordUserModelObservation({
      domain: 'behavior',
      type: 'activity_count',
      subject: { type: 'user', id: 'self' },
      value: { count: 3 },
      context: {},
      sensitivityCategories: [],
      ownerAttribution: 'user',
      observedAt: 100,
      deleteAfter: 200,
      nowMs: 100,
    });

    const result = runMemoryMaintenance({ jobType: 'temporal_sweep', now: 300 });

    expect(result.metrics.expiredObservations).toBe(1);
    expect(listUserModelObservations()).toEqual([]);
    expect(getSqliteDatabase().prepare(`SELECT action, reason FROM memory_maintenance_decisions
      WHERE object_type = 'evidence' AND object_id = ?`).get(observation.id))
      .toMatchObject({ action: 'deleted', reason: 'observation_retention_expired' });
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
  it('quietly retires overdue candidates instead of creating review tasks', () => {
    const item = reconcileAssertion(candidate({ authority: 'system_inferred', reviewAt: 200 }), 150).assertion;
    const result = runMemoryMaintenance({ jobType: 'daily_reconciliation', now: 300 });
    expect(result.metrics.needsReview).toBe(0);
    expect(getUserAssertion(item.id)?.status).toBe('stale');
  });

  it('does not count copied content or repeated source items as independent evidence', () => {
    const item = reconcileAssertion(candidate({ authority: 'system_inferred' }), 150).assertion;
    for (const sourceRef of ['original', 'summary']) {
      const evidence = createContextEvidence({ sourceType: 'connector', sourceRef,
        sourceItemId: 'same-mail', contentHash: 'same-content', trustLevel: 'owner', observedAt: 100 });
      getSqliteDatabase().prepare(`INSERT INTO user_assertion_evidence
        (assertion_id, evidence_id, relation, confidence, created_at) VALUES (?, ?, 'supports', 1, 150)`)
        .run(item.id, evidence.id);
    }
    expect(runMemoryMaintenance({ jobType: 'daily_reconciliation', now: 300 }).metrics.activated).toBe(0);
  });

  it('never promotes sensitive or high-consequence inferences', () => {
    for (const overrides of [{ sensitivity: 'personal' as const }, { consequence: 'critical' as const }]) {
      const item = reconcileAssertion(candidate({ predicate: `test.${Object.keys(overrides)[0]}`,
        authority: 'system_inferred' }), 150).assertion;
      getSqliteDatabase().prepare('UPDATE user_assertions SET sensitivity = ?, consequence = ? WHERE assertion_id = ?')
        .run(overrides.sensitivity ?? 'normal', overrides.consequence ?? 'low', item.id);
      for (const sourceRef of ['one', 'two']) {
        const evidence = createContextEvidence({ sourceType: 'conversation', sourceRef, trustLevel: 'owner', observedAt: 100 });
        getSqliteDatabase().prepare(`INSERT INTO user_assertion_evidence
          (assertion_id, evidence_id, relation, confidence, created_at) VALUES (?, ?, 'supports', 1, 150)`)
          .run(item.id, evidence.id);
      }
    }
    expect(runMemoryMaintenance({ jobType: 'daily_reconciliation', now: 300 }).metrics.activated).toBe(0);
  });

  it('activates existing ordinary work memory without promoting recalled or untrusted content', () => {
    const make = (key: string, overrides = {}) => writeKnowledgeItem({
      kind: 'decision', scope: { type: 'project', id: 'one' }, content: `Atlas ${key}`, canonicalKey: key,
      confidence: 0.8, importance: 0.5, originClass: 'agent', status: 'candidate', ...overrides,
    }).item;
    const safe = make('safe');
    const recalled = make('recalled', { derivedFromRecalledContext: true });
    const untrusted = make('untrusted', { originClass: 'untrusted' });
    runMemoryMaintenance({ jobType: 'daily_reconciliation', now: Date.now() });
    expect(getKnowledgeItem(safe.id)?.status).toBe('active');
    expect(getKnowledgeItem(recalled.id)?.status).toBe('candidate');
    expect(getKnowledgeItem(untrusted.id)?.status).toBe('candidate');
  });

});
