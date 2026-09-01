import { randomUUID } from 'node:crypto';

import type {
  MemoryDisclosurePolicy,
  MemoryDurability,
  MemoryExplicitness,
  MemoryKind,
  MemoryOriginClass,
  MemoryRecord,
  MemorySessionKind,
  MemorySensitivity,
  MemorySearchResult,
  MemorySignal,
  MemoryStatus,
} from '../../agent/memory/types.js';
import { fuseRankedCandidates } from '../../retrieval/candidateFusion.js';
import { buildRetrievalQueryProfile } from '../../retrieval/queryProfile.js';
import { normalizeRetrievalText, retrievalLexicalSimilarity } from '../../retrieval/textFeatures.js';
import { buildFts5SearchQuery } from './fts.js';
import { LOCAL_USER_ID } from '../../user-context/owner.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';
import {
  listMemoryEvidence,
  listMemoryEvidenceForRecords,
  replaceMemoryEvidenceForRecord,
} from './knowledge-repository.js';

type MemoryRecordRow = {
  record_id: string;
  provider_id: string;
  kind: string;
  user_id: string;
  source_agent_id: string;
  workspace_id: string | null;
  session_key: string | null;
  project_id: string | null;
  content: string;
  source_json: string;
  confidence: number | null;
  tags_json: string;
  status: string;
  sensitivity: string;
  canonical_key: string | null;
  explicitness: string;
  durability: string;
  importance: number;
  disclosure_policy: string;
  valid_from: number | null;
  valid_to: number | null;
  review_after: number | null;
  expires_at: number | null;
  supersedes_record_id: string | null;
  conflict_group_id: string | null;
  origin_class: string;
  session_kind: string;
  observed_at: number;
  source_session_id: string | null;
  source_turn_id: string | null;
  supersedes_key: string | null;
  derived_from_recalled_context: number;
  created_at: number;
  updated_at: number;
};

type MemoryRecordSearchRow = MemoryRecordRow & {
  rank: number;
};

export interface UpsertMemoryRecordInput {
  id?: string;
  providerId: string;
  kind: MemoryKind;
  userId?: string;
  sourceAgentId: string;
  workspaceId?: string;
  sessionKey?: string;
  projectId?: string;
  content: string;
  canonicalKey?: string;
  source?: MemoryRecord['source'];
  confidence?: number;
  tags?: string[];
  status?: MemoryStatus;
  sensitivity?: MemorySensitivity;
  explicitness?: MemoryExplicitness;
  durability?: MemoryDurability;
  importance?: number;
  disclosurePolicy?: MemoryDisclosurePolicy;
  evidence?: MemoryRecord['evidence'];
  validFrom?: string;
  validTo?: string;
  reviewAfter?: string;
  expiresAt?: string;
  supersedesRecordId?: string;
  conflictGroupId?: string;
  originClass?: MemoryOriginClass;
  sessionKind?: MemorySessionKind;
  observedAt?: string;
  sourceSessionId?: string;
  sourceTurnId?: string;
  supersedesKey?: string;
  derivedFromRecalledContext?: boolean;
  nowMs?: number;
}

export interface ListMemoryRecordsOptions {
  providerId?: string;
  userId?: string;
  sourceAgentId?: string;
  workspaceId?: string;
  projectId?: string;
  /** Include unscoped records plus records visible to this session. */
  visibleToSessionKey?: string;
  /** Return only records that are not scoped to a session. */
  unscopedSessionOnly?: boolean;
  /** Include unscoped records plus records visible to this project. */
  visibleToProjectId?: string;
  /** Return only records that are not scoped to a project. */
  unscopedProjectOnly?: boolean;
  /** Include global records plus records visible to this workspace. */
  visibleToWorkspaceId?: string;
  /** Return only records that are not scoped to a workspace. */
  unscopedWorkspaceOnly?: boolean;
  kind?: MemoryKind;
  status?: MemoryStatus;
  canonicalKey?: string;
  limit?: number;
  offset?: number;
}

export interface SearchMemoryRecordsOptions {
  query: string;
  userId?: string;
  sourceAgentId?: string;
  workspaceId?: string;
  projectId?: string;
  /** Include unscoped records plus records visible to this session. */
  visibleToSessionKey?: string;
  /** Return only records that are not scoped to a session. */
  unscopedSessionOnly?: boolean;
  /** Include unscoped records plus records visible to this project. */
  visibleToProjectId?: string;
  /** Return only records that are not scoped to a project. */
  unscopedProjectOnly?: boolean;
  visibleToWorkspaceId?: string;
  unscopedWorkspaceOnly?: boolean;
  providerId?: string;
  kinds?: MemoryKind[];
  statuses?: MemoryStatus[];
  maxResults?: number;
  minScore?: number;
  trustedOnly?: boolean;
}

export interface AppendMemorySignalInput {
  signal: MemorySignal;
  providerId?: string;
  userId?: string;
  sourceAgentId?: string;
  workspaceId?: string;
  sessionKey?: string;
  nowMs?: number;
}

export interface MemorySignalRowPayload {
  signalId: string;
  source: string;
  recordId?: string;
  providerId?: string;
  userId?: string;
  sourceAgentId?: string;
  workspaceId?: string;
  sessionKey?: string;
  score?: number;
  content?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

type MemorySignalRow = {
  signal_id: string;
  source: string;
  record_id: string | null;
  provider_id: string | null;
  user_id: string;
  source_agent_id: string | null;
  workspace_id: string | null;
  session_key: string | null;
  score: number | null;
  content: string | null;
  metadata_json: string;
  created_at: number;
};

type MemoryTraceRow = {
  trace_id: string;
  session_key: string | null;
  turn_id: string | null;
  phase: string;
  provider_id: string;
  user_id: string;
  source_agent_id: string | null;
  request_json: string;
  result_count: number | null;
  selected_record_ids_json: string;
  skipped_reason: string | null;
  error: string | null;
  duration_ms: number;
  created_at: number;
};

type MemoryFeedbackRow = {
  feedback_id: string;
  trace_id: string;
  turn_id: string;
  record_id: string | null;
  level: 'response' | 'record';
  rating: MemoryFeedbackRating;
  score: number | null;
  reason_code: string | null;
  note: string | null;
  source: 'user' | 'evaluator' | 'system';
  created_at: number;
  updated_at: number;
};

export type MemoryFeedbackRating =
  | 'helpful'
  | 'not_helpful'
  | 'mixed'
  | 'irrelevant'
  | 'incorrect'
  | 'outdated'
  | 'sensitive';

export interface MemoryFeedback {
  feedbackId: string;
  traceId: string;
  turnId: string;
  level: 'response' | 'record';
  recordId?: string;
  rating: MemoryFeedbackRating;
  score?: number;
  reasonCode?: string;
  note?: string;
  source: 'user' | 'evaluator' | 'system';
  createdAt: string;
  updatedAt: string;
}

export interface AppendMemoryTraceEventInput {
  traceId?: string;
  sessionKey?: string;
  turnId?: string;
  phase: 'search' | 'read' | 'write' | 'update' | 'delete' | 'sync' | 'inject' | 'test' | 'understanding';
  providerId: string;
  sourceAgentId?: string;
  request?: unknown;
  resultCount?: number;
  selectedRecordIds?: string[];
  skippedReason?: string;
  error?: string;
  durationMs?: number;
  nowMs?: number;
}

export interface SetMemoryTurnFeedbackInput {
  turnId: string;
  rating: MemoryFeedbackRating;
  score?: number;
  reasonCode?: string;
  note?: string;
  source?: MemoryFeedback['source'];
  records?: Array<{
    recordId: string;
    rating: MemoryFeedbackRating;
    reasonCode?: string;
    note?: string;
  }>;
  nowMs?: number;
}

export interface MemoryTraceEventPayload {
  traceId: string;
  sessionKey?: string;
  turnId?: string;
  phase: string;
  providerId: string;
  request: unknown;
  resultCount?: number;
  selectedRecordIds: string[];
  skippedReason?: string;
  error?: string;
  feedback: MemoryFeedback[];
  durationMs: number;
  createdAt: string;
}

export interface MemoryRecallFeedbackSummary {
  recordId: string;
  helpful: number;
  notHelpful: number;
  mixed: number;
  irrelevant: number;
  total: number;
  averageScore: number | null;
  lastFeedbackAt?: string;
}

function memoryFeedbackAdjustment(summary: MemoryRecallFeedbackSummary | undefined): number {
  if (!summary || summary.total < 3) return 0;
  const helpfulRate = (summary.helpful + 1) / (summary.total + 2);
  const relevancePenalty = summary.irrelevant >= 3 ? 0.05 : 0;
  return Math.max(-0.1, Math.min(0.05, (helpfulRate - 0.5) * 0.1 - relevancePenalty));
}


function parseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function memoryFeedbackRowToPayload(row: MemoryFeedbackRow): MemoryFeedback {
  return {
    feedbackId: row.feedback_id,
    traceId: row.trace_id,
    turnId: row.turn_id,
    level: row.level,
    ...(row.record_id ? { recordId: row.record_id } : {}),
    rating: row.rating,
    ...(row.score != null ? { score: row.score } : {}),
    ...(row.reason_code ? { reasonCode: row.reason_code } : {}),
    ...(row.note ? { note: row.note } : {}),
    source: row.source,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function listFeedbackForTrace(traceId: string): MemoryFeedback[] {
  const rows = getSqliteDatabase().prepare(
    `SELECT * FROM memory_feedback WHERE trace_id = ? ORDER BY level, updated_at DESC`,
  ).all(traceId) as MemoryFeedbackRow[];
  return rows.map(memoryFeedbackRowToPayload);
}

function memoryTraceRowToPayload(row: MemoryTraceRow): MemoryTraceEventPayload {
  return {
    traceId: row.trace_id,
    ...(row.session_key ? { sessionKey: row.session_key } : {}),
    ...(row.turn_id ? { turnId: row.turn_id } : {}),
    phase: row.phase,
    providerId: row.provider_id,
    request: parseJsonValue(row.request_json, {}),
    ...(row.result_count != null ? { resultCount: row.result_count } : {}),
    selectedRecordIds: parseStringArray(row.selected_record_ids_json),
    ...(row.skipped_reason ? { skippedReason: row.skipped_reason } : {}),
    ...(row.error ? { error: row.error } : {}),
    feedback: listFeedbackForTrace(row.trace_id),
    durationMs: row.duration_ms,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function parseOptionalTimestamp(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampToIso(value: number | null): string | undefined {
  return value == null ? undefined : new Date(value).toISOString();
}

function parseSource(json: string): MemoryRecord['source'] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as MemoryRecord['source']) : {};
  } catch {
    return {};
  }
}

function rowToRecord(row: MemoryRecordRow, evidence: MemoryRecord['evidence'] = []): MemoryRecord {
  return {
    id: row.record_id,
    providerId: row.provider_id,
    kind: row.kind as MemoryKind,
    status: row.status as MemoryStatus,
    ...(row.canonical_key ? { canonicalKey: row.canonical_key } : {}),
    scope: {
      userId: row.user_id,
      ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
      ...(row.session_key ? { sessionKey: row.session_key } : {}),
      ...(row.project_id ? { projectId: row.project_id } : {}),
    },
    provenance: {
      sourceAgentId: row.source_agent_id,
      originClass: row.origin_class as MemoryOriginClass,
      sessionKind: row.session_kind as MemorySessionKind,
      observedAt: new Date(row.observed_at).toISOString(),
      ...(row.source_session_id ? { sourceSessionId: row.source_session_id } : {}),
      ...(row.source_turn_id ? { sourceTurnId: row.source_turn_id } : {}),
      ...(row.supersedes_key ? { supersedesKey: row.supersedes_key } : {}),
      derivedFromRecalledContext: row.derived_from_recalled_context === 1,
    },
    content: row.content,
    source: parseSource(row.source_json),
    ...(row.confidence != null ? { confidence: row.confidence } : {}),
    sensitivity: row.sensitivity as MemorySensitivity,
    explicitness: row.explicitness as MemoryExplicitness,
    durability: row.durability as MemoryDurability,
    importance: row.importance,
    disclosurePolicy: row.disclosure_policy as MemoryDisclosurePolicy,
    evidence,
    ...(timestampToIso(row.valid_from) ? { validFrom: timestampToIso(row.valid_from) } : {}),
    ...(timestampToIso(row.valid_to) ? { validTo: timestampToIso(row.valid_to) } : {}),
    ...(timestampToIso(row.review_after) ? { reviewAfter: timestampToIso(row.review_after) } : {}),
    ...(timestampToIso(row.expires_at) ? { expiresAt: timestampToIso(row.expires_at) } : {}),
    ...(row.supersedes_record_id ? { supersedesRecordId: row.supersedes_record_id } : {}),
    ...(row.conflict_group_id ? { conflictGroupId: row.conflict_group_id } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    tags: parseStringArray(row.tags_json),
  };
}

function rowsToRecords(rows: MemoryRecordRow[]): MemoryRecord[] {
  const evidenceByRecord = listMemoryEvidenceForRecords(rows.map((row) => row.record_id));
  return rows.map((row) => rowToRecord(row, evidenceByRecord.get(row.record_id) ?? []));
}

function upsertMemoryRecordFts(
  db: ReturnType<typeof getSqliteDatabase>,
  row: Pick<UpsertMemoryRecordInput, 'providerId' | 'kind' | 'userId' | 'sourceAgentId' | 'workspaceId' | 'content'> & { id: string },
): void {
  db.prepare(`DELETE FROM memory_records_fts WHERE record_id = ?`).run(row.id);
  if (!row.content.trim()) return;
  db.prepare(
    `INSERT INTO memory_records_fts (
      content, record_id, provider_id, kind, user_id, source_agent_id, workspace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.content, row.id, row.providerId, row.kind, row.userId ?? LOCAL_USER_ID, row.sourceAgentId, row.workspaceId ?? null);
}

export function upsertMemoryRecord(input: UpsertMemoryRecordInput): MemoryRecord {
  const id = input.id ?? randomUUID();
  const now = input.nowMs ?? Date.now();
  const status = input.status ?? 'active';
  const sensitivity = input.sensitivity ?? 'normal';
  const explicitness = input.explicitness ?? 'inferred';
  const durability = input.durability ?? 'durable';
  const importance = Math.max(0, Math.min(1, input.importance ?? 0.5));
  const disclosurePolicy = input.disclosurePolicy ?? 'referenceable';
  const validFrom = parseOptionalTimestamp(input.validFrom);
  const validTo = parseOptionalTimestamp(input.validTo);
  const reviewAfter = parseOptionalTimestamp(input.reviewAfter);
  const expiresAt = parseOptionalTimestamp(input.expiresAt);
  const observedAt = parseOptionalTimestamp(input.observedAt) ?? now;
  const originClass = input.originClass ?? 'untrusted';
  const sessionKind = input.sessionKind ?? 'unknown';
  const source = {
    ...(input.source ?? {}),
    provider: input.source?.provider ?? input.providerId,
  };

  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO memory_records (
        record_id, provider_id, kind, user_id, source_agent_id, workspace_id, session_key, project_id,
        content, source_json, confidence, tags_json, status, sensitivity,
        canonical_key, explicitness, durability, importance,
        disclosure_policy, valid_from, valid_to, review_after, expires_at,
        supersedes_record_id, conflict_group_id,
        origin_class, session_kind, observed_at, source_session_id, source_turn_id,
        supersedes_key, derived_from_recalled_context, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET
        provider_id = excluded.provider_id,
        kind = excluded.kind,
        user_id = excluded.user_id,
        source_agent_id = excluded.source_agent_id,
        workspace_id = excluded.workspace_id,
        session_key = excluded.session_key,
        project_id = excluded.project_id,
        content = excluded.content,
        source_json = excluded.source_json,
        confidence = excluded.confidence,
        tags_json = excluded.tags_json,
        status = excluded.status,
        sensitivity = excluded.sensitivity,
        canonical_key = excluded.canonical_key,
        explicitness = excluded.explicitness,
        durability = excluded.durability,
        importance = excluded.importance,
        disclosure_policy = excluded.disclosure_policy,
        valid_from = excluded.valid_from,
        valid_to = excluded.valid_to,
        review_after = excluded.review_after,
        expires_at = excluded.expires_at,
        supersedes_record_id = excluded.supersedes_record_id,
        conflict_group_id = excluded.conflict_group_id,
        origin_class = excluded.origin_class,
        session_kind = excluded.session_kind,
        observed_at = excluded.observed_at,
        source_session_id = excluded.source_session_id,
        source_turn_id = excluded.source_turn_id,
        supersedes_key = excluded.supersedes_key,
        derived_from_recalled_context = excluded.derived_from_recalled_context,
        updated_at = excluded.updated_at`,
    ).run(
      id,
      input.providerId,
      input.kind,
      input.userId ?? LOCAL_USER_ID,
      input.sourceAgentId,
      input.workspaceId ?? null,
      input.sessionKey ?? null,
      input.projectId ?? null,
      input.content,
      JSON.stringify(source),
      input.confidence ?? null,
      JSON.stringify(input.tags ?? []),
      status,
      sensitivity,
      input.canonicalKey ?? null,
      explicitness,
      durability,
      importance,
      disclosurePolicy,
      validFrom,
      validTo,
      reviewAfter,
      expiresAt,
      input.supersedesRecordId ?? null,
      input.conflictGroupId ?? null,
      originClass,
      sessionKind,
      observedAt,
      input.sourceSessionId ?? null,
      input.sourceTurnId ?? null,
      input.supersedesKey ?? null,
      input.derivedFromRecalledContext ? 1 : 0,
      now,
      now,
    );
    upsertMemoryRecordFts(db, { ...input, id });
    if (input.evidence) {
      replaceMemoryEvidenceForRecord(db, id, input.evidence, now);
    }
    if (input.supersedesRecordId && input.supersedesRecordId !== id) {
      const target = db.prepare(`SELECT 1 FROM memory_records WHERE record_id = ?`)
        .get(input.supersedesRecordId);
      if (target) {
        db.prepare(
          `INSERT INTO memory_relations (
            relation_id, from_record_id, relation_type, to_record_id,
            confidence, valid_from, valid_to, created_at, updated_at
          ) VALUES (?, ?, 'supersedes', ?, ?, ?, NULL, ?, ?)
          ON CONFLICT(from_record_id, relation_type, to_record_id) DO UPDATE SET
            confidence = excluded.confidence,
            valid_from = excluded.valid_from,
            valid_to = NULL,
            updated_at = excluded.updated_at`,
        ).run(
          randomUUID(),
          id,
          input.supersedesRecordId,
          input.confidence ?? 1,
          validFrom ?? now,
          now,
          now,
        );
        if (status === 'active') {
          db.prepare(
            `UPDATE memory_records
             SET status = 'archived', valid_to = COALESCE(valid_to, ?), updated_at = ?
             WHERE record_id = ? AND status IN ('active', 'needs_review', 'stale')`,
          ).run(now, now, input.supersedesRecordId);
        }
      }
    }
  });

  const storedEvidence = input.evidence ?? listMemoryEvidence(id);

  return {
    id,
    providerId: input.providerId,
    kind: input.kind,
    status,
    ...(input.canonicalKey ? { canonicalKey: input.canonicalKey } : {}),
    scope: {
      userId: input.userId ?? LOCAL_USER_ID,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
    },
    provenance: {
      sourceAgentId: input.sourceAgentId,
      originClass,
      sessionKind,
      observedAt: new Date(observedAt).toISOString(),
      ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}),
      ...(input.sourceTurnId ? { sourceTurnId: input.sourceTurnId } : {}),
      ...(input.supersedesKey ? { supersedesKey: input.supersedesKey } : {}),
      derivedFromRecalledContext: input.derivedFromRecalledContext ?? false,
    },
    content: input.content,
    source,
    ...(input.confidence != null ? { confidence: input.confidence } : {}),
    sensitivity,
    explicitness,
    durability,
    importance,
    disclosurePolicy,
    evidence: storedEvidence,
    ...(validFrom != null ? { validFrom: new Date(validFrom).toISOString() } : {}),
    ...(validTo != null ? { validTo: new Date(validTo).toISOString() } : {}),
    ...(reviewAfter != null ? { reviewAfter: new Date(reviewAfter).toISOString() } : {}),
    ...(expiresAt != null ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
    ...(input.supersedesRecordId ? { supersedesRecordId: input.supersedesRecordId } : {}),
    ...(input.conflictGroupId ? { conflictGroupId: input.conflictGroupId } : {}),
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    tags: input.tags ?? [],
  };
}

export function getMemoryRecord(recordId: string): MemoryRecord | null {
  const row = getSqliteDatabase()
    .prepare(`SELECT * FROM memory_records WHERE record_id = ?`)
    .get(recordId) as MemoryRecordRow | undefined;
  return row ? rowToRecord(row, listMemoryEvidence(recordId)) : null;
}

export function hasUnresolvedMemoryConflict(conflictGroupId: string): boolean {
  if (!conflictGroupId.trim()) return false;
  const row = getSqliteDatabase().prepare(`
    SELECT COUNT(*) AS count
    FROM memory_records
    WHERE conflict_group_id = ?
      AND status IN ('active', 'candidate', 'needs_review', 'stale')
  `).get(conflictGroupId) as { count: number };
  return Number(row.count) > 1;
}

export function listMemoryRecords(options: ListMemoryRecordsOptions = {}): MemoryRecord[] {
  const where: string[] = [];
  const params: Array<string | number | null> = [];
  if (options.providerId) {
    where.push('provider_id = ?');
    params.push(options.providerId);
  }
  if (options.userId) {
    where.push('user_id = ?');
    params.push(options.userId);
  }
  if (options.sourceAgentId) {
    where.push('source_agent_id = ?');
    params.push(options.sourceAgentId);
  }
  if (options.workspaceId) {
    where.push('workspace_id = ?');
    params.push(options.workspaceId);
  }
  if (options.visibleToWorkspaceId) {
    where.push('(workspace_id IS NULL OR workspace_id = ?)');
    params.push(options.visibleToWorkspaceId);
  } else if (options.unscopedWorkspaceOnly) {
    where.push('workspace_id IS NULL');
  }
  if (options.projectId) {
    where.push('project_id = ?');
    params.push(options.projectId);
  }
  if (options.visibleToSessionKey) {
    where.push('(session_key IS NULL OR session_key = ?)');
    params.push(options.visibleToSessionKey);
  } else if (options.unscopedSessionOnly) {
    where.push('session_key IS NULL');
  }
  if (options.visibleToProjectId) {
    where.push('(project_id IS NULL OR project_id = ?)');
    params.push(options.visibleToProjectId);
  } else if (options.unscopedProjectOnly) {
    where.push('project_id IS NULL');
  }
  if (options.kind) {
    where.push('kind = ?');
    params.push(options.kind);
  }
  if (options.status) {
    where.push('status = ?');
    params.push(options.status);
  }
  if (options.canonicalKey) {
    where.push('canonical_key = ?');
    params.push(options.canonicalKey);
  }
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));
  const offset = Math.max(0, options.offset ?? 0);
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT * FROM memory_records
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as MemoryRecordRow[];
  return rowsToRecords(rows);
}

export function searchMemoryRecords(options: SearchMemoryRecordsOptions): MemorySearchResult[] {
  const profile = buildRetrievalQueryProfile(options.query, {
    ...(options.visibleToSessionKey ? { sessionKey: options.visibleToSessionKey } : {}),
    ...(options.visibleToWorkspaceId ?? options.workspaceId
      ? { workspaceId: options.visibleToWorkspaceId ?? options.workspaceId }
      : {}),
    ...(options.visibleToProjectId ?? options.projectId
      ? { projectId: options.visibleToProjectId ?? options.projectId }
      : {}),
  });
  const query = buildFts5SearchQuery(profile.normalized);
  if (!query) return [];

  const filters: string[] = ['memory_records_fts MATCH ?'];
  const params: Array<string | number | null> = [query];
  if (options.userId) {
    filters.push('f.user_id = ?');
    params.push(options.userId);
  }
  if (options.sourceAgentId) {
    filters.push('f.source_agent_id = ?');
    params.push(options.sourceAgentId);
  }
  if (options.workspaceId) {
    filters.push('f.workspace_id = ?');
    params.push(options.workspaceId);
  }
  if (options.visibleToWorkspaceId) {
    filters.push('(r.workspace_id IS NULL OR r.workspace_id = ?)');
    params.push(options.visibleToWorkspaceId);
  } else if (options.unscopedWorkspaceOnly) {
    filters.push('r.workspace_id IS NULL');
  }
  if (options.projectId) {
    filters.push('r.project_id = ?');
    params.push(options.projectId);
  }
  if (options.visibleToSessionKey) {
    filters.push('(r.session_key IS NULL OR r.session_key = ?)');
    params.push(options.visibleToSessionKey);
  } else if (options.unscopedSessionOnly) {
    filters.push('r.session_key IS NULL');
  }
  if (options.visibleToProjectId) {
    filters.push('(r.project_id IS NULL OR r.project_id = ?)');
    params.push(options.visibleToProjectId);
  } else if (options.unscopedProjectOnly) {
    filters.push('r.project_id IS NULL');
  }
  if (options.providerId) {
    filters.push('f.provider_id = ?');
    params.push(options.providerId);
  }
  if (options.kinds && options.kinds.length > 0) {
    filters.push(`f.kind IN (${options.kinds.map(() => '?').join(', ')})`);
    params.push(...options.kinds);
  }
  if (options.trustedOnly) {
    filters.push(`r.origin_class IN ('owner', 'agent')`);
    filters.push('r.derived_from_recalled_context = 0');
  }
  const statuses = options.statuses && options.statuses.length > 0 ? options.statuses : ['active'];
  filters.push(`r.status IN (${statuses.map(() => '?').join(', ')})`);
  params.push(...statuses);

  const maxResults = Math.max(1, Math.min(50, options.maxResults ?? 5));
  const minScore = options.minScore ?? 0;
  const candidateLimit = Math.max(50, Math.min(200, maxResults * 10));
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT
        r.*,
        bm25(memory_records_fts) AS rank
       FROM memory_records_fts f
       JOIN memory_records r ON r.record_id = f.record_id
       WHERE ${filters.join(' AND ')}
       ORDER BY rank
       LIMIT ?`,
    )
    .all(...params, candidateLimit) as MemoryRecordSearchRow[];

  const candidateRecords = listMemoryRecords({
      providerId: options.providerId,
      userId: options.userId,
      sourceAgentId: options.sourceAgentId,
      workspaceId: options.workspaceId,
      projectId: options.projectId,
      visibleToSessionKey: options.visibleToSessionKey,
      unscopedSessionOnly: options.unscopedSessionOnly,
      visibleToProjectId: options.visibleToProjectId,
      unscopedProjectOnly: options.unscopedProjectOnly,
      visibleToWorkspaceId: options.visibleToWorkspaceId,
      unscopedWorkspaceOnly: options.unscopedWorkspaceOnly,
      limit: 500,
    }).filter((record) =>
      statuses.includes(record.status ?? 'active')
      && (!options.kinds?.length || options.kinds.includes(record.kind)),
    ).filter((record) =>
      !options.trustedOnly
      || ((record.provenance.originClass === 'owner' || record.provenance.originClass === 'agent')
        && !record.provenance.derivedFromRecalledContext),
    );
  const candidateById = new Map(candidateRecords.map((record) => [record.id, record]));
  const missingRows = rows.filter((row) => !candidateById.has(row.record_id));
  const missingEvidence = listMemoryEvidenceForRecords(missingRows.map((row) => row.record_id));
  const recordById = new Map(candidateRecords.map((record) => [record.id, record]));
  for (const row of missingRows) {
    recordById.set(row.record_id, rowToRecord(row, missingEvidence.get(row.record_id) ?? []));
  }

  const lexical = candidateRecords
    .map((record) => ({ id: record.id, score: retrievalLexicalSimilarity(profile.normalized, record.content) }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, candidateLimit);
  const exact = profile.identifiers.length
    ? candidateRecords.map((record) => {
        const content = normalizeRetrievalText(record.content);
        return {
          id: record.id,
          matches: profile.identifiers.filter((identifier) => content.includes(identifier)).length,
        };
      }).filter((result) => result.matches > 0)
        .sort((left, right) => right.matches - left.matches)
        .slice(0, candidateLimit)
    : [];
  const fused = fuseRankedCandidates([
    { weight: 1.4, ids: exact.map((result) => result.id) },
    { weight: 1, ids: rows.map((row) => row.record_id) },
    { weight: 0.8, ids: lexical.map((result) => result.id) },
  ]);
  const feedback = new Map(summarizeMemoryRecallFeedback({ limit: 1_000 })
    .map((summary) => [summary.recordId, summary]));

  return [...fused.entries()]
    .map(([id, fusionScore]): MemorySearchResult | null => {
      const record = recordById.get(id);
      if (!record) return null;
      const kindBonus = profile.intentKinds.includes(record.kind) ? 0.08 : 0;
      const authorityBonus = record.explicitness === 'explicit' ? 0.03 : 0;
      const score = Math.max(0, Math.min(1,
        fusionScore * 0.85 + kindBonus + authorityBonus + record.importance * 0.04
          + memoryFeedbackAdjustment(feedback.get(record.id)),
      ));
      return {
        record,
        score,
        snippet: record.content,
        citation: {
          providerId: record.providerId,
          recordId: record.id,
          path: record.source.path,
          lineStart: record.source.lineStart,
          lineEnd: record.source.lineEnd,
          createdAt: record.createdAt,
        },
      };
    })
    .filter((result): result is MemorySearchResult => Boolean(result))
    .filter((result) => result.score >= minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults);
}

export function deleteMemoryRecord(recordId: string): boolean {
  return runSqliteWriteTransaction((db) => {
    db.prepare(`DELETE FROM memory_records_fts WHERE record_id = ?`).run(recordId);
    const result = db.prepare(`DELETE FROM memory_records WHERE record_id = ?`).run(recordId);
    return result.changes > 0;
  });
}

export function countMemoryRecordsBySourceInstanceId(sourceInstanceId: string): number {
  const row = getSqliteDatabase().prepare(
    `SELECT COUNT(*) AS count FROM memory_records
     WHERE json_extract(source_json, '$.sourceInstanceId') = ?`,
  ).get(sourceInstanceId) as { count: number };
  return Number(row.count);
}

export function deleteMemoryRecordsBySourceInstanceId(sourceInstanceId: string): number {
  return runSqliteWriteTransaction((db) => {
    const recordIds = (db.prepare(
      `SELECT record_id FROM memory_records
       WHERE json_extract(source_json, '$.sourceInstanceId') = ?`,
    ).all(sourceInstanceId) as Array<{ record_id: string }>).map((row) => row.record_id);
    if (!recordIds.length) return 0;
    const removeFts = db.prepare('DELETE FROM memory_records_fts WHERE record_id = ?');
    const removeRecord = db.prepare('DELETE FROM memory_records WHERE record_id = ?');
    let deleted = 0;
    for (const recordId of recordIds) {
      removeFts.run(recordId);
      deleted += Number(removeRecord.run(recordId).changes);
    }
    return deleted;
  });
}

/** Change lifecycle status without reconstructing or weakening the record's provenance. */
export function setMemoryRecordStatus(recordId: string, status: MemoryStatus, nowMs = Date.now()): boolean {
  return runSqliteWriteTransaction((db) => {
    const result = db.prepare(
      `UPDATE memory_records SET status = ?, updated_at = ? WHERE record_id = ?`,
    ).run(status, nowMs, recordId);
    return result.changes > 0;
  });
}

export function markMemoryRecordsConflicted(recordIds: string[], conflictGroupId: string): number {
  const ids = [...new Set(recordIds.filter(Boolean))];
  if (!ids.length || !conflictGroupId.trim()) return 0;
  return runSqliteWriteTransaction((db) => {
    const now = Date.now();
    const update = db.prepare(`
      UPDATE memory_records
      SET conflict_group_id = ?, status = 'needs_review', review_after = ?, updated_at = ?
      WHERE record_id = ? AND status IN ('active', 'candidate', 'needs_review', 'stale')
    `);
    let changed = 0;
    for (const id of ids) changed += Number(update.run(conflictGroupId, now, now, id).changes);
    return changed;
  });
}

export function appendMemorySignal(input: AppendMemorySignalInput): string {
  const id = randomUUID();
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO memory_signals (
        signal_id, source, record_id, provider_id, user_id, source_agent_id, workspace_id,
        session_key, score, content, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.signal.source,
      input.signal.recordId ?? null,
      input.providerId ?? null,
      input.userId ?? LOCAL_USER_ID,
      input.sourceAgentId ?? null,
      input.workspaceId ?? null,
      input.sessionKey ?? null,
      input.signal.score ?? null,
      input.signal.content ?? null,
      JSON.stringify(input.signal.metadata ?? {}),
      now,
    );
    if (input.signal.recordId) {
      db.prepare(
        `UPDATE memory_records
         SET recall_count = recall_count + 1, last_recalled_at = ?, updated_at = MAX(updated_at, ?)
         WHERE record_id = ?`,
      ).run(now, now, input.signal.recordId);
    }
  });
  return id;
}

export function listMemorySignals(options: {
  recordId?: string;
  providerId?: string;
  userId?: string;
  sourceAgentId?: string;
  workspaceId?: string;
  limit?: number;
} = {}): MemorySignalRowPayload[] {
  const where: string[] = [];
  const params: Array<string | number | null> = [];
  if (options.recordId) {
    where.push('record_id = ?');
    params.push(options.recordId);
  }
  if (options.providerId) {
    where.push('provider_id = ?');
    params.push(options.providerId);
  }
  if (options.userId) {
    where.push('user_id = ?');
    params.push(options.userId);
  }
  if (options.sourceAgentId) {
    where.push('source_agent_id = ?');
    params.push(options.sourceAgentId);
  }
  if (options.workspaceId) {
    where.push('workspace_id = ?');
    params.push(options.workspaceId);
  }
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT * FROM memory_signals
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(...params, limit) as MemorySignalRow[];
  return rows.map((row) => {
    let metadata: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.metadata_json) as unknown;
      if (parsed && typeof parsed === 'object') metadata = parsed as Record<string, unknown>;
    } catch {
      metadata = {};
    }
    return {
      signalId: row.signal_id,
      source: row.source,
      ...(row.record_id ? { recordId: row.record_id } : {}),
      ...(row.provider_id ? { providerId: row.provider_id } : {}),
      userId: row.user_id,
      ...(row.source_agent_id ? { sourceAgentId: row.source_agent_id } : {}),
      ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
      ...(row.session_key ? { sessionKey: row.session_key } : {}),
      ...(row.score != null ? { score: row.score } : {}),
      ...(row.content ? { content: row.content } : {}),
      metadata,
      createdAt: new Date(row.created_at).toISOString(),
    };
  });
}

export function getMemoryProviderState(providerId: string, scopeKey: string): unknown | null {
  const row = getSqliteDatabase()
    .prepare(`SELECT state_json FROM memory_provider_state WHERE provider_id = ? AND scope_key = ?`)
    .get(providerId, scopeKey) as { state_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.state_json) as unknown;
  } catch {
    return null;
  }
}

export function setMemoryProviderState(providerId: string, scopeKey: string, state: unknown): void {
  const now = Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO memory_provider_state (provider_id, scope_key, state_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider_id, scope_key) DO UPDATE SET
         state_json = excluded.state_json,
         updated_at = excluded.updated_at`,
    ).run(providerId, scopeKey, JSON.stringify(state ?? null), now);
  });
}

export function appendMemoryTraceEvent(input: AppendMemoryTraceEventInput): string {
  const id = input.traceId ?? randomUUID();
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO memory_trace_events (
        trace_id, session_key, turn_id, phase, provider_id, request_json,
        result_count, selected_record_ids_json, skipped_reason, error, duration_ms, created_at,
        user_id, source_agent_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.sessionKey ?? null,
      input.turnId ?? null,
      input.phase,
      input.providerId,
      JSON.stringify(input.request ?? {}),
      input.resultCount ?? null,
      JSON.stringify(input.selectedRecordIds ?? []),
      input.skippedReason ?? null,
      input.error ?? null,
      Math.max(0, Math.floor(input.durationMs ?? 0)),
      now,
      LOCAL_USER_ID,
      input.sourceAgentId ?? null,
    );
  });
  return id;
}

export function listMemoryTraceEvents(options: {
  providerId?: string;
  userId?: string;
  sourceAgentId?: string;
  sessionKey?: string;
  phase?: string;
  limit?: number;
} = {}): MemoryTraceEventPayload[] {
  const where: string[] = [];
  const params: Array<string | number | null> = [];
  if (options.providerId) {
    where.push('provider_id = ?');
    params.push(options.providerId);
  }
  where.push('user_id = ?');
  params.push(options.userId ?? LOCAL_USER_ID);
  if (options.sourceAgentId) {
    where.push('source_agent_id = ?');
    params.push(options.sourceAgentId);
  }
  if (options.sessionKey) {
    where.push('session_key = ?');
    params.push(options.sessionKey);
  }
  if (options.phase) {
    where.push('phase = ?');
    params.push(options.phase);
  }
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT * FROM memory_trace_events
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(...params, limit) as MemoryTraceRow[];
  return rows.map(memoryTraceRowToPayload);
}

export function setMemoryTurnFeedback(input: SetMemoryTurnFeedbackInput): MemoryTraceEventPayload | null {
  const turnId = input.turnId.trim();
  if (!turnId) return null;
  const trace = getSqliteDatabase().prepare(
    `SELECT * FROM memory_trace_events WHERE turn_id = ? AND phase = 'inject'`,
  ).get(turnId) as MemoryTraceRow | undefined;
  if (!trace) return null;
  const nowMs = input.nowMs ?? Date.now();
  const source = input.source ?? 'user';
  const selected = new Set(parseStringArray(trace.selected_record_ids_json));
  const records = (input.records ?? []).filter((item) => selected.has(item.recordId));
  runSqliteWriteTransaction((db) => {
    const upsert = db.prepare(
      `INSERT INTO memory_feedback (
        feedback_id, trace_id, turn_id, record_id, level, rating, score,
        reason_code, note, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO UPDATE SET rating = excluded.rating, score = excluded.score,
        reason_code = excluded.reason_code, note = excluded.note, updated_at = excluded.updated_at`,
    );
    upsert.run(
      randomUUID(), trace.trace_id, turnId, null, 'response', input.rating,
      typeof input.score === 'number' ? Math.max(-1, Math.min(1, input.score)) : null,
      input.reasonCode?.trim().slice(0, 200) || null,
      input.note?.trim().slice(0, 2000) || null,
      source, nowMs, nowMs,
    );
    for (const item of records) {
      upsert.run(
        randomUUID(), trace.trace_id, turnId, item.recordId, 'record', item.rating,
        null, item.reasonCode?.trim().slice(0, 200) || null,
        item.note?.trim().slice(0, 2000) || null,
        source, nowMs, nowMs,
      );
      if (item.rating === 'incorrect' || item.rating === 'sensitive') {
        db.prepare("UPDATE memory_records SET status = 'needs_review', updated_at = ? WHERE record_id = ?")
          .run(nowMs, item.recordId);
      } else if (item.rating === 'outdated') {
        db.prepare("UPDATE memory_records SET status = 'stale', updated_at = ? WHERE record_id = ?")
          .run(nowMs, item.recordId);
      }
    }
  });
  return memoryTraceRowToPayload(trace);
}

export function getMemoryTurnFeedback(turnId: string): MemoryTraceEventPayload | null {
  const normalized = turnId.trim();
  if (!normalized) return null;
  const trace = getSqliteDatabase().prepare(
    `SELECT * FROM memory_trace_events WHERE turn_id = ? AND phase = 'inject'`,
  ).get(normalized) as MemoryTraceRow | undefined;
  return trace ? memoryTraceRowToPayload(trace) : null;
}

export function summarizeMemoryRecallFeedback(options: {
  recordId?: string;
  providerId?: string;
  sourceAgentId?: string;
  sessionKey?: string;
  limit?: number;
} = {}): MemoryRecallFeedbackSummary[] {
  const where = ['phase IN (?, ?)'];
  const params: Array<string | number> = ['search', 'inject'];
  if (options.providerId) {
    where.push('provider_id = ?');
    params.push(options.providerId);
  }
  where.push('user_id = ?');
  params.push(LOCAL_USER_ID);
  if (options.sourceAgentId) {
    where.push('source_agent_id = ?');
    params.push(options.sourceAgentId);
  }
  if (options.sessionKey) {
    where.push('session_key = ?');
    params.push(options.sessionKey);
  }
  const limit = Math.max(1, Math.min(5000, options.limit ?? 1000));
  const rows = getSqliteDatabase().prepare(
    `SELECT feedback.* FROM memory_feedback AS feedback
     JOIN memory_trace_events AS trace ON trace.trace_id = feedback.trace_id
     WHERE feedback.level = 'record' AND ${where.map((clause) => `trace.${clause}`).join(' AND ')}
     ORDER BY feedback.updated_at DESC LIMIT ?`,
  ).all(...params, limit) as MemoryFeedbackRow[];

  const summaries = new Map<string, MemoryRecallFeedbackSummary & { scoreTotal: number; scoreCount: number }>();
  for (const row of rows) {
    const recordId = row.record_id;
    if (!recordId || (options.recordId && recordId !== options.recordId)) continue;
      const current = summaries.get(recordId) ?? {
        recordId,
        helpful: 0,
        notHelpful: 0,
        mixed: 0,
        irrelevant: 0,
        total: 0,
        averageScore: null,
        scoreTotal: 0,
        scoreCount: 0,
      };
      if (row.rating === 'helpful') current.helpful += 1;
      if (row.rating === 'not_helpful' || row.rating === 'incorrect' || row.rating === 'outdated' || row.rating === 'sensitive') current.notHelpful += 1;
      if (row.rating === 'mixed') current.mixed += 1;
      if (row.rating === 'irrelevant') current.irrelevant += 1;
      current.total += 1;
      if (typeof row.score === 'number') {
        current.scoreTotal += row.score;
        current.scoreCount += 1;
        current.averageScore = current.scoreTotal / current.scoreCount;
      }
      current.lastFeedbackAt ??= new Date(row.updated_at).toISOString();
      summaries.set(recordId, current);
  }

  return [...summaries.values()]
    .map(({ scoreTotal: _scoreTotal, scoreCount: _scoreCount, ...summary }) => summary)
    .sort((a, b) => b.total - a.total);
}

function parseJsonValue(json: string, fallback: unknown): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return fallback;
  }
}
