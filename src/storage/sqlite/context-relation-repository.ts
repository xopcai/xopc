import { randomUUID } from 'node:crypto';

import type { ContextObjectType } from './context-extraction-repository.js';
import { getSqliteDatabase } from './transaction.js';

export type ContextObjectRelation = {
  id: string;
  subjectType: ContextObjectType;
  subjectId: string;
  subjectVersionId?: string;
  predicate: 'supersedes' | 'supports' | 'contradicts' | 'related_to';
  objectType: ContextObjectType;
  objectId: string;
  objectVersionId?: string;
  factual: boolean;
  extractionRunId?: string;
  createdAt: number;
};

export type ContextTemporalAssertion = {
  id: string;
  objectType: 'focus' | 'understanding';
  objectId: string;
  objectVersionId?: string;
  assertionType: 'current_state' | 'routine' | 'relationship' | 'project_status';
  value: Record<string, unknown>;
  confidence: number;
  validFrom?: number;
  validTo?: number;
  status: 'candidate' | 'active' | 'closed' | 'rejected';
  extractionRunId?: string;
  createdAt: number;
  updatedAt: number;
};

type RelationRow = {
  relation_id: string; subject_type: ContextObjectType; subject_id: string; subject_version_id: string | null;
  predicate: ContextObjectRelation['predicate']; object_type: ContextObjectType; object_id: string;
  object_version_id: string | null; factual: number; extraction_run_id: string | null; created_at: number;
};

type AssertionRow = {
  assertion_id: string; object_type: ContextTemporalAssertion['objectType']; object_id: string;
  object_version_id: string | null; assertion_type: ContextTemporalAssertion['assertionType']; value_json: string;
  confidence: number; valid_from: number | null; valid_to: number | null;
  status: ContextTemporalAssertion['status']; extraction_run_id: string | null; created_at: number; updated_at: number;
};

function relationFromRow(row: RelationRow): ContextObjectRelation {
  return {
    id: row.relation_id, subjectType: row.subject_type, subjectId: row.subject_id,
    ...(row.subject_version_id ? { subjectVersionId: row.subject_version_id } : {}),
    predicate: row.predicate, objectType: row.object_type, objectId: row.object_id,
    ...(row.object_version_id ? { objectVersionId: row.object_version_id } : {}),
    factual: row.factual === 1,
    ...(row.extraction_run_id ? { extractionRunId: row.extraction_run_id } : {}), createdAt: row.created_at,
  };
}

function assertionFromRow(row: AssertionRow): ContextTemporalAssertion {
  return {
    id: row.assertion_id, objectType: row.object_type, objectId: row.object_id,
    ...(row.object_version_id ? { objectVersionId: row.object_version_id } : {}),
    assertionType: row.assertion_type, value: JSON.parse(row.value_json) as Record<string, unknown>,
    confidence: row.confidence, ...(row.valid_from == null ? {} : { validFrom: row.valid_from }),
    ...(row.valid_to == null ? {} : { validTo: row.valid_to }), status: row.status,
    ...(row.extraction_run_id ? { extractionRunId: row.extraction_run_id } : {}),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function linkContextObjects(input: Omit<ContextObjectRelation, 'id' | 'createdAt'> & { nowMs?: number }): ContextObjectRelation {
  const now = input.nowMs ?? Date.now();
  const factual = input.predicate !== 'related_to';
  getSqliteDatabase().prepare(`INSERT INTO context_object_relations (
    relation_id, subject_type, subject_id, subject_version_id, predicate,
    object_type, object_id, object_version_id, factual, extraction_run_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT DO UPDATE SET factual = excluded.factual, extraction_run_id = excluded.extraction_run_id`)
    .run(randomUUID(), input.subjectType, input.subjectId, input.subjectVersionId ?? null, input.predicate,
      input.objectType, input.objectId, input.objectVersionId ?? null, factual ? 1 : 0,
      input.extractionRunId ?? null, now);
  const row = getSqliteDatabase().prepare(`SELECT * FROM context_object_relations
    WHERE subject_type = ? AND subject_id = ? AND COALESCE(subject_version_id, '') = COALESCE(?, '')
      AND predicate = ? AND object_type = ? AND object_id = ?
      AND COALESCE(object_version_id, '') = COALESCE(?, '')`)
    .get(input.subjectType, input.subjectId, input.subjectVersionId ?? null, input.predicate,
      input.objectType, input.objectId, input.objectVersionId ?? null) as RelationRow;
  return relationFromRow(row);
}

export function listContextObjectRelations(input: {
  objectType?: ContextObjectType;
  objectId?: string;
  extractionRunId?: string;
} = {}): ContextObjectRelation[] {
  const clauses: string[] = [];
  const values: string[] = [];
  if (input.objectType && input.objectId) {
    clauses.push('((subject_type = ? AND subject_id = ?) OR (object_type = ? AND object_id = ?))');
    values.push(input.objectType, input.objectId, input.objectType, input.objectId);
  }
  if (input.extractionRunId) { clauses.push('extraction_run_id = ?'); values.push(input.extractionRunId); }
  return (getSqliteDatabase().prepare(`SELECT * FROM context_object_relations
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC`)
    .all(...values) as unknown as RelationRow[]).map(relationFromRow);
}

export function createTemporalAssertion(input: Omit<ContextTemporalAssertion, 'id' | 'createdAt' | 'updatedAt'> & {
  nowMs?: number;
}): ContextTemporalAssertion {
  const now = input.nowMs ?? Date.now();
  const id = randomUUID();
  getSqliteDatabase().prepare(`INSERT INTO context_temporal_assertions (
    assertion_id, object_type, object_id, object_version_id, assertion_type, value_json,
    confidence, valid_from, valid_to, status, extraction_run_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.objectType, input.objectId, input.objectVersionId ?? null, input.assertionType,
      JSON.stringify(input.value), input.confidence, input.validFrom ?? null, input.validTo ?? null,
      input.status, input.extractionRunId ?? null, now, now);
  return assertionFromRow(getSqliteDatabase().prepare('SELECT * FROM context_temporal_assertions WHERE assertion_id = ?')
    .get(id) as AssertionRow);
}

export function closeTemporalAssertions(input: {
  objectType: ContextTemporalAssertion['objectType'];
  objectId: string;
  validTo?: number;
}): number {
  const now = input.validTo ?? Date.now();
  return Number(getSqliteDatabase().prepare(`UPDATE context_temporal_assertions
    SET status = 'closed', valid_to = COALESCE(valid_to, ?), updated_at = ?
    WHERE object_type = ? AND object_id = ? AND status = 'active'`)
    .run(now, now, input.objectType, input.objectId).changes);
}

export function listTemporalAssertions(input: {
  objectType?: ContextTemporalAssertion['objectType']; objectId?: string; status?: ContextTemporalAssertion['status'];
} = {}): ContextTemporalAssertion[] {
  const clauses: string[] = [];
  const values: string[] = [];
  if (input.objectType) { clauses.push('object_type = ?'); values.push(input.objectType); }
  if (input.objectId) { clauses.push('object_id = ?'); values.push(input.objectId); }
  if (input.status) { clauses.push('status = ?'); values.push(input.status); }
  return (getSqliteDatabase().prepare(`SELECT * FROM context_temporal_assertions
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC`)
    .all(...values) as unknown as AssertionRow[]).map(assertionFromRow);
}
