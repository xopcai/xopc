import { createHash, randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { USER_MODEL_PRINCIPAL_ID, type AssertionSensitivityCategory, type AssertionSubject, type PersonalDomain } from './domain.js';

export interface UserModelObservation {
  id: string;
  principalId: string;
  domain: PersonalDomain;
  type: string;
  subject: AssertionSubject;
  value: unknown;
  context: Record<string, unknown>;
  sensitivityCategories: AssertionSensitivityCategory[];
  ownerAttribution: 'user' | 'other' | 'shared' | 'unknown';
  observedAt: number;
  validTo?: number;
  deleteAfter?: number;
  sourceGrantId?: string;
  sourceItemId?: string;
  evidenceId?: string;
  contentHash: string;
  createdAt: number;
}

type ObservationRow = {
  observation_id: string; principal_id: string; domain: PersonalDomain; observation_type: string;
  subject_type: AssertionSubject['type']; subject_id: string; value_json: string; context_json: string;
  sensitivity_categories_json: string; owner_attribution: UserModelObservation['ownerAttribution'];
  observed_at: number; valid_to: number | null; delete_after: number | null;
  source_grant_id: string | null; source_item_id: string | null; evidence_id: string | null;
  content_hash: string; created_at: number;
};

function fromRow(row: ObservationRow): UserModelObservation {
  return {
    id: row.observation_id, principalId: row.principal_id, domain: row.domain,
    type: row.observation_type, subject: { type: row.subject_type, id: row.subject_id },
    value: JSON.parse(row.value_json), context: JSON.parse(row.context_json),
    sensitivityCategories: JSON.parse(row.sensitivity_categories_json),
    ownerAttribution: row.owner_attribution, observedAt: row.observed_at,
    ...(row.valid_to === null ? {} : { validTo: row.valid_to }),
    ...(row.delete_after === null ? {} : { deleteAfter: row.delete_after }),
    ...(row.source_grant_id === null ? {} : { sourceGrantId: row.source_grant_id }),
    ...(row.source_item_id === null ? {} : { sourceItemId: row.source_item_id }),
    ...(row.evidence_id === null ? {} : { evidenceId: row.evidence_id }),
    contentHash: row.content_hash, createdAt: row.created_at,
  };
}

export function recordUserModelObservation(input: Omit<UserModelObservation, 'id' | 'principalId' | 'contentHash' | 'createdAt'> & {
  principalId?: string;
  contentHash?: string;
  nowMs?: number;
}): UserModelObservation {
  if (!input.type.trim() || !input.subject.id.trim()) {
    throw new Error('Observation type and subject id are required.');
  }
  if (!Number.isFinite(input.observedAt)) throw new Error('Observation observedAt must be finite.');
  const principalId = input.principalId ?? USER_MODEL_PRINCIPAL_ID;
  const contentHash = input.contentHash ?? createHash('sha256').update(JSON.stringify([
    principalId, input.domain, input.type, input.subject, input.value, input.context,
    input.ownerAttribution, input.observedAt, input.sourceGrantId, input.sourceItemId,
  ])).digest('hex');
  const id = randomUUID();
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => db.prepare(`INSERT INTO user_model_observations (
    observation_id, principal_id, domain, observation_type, subject_type, subject_id,
    value_json, context_json, sensitivity_categories_json, owner_attribution, observed_at,
    valid_to, delete_after, source_grant_id, source_item_id, evidence_id, content_hash, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(principal_id, content_hash) DO UPDATE SET
    observed_at = MAX(user_model_observations.observed_at, excluded.observed_at),
    valid_to = excluded.valid_to, delete_after = excluded.delete_after`).run(
    id, principalId, input.domain, input.type.trim(), input.subject.type, input.subject.id.trim(),
    JSON.stringify(input.value), JSON.stringify(input.context), JSON.stringify(input.sensitivityCategories),
    input.ownerAttribution, input.observedAt, input.validTo ?? null, input.deleteAfter ?? null,
    input.sourceGrantId ?? null, input.sourceItemId ?? null, input.evidenceId ?? null, contentHash, now,
  ));
  const row = getSqliteDatabase().prepare(`SELECT * FROM user_model_observations
    WHERE principal_id = ? AND content_hash = ?`).get(principalId, contentHash) as ObservationRow;
  return fromRow(row);
}

export function listUserModelObservations(input: {
  principalId?: string; domain?: PersonalDomain; sourceGrantId?: string; limit?: number;
} = {}): UserModelObservation[] {
  const clauses = ['principal_id = ?'];
  const values: Array<string | number> = [input.principalId ?? USER_MODEL_PRINCIPAL_ID];
  if (input.domain) { clauses.push('domain = ?'); values.push(input.domain); }
  if (input.sourceGrantId) { clauses.push('source_grant_id = ?'); values.push(input.sourceGrantId); }
  values.push(Math.max(1, Math.min(2_000, input.limit ?? 200)));
  return (getSqliteDatabase().prepare(`SELECT * FROM user_model_observations
    WHERE ${clauses.join(' AND ')} ORDER BY observed_at DESC LIMIT ?`).all(...values) as ObservationRow[])
    .map(fromRow);
}

export function deleteUserModelObservationsForGrant(grantId: string): number {
  return Number(getSqliteDatabase().prepare('DELETE FROM user_model_observations WHERE source_grant_id = ?')
    .run(grantId).changes);
}

export type UserAssertionEdgeRelation = 'supports' | 'contradicts' | 'derived_from' | 'specializes';
export interface UserAssertionEdge {
  fromAssertionId: string;
  toAssertionId: string;
  relation: UserAssertionEdgeRelation;
  confidence: number;
  createdAt: number;
}

export function linkUserAssertions(input: {
  fromAssertionId: string; toAssertionId: string; relation: UserAssertionEdgeRelation;
  confidence: number; nowMs?: number;
}): void {
  if (input.fromAssertionId === input.toAssertionId) throw new Error('An assertion cannot link to itself.');
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new Error('Assertion-edge confidence must be between 0 and 1.');
  }
  getSqliteDatabase().prepare(`INSERT INTO user_assertion_edges (
    from_assertion_id, to_assertion_id, relation, confidence, created_at
  ) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(from_assertion_id, to_assertion_id, relation)
  DO UPDATE SET confidence = excluded.confidence`).run(
    input.fromAssertionId, input.toAssertionId, input.relation, input.confidence, input.nowMs ?? Date.now(),
  );
}

export function listUserAssertionEdges(assertionIds?: string[]): UserAssertionEdge[] {
  const ids = [...new Set(assertionIds?.filter(Boolean) ?? [])];
  const where = ids.length
    ? `WHERE from_assertion_id IN (${ids.map(() => '?').join(',')}) OR to_assertion_id IN (${ids.map(() => '?').join(',')})`
    : '';
  const rows = getSqliteDatabase().prepare(`SELECT * FROM user_assertion_edges ${where}
    ORDER BY created_at DESC`).all(...ids, ...ids) as Array<{
      from_assertion_id: string; to_assertion_id: string; relation: UserAssertionEdgeRelation;
      confidence: number; created_at: number;
    }>;
  return rows.map((row) => ({
    fromAssertionId: row.from_assertion_id, toAssertionId: row.to_assertion_id,
    relation: row.relation, confidence: row.confidence, createdAt: row.created_at,
  }));
}
