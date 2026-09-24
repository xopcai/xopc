import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { clearMemoryAudit, isMemorySuppressed, memoryFingerprint, restoreMemory, suppressMemory } from '../user-context/memory-suppression.js';
import {
  USER_MODEL_PRINCIPAL_ID,
  defaultAssertionDomain,
  defaultAssertionLayer,
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
  domain: UserAssertion['domain'];
  model_layer: UserAssertion['layer'];
  sensitivity_categories_json: string;
  purpose_ids_json: string;
  allowed_uses_json: string;
  allowed_agent_ids_json: string | null;
  consent_receipt_id: string | null;
  support_count: number;
  independent_source_count: number;
  last_supported_at: number | null;
  delete_after: number | null;
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

type AssertionSourceRow = {
  assertion_id: string;
  source_type: 'conversation' | 'connector' | 'user' | 'runtime';
  source_instance_id: string | null;
  source_ref: string;
  observed_at: number;
  grant_adapter_id: string | null;
  grant_display_name: string | null;
  grant_category: UserAssertionSource['category'] | null;
  work_project_id: string | null;
  work_root_path: string | null;
};

export type UserAssertionSource = {
  id: string;
  kind: 'user' | 'conversation' | 'connector' | 'work_folder' | 'local_source' | 'inference';
  label?: string;
  category?: 'files' | 'recent_documents' | 'calendar' | 'tasks' | 'notes' | 'mail' | 'messages' | 'code_activity';
  observedAt: number;
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
    domain: row.domain,
    layer: row.model_layer,
    sensitivityCategories: JSON.parse(row.sensitivity_categories_json),
    purposeIds: JSON.parse(row.purpose_ids_json),
    allowedUses: JSON.parse(row.allowed_uses_json),
    ...(row.allowed_agent_ids_json === null ? {} : { allowedAgentIds: JSON.parse(row.allowed_agent_ids_json) }),
    ...(row.consent_receipt_id === null ? {} : { consentReceiptId: row.consent_receipt_id }),
    supportCount: row.support_count,
    independentSourceCount: row.independent_source_count,
    ...(row.last_supported_at === null ? {} : { lastSupportedAt: row.last_supported_at }),
    ...(row.delete_after === null ? {} : { deleteAfter: row.delete_after }),
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

function assertConsentAllowsCandidate(
  db: DatabaseSync,
  candidate: AssertionCandidate,
  domain: UserAssertion['domain'],
): void {
  if (!candidate.consentReceiptId) return;
  const row = db.prepare(`SELECT purposes_json, allowed_domains_json, denied_domains_json,
      allowed_agent_ids_json, revoked_at
    FROM understanding_consent_receipts WHERE receipt_id = ?`).get(candidate.consentReceiptId) as {
      purposes_json: string; allowed_domains_json: string; denied_domains_json: string;
      allowed_agent_ids_json: string | null; revoked_at: number | null;
    } | undefined;
  if (!row || row.revoked_at !== null) throw new Error('Assertion consent receipt is unavailable or revoked.');
  const purposes = JSON.parse(row.purposes_json) as string[];
  const allowedDomains = JSON.parse(row.allowed_domains_json) as string[];
  const deniedDomains = JSON.parse(row.denied_domains_json) as string[];
  const requestedPurposes = candidate.purposeIds ?? ['personalization'];
  if (!allowedDomains.includes(domain) || deniedDomains.includes(domain)) {
    throw new Error(`Consent does not allow the ${domain} domain.`);
  }
  if (requestedPurposes.some((purpose) => !purposes.includes(purpose))) {
    throw new Error('Consent does not allow every requested purpose.');
  }
  if (row.allowed_agent_ids_json) {
    const allowedAgents = JSON.parse(row.allowed_agent_ids_json) as string[];
    if (!candidate.allowedAgentIds
      || candidate.allowedAgentIds.some((agentId) => !allowedAgents.includes(agentId))) {
      throw new Error('Consent does not allow every requested agent.');
    }
  }
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
  const domain = candidate.domain ?? defaultAssertionDomain(candidate.kind);
  const layer = candidate.layer ?? defaultAssertionLayer(candidate);
  db.prepare(`INSERT INTO user_assertions (
    assertion_id, slot_id, kind, value_json, normalized_value, statement, authority, status,
    confidence, declared_importance, inferred_importance, consequence, actionability,
    volatility, sensitivity, disclosure_policy, applicability_json, valid_from, valid_to,
    observed_at, recorded_at, review_at, supersedes_assertion_id, created_by, created_at,
    domain, model_layer, sensitivity_categories_json, purpose_ids_json, allowed_uses_json,
    allowed_agent_ids_json, consent_receipt_id, delete_after
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, slotId, candidate.kind, JSON.stringify(candidate.value), candidate.normalizedValue.trim(),
      candidate.statement.trim(), candidate.authority, status, candidate.confidence,
      candidate.declaredImportance ?? null, candidate.inferredImportance, candidate.consequence,
      candidate.actionability, candidate.volatility, candidate.sensitivity, candidate.disclosurePolicy,
      JSON.stringify(candidate.applicability ?? {}),
      candidate.validFrom ?? null, candidate.validTo ?? null, candidate.observedAt, now, reviewAt,
      supersedesAssertionId ?? null, candidate.createdBy, now,
      domain, layer, JSON.stringify(candidate.sensitivityCategories ?? []),
      JSON.stringify(candidate.purposeIds ?? ['personalization']),
      JSON.stringify(candidate.allowedUses ?? ['answer', 'rank', 'recommend']),
      candidate.allowedAgentIds ? JSON.stringify(candidate.allowedAgentIds) : null,
      candidate.consentReceiptId ?? null, candidate.deleteAfter ?? null);
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
    refreshEvidenceStats(db, id);
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
  refreshEvidenceStats(db, assertionId);
}

function refreshEvidenceStats(db: DatabaseSync, assertionId: string): void {
  db.prepare(`UPDATE user_assertions SET
    support_count = (
      SELECT COUNT(*) FROM user_assertion_evidence evidence
      WHERE evidence.assertion_id = user_assertions.assertion_id AND evidence.relation = 'supports'
    ),
    independent_source_count = (
      SELECT COUNT(DISTINCT COALESCE(context.source_instance_id, context.source_type || ':' || context.source_ref))
      FROM user_assertion_evidence evidence
      JOIN context_evidence context ON context.evidence_id = evidence.evidence_id
      WHERE evidence.assertion_id = user_assertions.assertion_id AND evidence.relation = 'supports'
    ),
    last_supported_at = (
      SELECT MAX(context.observed_at)
      FROM user_assertion_evidence evidence
      JOIN context_evidence context ON context.evidence_id = evidence.evidence_id
      WHERE evidence.assertion_id = user_assertions.assertion_id AND evidence.relation = 'supports'
    )
    WHERE assertion_id = ?`).run(assertionId);
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

function requiresExplicitSensitiveConsent(candidate: AssertionCandidate): boolean {
  const domain = candidate.domain ?? defaultAssertionDomain(candidate.kind);
  return candidate.sensitivity !== 'normal'
    || Boolean(candidate.sensitivityCategories?.length)
    || domain === 'health';
}

export function reconcileAssertion(candidate: AssertionCandidate, now = Date.now(), options: { restoreDeleted?: boolean } = {}): ReconciliationResult {
  validateCandidate(candidate);
  return runSqliteWriteTransaction((db) => {
    if (candidate.authority !== 'user_explicit' && requiresExplicitSensitiveConsent(candidate)) {
      return { action: 'suppressed' };
    }
    assertConsentAllowsCandidate(db, candidate, candidate.domain ?? defaultAssertionDomain(candidate.kind));
    const keys = assertionFingerprints(candidate);
    if (options.restoreDeleted && candidate.authority === 'user_explicit') restoreMemory(db, keys);
    if (isMemorySuppressed(db, keys)) return { action: 'suppressed' };
    const slot = findOrCreateSlot(db, candidate, now);
    const existing = listReconcilableAssertions(db, slot.id);

    if (candidate.correctionOfAssertionId) {
      if (candidate.authority !== 'user_explicit') {
        throw new Error('Only an explicit user assertion can correct an existing assertion.');
      }
      const target = existing.find((item) => item.id === candidate.correctionOfAssertionId);
      if (!target) throw new Error('Correction target does not belong to the resolved assertion slot.');
      if (target.normalizedValue === candidate.normalizedValue.trim()) {
        db.prepare("UPDATE user_assertions SET statement = ?, authority = 'user_explicit', confidence = 1, status = 'active', observed_at = ?, review_at = ? WHERE assertion_id = ?")
          .run(candidate.statement.trim(), candidate.observedAt, defaultReviewAt(candidate.volatility, candidate.observedAt) ?? null, target.id);
        db.prepare('UPDATE user_assertions_fts SET statement = ? WHERE assertion_id = ?').run(candidate.statement.trim(), target.id);
        attachEvidence(db, target.id, candidate, now);
        return { action: 'deduplicated', assertion: getUserAssertion(target.id)! };
      }
      if (slot.cardinality === 'multiple') {
        suppressMemory(db, assertionFingerprints({ ...target, ...slot }), now);
      }
      const assertion = insertAssertion(db, slot.id, candidate, 'active', now, target.id);
      closeValidity(db, target, candidate.observedAt, now);
      updateStatus(db, target, 'archived', 'Replaced by user correction.', now);
      return { action: 'superseded', assertion, previousAssertion: getUserAssertion(target.id)! };
    }

    const overlapping = sortByAuthorityAndRecorded(
      existing.filter((item) => intervalsOverlap(item, candidate)),
    );
    const duplicate = overlapping.find((item) =>
      item.normalizedValue === candidate.normalizedValue.trim());
    if (duplicate) {
      refreshSupportingObservation(db, duplicate, candidate, now);
      if (candidate.authority === 'user_explicit' && (duplicate.authority !== 'user_explicit'
        || candidate.observedAt > duplicate.observedAt)) {
        db.prepare("UPDATE user_assertions SET authority = 'user_explicit', confidence = ?, status = ?, observed_at = ?, review_at = ? WHERE assertion_id = ?")
          .run(candidate.confidence, initialStatus(candidate), candidate.observedAt,
            candidate.reviewAt ?? defaultReviewAt(candidate.volatility, candidate.observedAt) ?? null, duplicate.id);
      }
      attachEvidence(db, duplicate.id, candidate, now);
      return { action: 'deduplicated', assertion: getUserAssertion(duplicate.id)! };
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
    if ((candidate.volatility === 'dynamic' || candidate.volatility === 'event')
      && candidate.observedAt > current.observedAt
      && authorityRank(candidate.authority) >= authorityRank(current.authority)) {
      const assertion = insertAssertion(db, slot.id, candidate, status, now, current.id);
      closeValidity(db, current, candidate.validFrom ?? candidate.observedAt, now);
      updateStatus(db, current, 'archived', 'Replaced by a newer time-varying observation.', now);
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

export function listUserAssertionSources(assertionIds: string[]): Map<string, UserAssertionSource[]> {
  const uniqueIds = [...new Set(assertionIds.filter(Boolean))];
  const result = new Map<string, UserAssertionSource[]>();
  if (!uniqueIds.length) return result;
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = getSqliteDatabase().prepare(`
    SELECT ae.assertion_id, e.source_type, e.source_instance_id, e.source_ref, e.observed_at,
      g.adapter_id AS grant_adapter_id, g.display_name AS grant_display_name,
      g.category AS grant_category, w.project_id AS work_project_id, w.root_path AS work_root_path
    FROM user_assertion_evidence ae
    JOIN context_evidence e ON e.evidence_id = ae.evidence_id
    LEFT JOIN understanding_source_grants g
      ON e.source_ref LIKE ('understanding-source-grant:' || g.grant_id || ':%')
      OR (e.source_type = 'connector' AND e.source_instance_id IS NOT NULL
        AND json_extract(g.config_json, '$.sourceInstanceId') = e.source_instance_id)
    LEFT JOIN work_discovery_runs w
      ON e.source_ref LIKE ('work-discovery:' || w.id || ':%')
    WHERE ae.assertion_id IN (${placeholders}) AND ae.relation = 'supports'
    ORDER BY e.observed_at DESC
  `).all(...uniqueIds) as unknown as AssertionSourceRow[];
  const rowsByAssertion = new Map<string, AssertionSourceRow[]>();
  for (const row of rows) {
    rowsByAssertion.set(row.assertion_id, [...(rowsByAssertion.get(row.assertion_id) ?? []), row]);
  }
  for (const assertionId of uniqueIds) {
    const assertionRows = rowsByAssertion.get(assertionId) ?? [];
    const hasSpecificUnderstandingSource = assertionRows.some((row) => row.grant_adapter_id || row.work_root_path);
    const sources = new Map<string, UserAssertionSource>();
    for (const row of assertionRows) {
      let source: UserAssertionSource;
      if (row.grant_adapter_id === 'local-work-folders') {
        source = {
          id: `work-folder:${row.grant_display_name ?? row.grant_adapter_id}`,
          kind: 'work_folder',
          label: row.grant_display_name ?? row.grant_adapter_id,
          category: 'files',
          observedAt: row.observed_at,
        };
      } else if (row.grant_adapter_id?.startsWith('connector:')) {
        source = {
          id: row.grant_adapter_id,
          kind: 'connector',
          label: row.grant_display_name ?? row.grant_adapter_id.slice('connector:'.length),
          ...(row.grant_category ? { category: row.grant_category } : {}),
          observedAt: row.observed_at,
        };
      } else if (row.grant_adapter_id) {
        source = {
          id: `source:${row.grant_adapter_id}`,
          kind: 'local_source',
          label: row.grant_display_name ?? row.grant_adapter_id,
          ...(row.grant_category ? { category: row.grant_category } : {}),
          observedAt: row.observed_at,
        };
      } else if (row.work_root_path) {
        source = {
          id: `work-folder:${row.work_project_id ?? basename(row.work_root_path)}`,
          kind: 'work_folder',
          label: basename(row.work_root_path),
          category: 'files',
          observedAt: row.observed_at,
        };
      } else if (row.source_type === 'user') {
        source = { id: 'user', kind: 'user', observedAt: row.observed_at };
      } else if (row.source_type === 'conversation') {
        source = { id: 'conversation', kind: 'conversation', observedAt: row.observed_at };
      } else if (row.source_type === 'connector') {
        source = {
          id: `connector:${row.source_instance_id ?? row.source_ref.split(':', 1)[0]}`,
          kind: 'connector',
          ...(row.source_instance_id ? { label: row.source_instance_id } : {}),
          observedAt: row.observed_at,
        };
      } else {
        if (hasSpecificUnderstandingSource && row.source_ref.startsWith('understanding-source:onboarding:')) continue;
        source = { id: 'inference', kind: 'inference', observedAt: row.observed_at };
      }
      const existing = sources.get(source.id);
      if (!existing || existing.observedAt < source.observedAt) sources.set(source.id, source);
    }
    result.set(assertionId, [...sources.values()]);
  }
  return result;
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
  runSqliteWriteTransaction((db) => {
    db.prepare(`INSERT INTO user_assertion_evidence (
      assertion_id, evidence_id, relation, confidence, created_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(assertion_id, evidence_id, relation) DO UPDATE SET confidence = excluded.confidence`)
      .run(assertionId, evidenceId, relation, confidence, now);
    refreshEvidenceStats(db, assertionId);
  });
}

export function mergeAssertionObservation(input: {
  assertionId: string;
  candidate: AssertionCandidate;
  evidenceIds: string[];
}, now = Date.now()): UserAssertion {
  validateCandidate(input.candidate);
  return runSqliteWriteTransaction((db) => {
    const current = getUserAssertion(input.assertionId);
    if (!current || current.status === 'archived' || current.status === 'rejected') {
      throw new Error(`User assertion is not available for merge: ${input.assertionId}`);
    }
    const slot = getAssertionSlot(current.slotId);
    const principalId = input.candidate.principalId ?? USER_MODEL_PRINCIPAL_ID;
    if (!slot || slot.principalId !== principalId
      || slot.subject.type !== input.candidate.subject.type
      || slot.subject.id !== input.candidate.subject.id.trim()
      || slot.scope.type !== input.candidate.scope.type
      || (slot.scope.id ?? '') !== (input.candidate.scope.id?.trim() ?? '')) {
      throw new Error('Merge target does not match the candidate subject and scope.');
    }
    if (input.candidate.authority !== 'user_explicit' && requiresExplicitSensitiveConsent(input.candidate)) {
      throw new Error('Sensitive inferred understanding cannot be merged automatically.');
    }
    assertConsentAllowsCandidate(
      db,
      input.candidate,
      input.candidate.domain ?? defaultAssertionDomain(input.candidate.kind),
    );
    const observedAt = Math.max(current.observedAt, input.candidate.observedAt);
    const reviewAt = input.candidate.reviewAt
      ?? defaultReviewAt(current.volatility, observedAt)
      ?? null;
    let status: AssertionStatus = current.status;
    let authority = current.authority;
    let confidence = current.confidence;
    if (input.candidate.authority === 'user_explicit') {
      authority = 'user_explicit';
      confidence = input.candidate.confidence;
      status = initialStatus(input.candidate);
    } else if (current.status === 'stale'
      && (current.validTo === undefined || current.validTo >= now)) {
      status = 'candidate';
    }
    db.prepare(`UPDATE user_assertions
      SET authority = ?, status = ?, confidence = ?, observed_at = ?, review_at = ?
      WHERE assertion_id = ?`)
      .run(authority, status, confidence, observedAt, reviewAt, current.id);
    const insertEvidence = db.prepare(`INSERT INTO user_assertion_evidence (
      assertion_id, evidence_id, relation, confidence, created_at
    ) VALUES (?, ?, 'supports', ?, ?)
    ON CONFLICT(assertion_id, evidence_id, relation) DO UPDATE SET confidence = excluded.confidence`);
    for (const evidenceId of new Set(input.evidenceIds)) {
      insertEvidence.run(current.id, evidenceId, input.candidate.confidence, now);
    }
    refreshEvidenceStats(db, current.id);
    if (status !== current.status) {
      recordStatusEvent(db, current.id, current.status, status, 'runtime',
        'Fresh evidence merged into this understanding.', now);
    }
    return getUserAssertion(current.id)!;
  });
}

export function setAssertionStatus(
  assertionId: string,
  status: AssertionStatus,
  input: { actor: 'user' | 'runtime' | 'maintenance' | 'migration'; reason: string; now?: number },
): UserAssertion {
  const current = getUserAssertion(assertionId);
  if (!current) throw new Error(`User assertion not found: ${assertionId}`);
  if (current.status === status && !(status === 'active' && input.actor === 'user' && current.authority !== 'user_explicit')) return current;
  const now = input.now ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare('UPDATE user_assertions SET status = ? WHERE assertion_id = ?').run(status, assertionId);
    if ((status === 'rejected' || status === 'archived') && input.actor === 'user') {
      const slot = getAssertionSlot(current.slotId)!;
      suppressMemory(db, assertionFingerprints({ ...current, ...slot }), now);
    }
    if (status === 'active' && input.actor === 'user') {
      db.prepare("UPDATE user_assertions SET authority = 'user_explicit', confidence = 1 WHERE assertion_id = ?").run(assertionId);
    }
    recordStatusEvent(db, assertionId, current.status, status, input.actor, input.reason, now);
  });
  return getUserAssertion(assertionId)!;
}

function assertionFingerprints(candidate: Pick<AssertionCandidate, 'principalId' | 'subject' | 'scope' | 'predicate' | 'cardinality' | 'normalizedValue' | 'statement'>): string[] {
  const principal = candidate.principalId ?? USER_MODEL_PRINCIPAL_ID;
  const scope = [principal, candidate.scope.type, candidate.scope.id ?? ''];
  return [
    memoryFingerprint(['assertion-slot', ...scope, candidate.subject.type, candidate.subject.id,
      candidate.predicate, candidate.cardinality === 'single' ? '' : candidate.normalizedValue]),
    memoryFingerprint(['assertion-content', ...scope, candidate.statement]),
  ];
}

export function deleteUserAssertion(id: string, now = Date.now()): boolean {
  return runSqliteWriteTransaction((db) => {
    const current = getUserAssertion(id);
    if (!current) return false;
    const slot = getAssertionSlot(current.slotId)!;
    const rows = db.prepare(`WITH RECURSIVE versions(id) AS (
      SELECT ? UNION SELECT a.assertion_id FROM user_assertions a JOIN versions v
      ON a.supersedes_assertion_id = v.id OR a.assertion_id = (
        SELECT supersedes_assertion_id FROM user_assertions WHERE assertion_id = v.id)
    ) SELECT * FROM user_assertions WHERE assertion_id IN (SELECT id FROM versions)
      OR (? = 'single' AND slot_id = ?)`)
      .all(id, slot.cardinality, slot.id) as AssertionRow[];
    const evidenceIds = new Set(rows.flatMap((row) => (db.prepare(
      'SELECT evidence_id FROM user_assertion_evidence WHERE assertion_id = ?',
    ).all(row.assertion_id) as Array<{ evidence_id: string }>).map((evidence) => evidence.evidence_id)));
    for (const row of rows) {
      const assertion = assertionFromRow(row);
      suppressMemory(db, assertionFingerprints({ ...assertion, ...slot, principalId: slot.principalId }), now);
      clearMemoryAudit(db, 'assertion', assertion.id);
      db.prepare('DELETE FROM user_assertions_fts WHERE assertion_id = ?').run(assertion.id);
      db.prepare(`UPDATE work_discovery_runs SET result_json = json_set(result_json, '$.profileCandidates',
        json((SELECT COALESCE(json_group_array(json(value)), '[]')
          FROM json_each(result_json, '$.profileCandidates')
          WHERE COALESCE(json_extract(value, '$.assertionId'), '') != ?)))
        WHERE EXISTS (SELECT 1 FROM json_each(result_json, '$.profileCandidates')
          WHERE json_extract(value, '$.assertionId') = ?)`).run(assertion.id, assertion.id);

    }
    for (const row of rows) db.prepare('DELETE FROM user_assertions WHERE assertion_id = ?').run(row.assertion_id);
    for (const evidenceId of evidenceIds) {
      db.prepare(`UPDATE context_evidence SET redacted_excerpt = NULL WHERE evidence_id = ?
        AND NOT EXISTS (SELECT 1 FROM user_assertion_evidence WHERE evidence_id = ?)`).run(evidenceId, evidenceId);
    }
    db.prepare(`DELETE FROM user_assertion_slots WHERE slot_id = ?
      AND NOT EXISTS (SELECT 1 FROM user_assertions WHERE slot_id = ?)`).run(slot.id, slot.id);
    return true;
  });
}

function refreshSupportingObservation(db: DatabaseSync, current: UserAssertion, candidate: AssertionCandidate, now: number): void {
  if (!candidate.evidenceId || current.authority === 'user_explicit'
    || !['active', 'candidate', 'stale'].includes(current.status)) return;
  const evidence = db.prepare(`SELECT observed_at FROM context_evidence WHERE evidence_id = ?
    AND trust_level = 'owner' AND source_type IN ('conversation', 'user', 'connector')`)
    .get(candidate.evidenceId) as { observed_at: number } | undefined;
  if (!evidence || evidence.observed_at <= current.observedAt || evidence.observed_at > now
    || candidate.confidence < 0.7) return;
  const reviewAt = defaultReviewAt(current.volatility, evidence.observed_at);
  db.prepare(`UPDATE user_assertions SET observed_at = ?, review_at = ? WHERE assertion_id = ?`)
    .run(evidence.observed_at, reviewAt ?? null, current.id);
  if (current.status === 'stale' && (current.validTo === undefined || current.validTo >= now)) {
    updateStatus(db, current, 'candidate', 'Fresh source evidence supports this understanding.', now);
  }
}
