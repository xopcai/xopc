import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import {
  USER_MODEL_PRINCIPAL_ID,
  validateCandidate,
  validateScope,
  type AssertionCandidate,
  type AssertionSlot,
  type AssertionStatus,
  type ReconciliationResult,
  type UserAssertion,
} from './domain.js';
import { defaultReviewAt, requiresBoundedValidity } from './temporal.js';

type SlotRow = {
  slot_id: string;
  principal_id: string;
  subject_type: AssertionSlot['subject']['type'];
  subject_id: string;
  predicate: string;
  cardinality: AssertionSlot['cardinality'];
  scope_type: AssertionSlot['scope']['type'];
  scope_id: string | null;
  created_at: number;
};

type AssertionRow = {
  assertion_id: string;
  slot_id: string;
  kind: UserAssertion['kind'];
  value_json: string;
  normalized_value: string;
  statement: string;
  authority: UserAssertion['authority'];
  status: UserAssertion['status'];
  confidence: number;
  declared_importance: number | null;
  inferred_importance: number;
  consequence: UserAssertion['consequence'];
  actionability: number;
  volatility: UserAssertion['volatility'];
  sensitivity: UserAssertion['sensitivity'];
  disclosure_policy: UserAssertion['disclosurePolicy'];
  applicability_json: string;
  valid_from: number | null;
  valid_to: number | null;
  observed_at: number;
  recorded_at: number;
  review_at: number | null;
  supersedes_assertion_id: string | null;
  created_by: UserAssertion['createdBy'];
  created_at: number;
};

function slotFromRow(row: SlotRow): AssertionSlot {
  return {
    id: row.slot_id,
    principalId: row.principal_id,
    subject: { type: row.subject_type, id: row.subject_id },
    predicate: row.predicate,
    cardinality: row.cardinality,
    scope: { type: row.scope_type, ...(row.scope_id ? { id: row.scope_id } : {}) },
    createdAt: row.created_at,
  };
}

function assertionFromRow(row: AssertionRow): UserAssertion {
  return {
    id: row.assertion_id,
    slotId: row.slot_id,
    kind: row.kind,
    value: JSON.parse(row.value_json),
    normalizedValue: row.normalized_value,
    statement: row.statement,
    authority: row.authority,
    status: row.status,
    confidence: row.confidence,
    ...(row.declared_importance === null ? {} : { declaredImportance: row.declared_importance }),
    inferredImportance: row.inferred_importance,
    consequence: row.consequence,
    actionability: row.actionability,
    volatility: row.volatility,
    sensitivity: row.sensitivity,
    disclosurePolicy: row.disclosure_policy,
    applicability: JSON.parse(row.applicability_json),
    ...(row.valid_from === null ? {} : { validFrom: row.valid_from }),
    ...(row.valid_to === null ? {} : { validTo: row.valid_to }),
    observedAt: row.observed_at,
    recordedAt: row.recorded_at,
    ...(row.review_at === null ? {} : { reviewAt: row.review_at }),
    ...(row.supersedes_assertion_id === null
      ? {}
      : { supersedesAssertionId: row.supersedes_assertion_id }),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function findOrCreateSlot(db: DatabaseSync, candidate: AssertionCandidate, now: number): AssertionSlot {
  const principalId = candidate.principalId ?? USER_MODEL_PRINCIPAL_ID;
  const scopeId = candidate.scope.id?.trim() ?? null;
  const existing = db.prepare(`SELECT * FROM user_assertion_slots
    WHERE principal_id = ? AND subject_type = ? AND subject_id = ? AND predicate = ?
      AND scope_type = ? AND COALESCE(scope_id, '') = COALESCE(?, '')`)
    .get(principalId, candidate.subject.type, candidate.subject.id.trim(), candidate.predicate.trim(),
      candidate.scope.type, scopeId) as SlotRow | undefined;
  if (existing) {
    if (existing.cardinality !== candidate.cardinality) {
      throw new Error(`Assertion slot cardinality mismatch for ${candidate.predicate}.`);
    }
    return slotFromRow(existing);
  }

  const id = randomUUID();
  db.prepare(`INSERT INTO user_assertion_slots (
    slot_id, principal_id, subject_type, subject_id, predicate, cardinality,
    scope_type, scope_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, principalId, candidate.subject.type, candidate.subject.id.trim(),
      candidate.predicate.trim(), candidate.cardinality, candidate.scope.type, scopeId, now);
  return slotFromRow(db.prepare('SELECT * FROM user_assertion_slots WHERE slot_id = ?').get(id) as SlotRow);
}

function intervalsOverlap(left: UserAssertion, candidate: AssertionCandidate): boolean {
  const leftStart = left.validFrom ?? Number.NEGATIVE_INFINITY;
  const leftEnd = left.validTo ?? Number.POSITIVE_INFINITY;
  const rightStart = candidate.validFrom ?? Number.NEGATIVE_INFINITY;
  const rightEnd = candidate.validTo ?? Number.POSITIVE_INFINITY;
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function listReconcilableAssertions(db: DatabaseSync, slotId: string): UserAssertion[] {
  return (db.prepare(`SELECT * FROM user_assertions WHERE slot_id = ?
    AND status NOT IN ('rejected', 'archived') ORDER BY recorded_at DESC`)
    .all(slotId) as AssertionRow[]).map(assertionFromRow);
}

function sortByAuthorityAndRecorded(assertions: UserAssertion[]): UserAssertion[] {
  return assertions.sort((left, right) =>
    authorityRank(right.authority) - authorityRank(left.authority)
    || right.recordedAt - left.recordedAt);
}

function initialStatus(candidate: AssertionCandidate): AssertionStatus {
  if (requiresBoundedValidity(candidate.kind, candidate.volatility) && candidate.validTo === undefined) {
    return 'needs_review';
  }
  return candidate.authority === 'user_explicit' ? 'active' : 'candidate';
}

function insertAssertion(
  db: DatabaseSync,
  slotId: string,
  candidate: AssertionCandidate,
  status: AssertionStatus,
  now: number,
  supersedesAssertionId?: string,
): UserAssertion {
  const id = randomUUID();
  const reviewAt = candidate.reviewAt
    ?? defaultReviewAt(candidate.volatility, candidate.observedAt)
    ?? null;
  db.prepare(`INSERT INTO user_assertions (
    assertion_id, slot_id, kind, value_json, normalized_value, statement, authority, status,
    confidence, declared_importance, inferred_importance, consequence, actionability,
    volatility, sensitivity, disclosure_policy, applicability_json, valid_from, valid_to,
    observed_at, recorded_at, review_at, supersedes_assertion_id, created_by, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, slotId, candidate.kind, JSON.stringify(candidate.value), candidate.normalizedValue.trim(),
      candidate.statement.trim(), candidate.authority, status, candidate.confidence,
      candidate.declaredImportance ?? null, candidate.inferredImportance, candidate.consequence,
      candidate.actionability, candidate.volatility, candidate.sensitivity, candidate.disclosurePolicy,
      JSON.stringify(candidate.applicability ?? {}),
      candidate.validFrom ?? null, candidate.validTo ?? null, candidate.observedAt, now, reviewAt,
      supersedesAssertionId ?? null, candidate.createdBy, now);
  db.prepare(`INSERT INTO user_assertions_fts(statement, assertion_id, slot_id) VALUES (?, ?, ?)`)
    .run(candidate.statement.trim(), id, slotId);
  recordStatusEvent(db, id, null, status, candidate.createdBy === 'connector' ? 'runtime' : candidate.createdBy,
    'Assertion admitted.', now);
  if (candidate.evidenceId) {
    db.prepare(`INSERT INTO user_assertion_evidence (
      assertion_id, evidence_id, relation, confidence, created_at
    ) VALUES (?, ?, 'supports', ?, ?)
    ON CONFLICT(assertion_id, evidence_id, relation) DO UPDATE SET confidence = excluded.confidence`)
      .run(id, candidate.evidenceId, candidate.evidenceConfidence ?? candidate.confidence, now);
  }
  return assertionFromRow(db.prepare('SELECT * FROM user_assertions WHERE assertion_id = ?').get(id) as AssertionRow);
}

function recordStatusEvent(
  db: DatabaseSync,
  assertionId: string,
  fromStatus: AssertionStatus | null,
  toStatus: AssertionStatus,
  actor: 'user' | 'runtime' | 'maintenance' | 'migration',
  reason: string,
  now: number,
): void {
  db.prepare(`INSERT INTO user_assertion_status_events (
    event_id, assertion_id, from_status, to_status, actor_type, reason, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), assertionId, fromStatus, toStatus, actor, reason, now);
}

function attachEvidence(db: DatabaseSync, assertionId: string, candidate: AssertionCandidate, now: number): void {
  if (!candidate.evidenceId) return;
  db.prepare(`INSERT INTO user_assertion_evidence (
    assertion_id, evidence_id, relation, confidence, created_at
  ) VALUES (?, ?, 'supports', ?, ?)
  ON CONFLICT(assertion_id, evidence_id, relation) DO UPDATE SET confidence = excluded.confidence`)
    .run(assertionId, candidate.evidenceId, candidate.evidenceConfidence ?? candidate.confidence, now);
}

function closeValidity(db: DatabaseSync, assertion: UserAssertion, boundary: number, now: number): void {
  if (assertion.validFrom !== undefined && boundary <= assertion.validFrom) {
    updateStatus(db, assertion, 'archived', 'Superseded before its validity began.', now);
    return;
  }
  const end = boundary - 1;
  db.prepare(`UPDATE user_assertions SET valid_to = ?
    WHERE assertion_id = ? AND (valid_to IS NULL OR valid_to >= ?)`)
    .run(end, assertion.id, boundary);
}

function updateStatus(
  db: DatabaseSync,
  assertion: UserAssertion,
  status: AssertionStatus,
  reason: string,
  now: number,
): void {
  if (assertion.status === status) return;
  db.prepare('UPDATE user_assertions SET status = ? WHERE assertion_id = ?').run(status, assertion.id);
  recordStatusEvent(db, assertion.id, assertion.status, status, 'runtime', reason, now);
}

function authorityRank(authority: UserAssertion['authority']): number {
  return ({ external_untrusted: 0, system_inferred: 1, user_observed: 2, user_explicit: 3 })[authority];
}

export function reconcileAssertion(candidate: AssertionCandidate, now = Date.now()): ReconciliationResult {
  validateCandidate(candidate);
  return runSqliteWriteTransaction((db) => {
    const slot = findOrCreateSlot(db, candidate, now);
    const existing = listReconcilableAssertions(db, slot.id);

    if (candidate.correctionOfAssertionId) {
      if (candidate.authority !== 'user_explicit') {
        throw new Error('Only an explicit user assertion can correct an existing assertion.');
      }
      const target = existing.find((item) => item.id === candidate.correctionOfAssertionId);
      if (!target) throw new Error('Correction target does not belong to the resolved assertion slot.');
      if (target.normalizedValue === candidate.normalizedValue.trim()) {
        attachEvidence(db, target.id, candidate, now);
        return { action: 'deduplicated', assertion: target };
      }
      const assertion = insertAssertion(db, slot.id, candidate, 'active', now, target.id);
      closeValidity(db, target, candidate.validFrom ?? candidate.observedAt, now);
      return { action: 'superseded', assertion, previousAssertion: getUserAssertion(target.id)! };
    }

    const overlapping = sortByAuthorityAndRecorded(
      existing.filter((item) => intervalsOverlap(item, candidate)),
    );
    const duplicate = overlapping.find((item) =>
      item.normalizedValue === candidate.normalizedValue.trim());
    if (duplicate) {
      attachEvidence(db, duplicate.id, candidate, now);
      return { action: 'deduplicated', assertion: duplicate };
    }

    const status = initialStatus(candidate);
    if (slot.cardinality === 'multiple' || !overlapping.length) {
      return { action: 'created', assertion: insertAssertion(db, slot.id, candidate, status, now) };
    }

    const current = overlapping[0];
    if (candidate.authority === 'user_explicit'
      && authorityRank(candidate.authority) > authorityRank(current.authority)) {
      const assertion = insertAssertion(db, slot.id, candidate, status, now, current.id);
      closeValidity(db, current, candidate.validFrom ?? candidate.observedAt, now);
      return { action: 'superseded', assertion, previousAssertion: getUserAssertion(current.id)! };
    }

    const assertion = insertAssertion(db, slot.id, candidate,
      candidate.authority === 'user_explicit' ? 'needs_review' : 'conflicted', now);
    if (current.authority !== 'user_explicit' && candidate.authority !== 'user_explicit') {
      updateStatus(db, current, 'conflicted', 'Overlapping assertion has a different value.', now);
    }
    return { action: 'conflicted', assertion, previousAssertion: getUserAssertion(current.id)! };
  });
}

export function getUserAssertion(id: string): UserAssertion | undefined {
  const row = getSqliteDatabase().prepare('SELECT * FROM user_assertions WHERE assertion_id = ?')
    .get(id) as AssertionRow | undefined;
  return row ? assertionFromRow(row) : undefined;
}

export function getAssertionSlot(id: string): AssertionSlot | undefined {
  const row = getSqliteDatabase().prepare('SELECT * FROM user_assertion_slots WHERE slot_id = ?')
    .get(id) as SlotRow | undefined;
  return row ? slotFromRow(row) : undefined;
}

export function listSlotAssertions(slotId: string): UserAssertion[] {
  return (getSqliteDatabase().prepare(`SELECT * FROM user_assertions
    WHERE slot_id = ? ORDER BY recorded_at DESC`).all(slotId) as AssertionRow[]).map(assertionFromRow);
}

export function listUserAssertions(input: {
  principalId?: string;
  statuses?: AssertionStatus[];
  limit?: number;
} = {}): UserAssertion[] {
  const principalId = input.principalId ?? USER_MODEL_PRINCIPAL_ID;
  const statuses = input.statuses ?? ['active', 'candidate', 'needs_review', 'conflicted'];
  if (!statuses.length) return [];
  const placeholders = statuses.map(() => '?').join(', ');
  const limit = Math.max(1, Math.min(2_000, input.limit ?? 200));
  return (getSqliteDatabase().prepare(`SELECT a.* FROM user_assertions a
    JOIN user_assertion_slots s ON s.slot_id = a.slot_id
    WHERE s.principal_id = ? AND a.status IN (${placeholders})
    ORDER BY a.recorded_at DESC LIMIT ?`).all(principalId, ...statuses, limit) as AssertionRow[])
    .map(assertionFromRow);
}

export function getActiveAssertionByPredicate(predicate: string): UserAssertion | undefined {
  const row = getSqliteDatabase().prepare(`SELECT a.* FROM user_assertions a
    JOIN user_assertion_slots s ON s.slot_id = a.slot_id
    WHERE s.principal_id = ? AND s.predicate = ? AND a.status = 'active'
      AND (a.valid_from IS NULL OR a.valid_from <= ?)
      AND (a.valid_to IS NULL OR a.valid_to >= ?)
    ORDER BY CASE a.authority WHEN 'user_explicit' THEN 0 WHEN 'user_observed' THEN 1
      WHEN 'system_inferred' THEN 2 ELSE 3 END, a.recorded_at DESC LIMIT 1`)
    .get(USER_MODEL_PRINCIPAL_ID, predicate, Date.now(), Date.now()) as AssertionRow | undefined;
  return row ? assertionFromRow(row) : undefined;
}

export function getActiveAssertionForSlot(input: {
  subject: AssertionSlot['subject'];
  predicate: string;
  scope: AssertionSlot['scope'];
}): UserAssertion | undefined {
  validateScope(input.scope);
  const row = getSqliteDatabase().prepare(`SELECT a.* FROM user_assertions a
    JOIN user_assertion_slots s ON s.slot_id = a.slot_id
    WHERE s.principal_id = ? AND s.subject_type = ? AND s.subject_id = ?
      AND s.predicate = ? AND s.scope_type = ?
      AND COALESCE(s.scope_id, '') = COALESCE(?, '') AND a.status = 'active'
      AND (a.valid_from IS NULL OR a.valid_from <= ?)
      AND (a.valid_to IS NULL OR a.valid_to >= ?)
    ORDER BY CASE a.authority WHEN 'user_explicit' THEN 0 WHEN 'user_observed' THEN 1
      WHEN 'system_inferred' THEN 2 ELSE 3 END, a.recorded_at DESC LIMIT 1`)
    .get(
      USER_MODEL_PRINCIPAL_ID,
      input.subject.type,
      input.subject.id.trim(),
      input.predicate.trim(),
      input.scope.type,
      input.scope.id?.trim() ?? null,
      Date.now(),
      Date.now(),
    ) as AssertionRow | undefined;
  return row ? assertionFromRow(row) : undefined;
}

export function getUserTimezone(): string | undefined {
  const value = getActiveAssertionByPredicate('preference.timezone')?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function linkAssertionEvidence(
  assertionId: string,
  evidenceId: string,
  relation: 'supports' | 'contradicts' | 'supersedes',
  confidence: number,
  now = Date.now(),
): void {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('Evidence confidence must be between 0 and 1.');
  }
  getSqliteDatabase().prepare(`INSERT INTO user_assertion_evidence (
    assertion_id, evidence_id, relation, confidence, created_at
  ) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(assertion_id, evidence_id, relation) DO UPDATE SET confidence = excluded.confidence`)
    .run(assertionId, evidenceId, relation, confidence, now);
}

export function setAssertionStatus(
  assertionId: string,
  status: AssertionStatus,
  input: { actor: 'user' | 'runtime' | 'maintenance' | 'migration'; reason: string; now?: number },
): UserAssertion {
  const current = getUserAssertion(assertionId);
  if (!current) throw new Error(`User assertion not found: ${assertionId}`);
  if (current.status === status) return current;
  const now = input.now ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare('UPDATE user_assertions SET status = ? WHERE assertion_id = ?').run(status, assertionId);
    recordStatusEvent(db, assertionId, current.status, status, input.actor, input.reason, now);
  });
  return getUserAssertion(assertionId)!;
}
