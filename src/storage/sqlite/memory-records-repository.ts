import { randomUUID } from 'node:crypto';

import type {
  MemoryKind,
  MemoryRecord,
  MemorySensitivity,
  MemorySearchResult,
  MemorySignal,
  MemoryStatus,
} from '../../agent/memory/types.js';
import { escapeFts5Query } from './fts.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

type MemoryRecordRow = {
  record_id: string;
  provider_id: string;
  kind: string;
  agent_id: string;
  workspace_id: string | null;
  session_key: string | null;
  content: string;
  source_json: string;
  confidence: number | null;
  tags_json: string;
  status: string;
  sensitivity: string;
  evidence_json: string;
  review_after: number | null;
  expires_at: number | null;
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
  agentId: string;
  workspaceId?: string;
  sessionKey?: string;
  content: string;
  source?: MemoryRecord['source'];
  confidence?: number;
  tags?: string[];
  status?: MemoryStatus;
  sensitivity?: MemorySensitivity;
  evidence?: MemoryRecord['evidence'];
  reviewAfter?: string;
  expiresAt?: string;
  nowMs?: number;
}

export interface ListMemoryRecordsOptions {
  providerId?: string;
  agentId?: string;
  workspaceId?: string;
  kind?: MemoryKind;
  status?: MemoryStatus;
  limit?: number;
  offset?: number;
}

export interface SearchMemoryRecordsOptions {
  query: string;
  agentId?: string;
  workspaceId?: string;
  providerId?: string;
  kinds?: MemoryKind[];
  statuses?: MemoryStatus[];
  maxResults?: number;
  minScore?: number;
}

export interface AppendMemorySignalInput {
  signal: MemorySignal;
  providerId?: string;
  agentId?: string;
  workspaceId?: string;
  sessionKey?: string;
  nowMs?: number;
}

export interface MemorySignalRowPayload {
  signalId: string;
  source: string;
  recordId?: string;
  providerId?: string;
  agentId?: string;
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
  agent_id: string | null;
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
  request_json: string;
  result_count: number | null;
  selected_record_ids_json: string;
  skipped_reason: string | null;
  error: string | null;
  feedback_json: string;
  duration_ms: number;
  created_at: number;
};

export type MemoryTraceFeedbackOutcome = 'helpful' | 'not_helpful' | 'mixed' | 'irrelevant';

export interface MemoryTraceFeedback {
  outcome: MemoryTraceFeedbackOutcome;
  score?: number;
  reason?: string;
  source?: 'user' | 'evaluator' | 'system';
  createdAt: string;
  updatedAt?: string;
}

export interface AppendMemoryTraceEventInput {
  sessionKey?: string;
  turnId?: string;
  phase: 'search' | 'read' | 'write' | 'update' | 'delete' | 'sync' | 'inject' | 'test';
  providerId: string;
  request?: unknown;
  resultCount?: number;
  selectedRecordIds?: string[];
  skippedReason?: string;
  error?: string;
  feedback?: MemoryTraceFeedback;
  durationMs?: number;
  nowMs?: number;
}

export interface SetMemoryTraceFeedbackInput {
  traceId: string;
  feedback: Omit<MemoryTraceFeedback, 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
    updatedAt?: string;
  };
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
  feedback?: MemoryTraceFeedback;
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

function parseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function parseEvidence(json: string): MemoryRecord['evidence'] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is NonNullable<MemoryRecord['evidence']>[number] =>
      Boolean(item) && typeof item === 'object',
    );
  } catch {
    return [];
  }
}

function parseMemoryTraceFeedback(json: string): MemoryTraceFeedback | undefined {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const obj = parsed as Record<string, unknown>;
    const outcome = obj.outcome;
    if (
      outcome !== 'helpful' &&
      outcome !== 'not_helpful' &&
      outcome !== 'mixed' &&
      outcome !== 'irrelevant'
    ) {
      return undefined;
    }
    return {
      outcome,
      ...(typeof obj.score === 'number' ? { score: obj.score } : {}),
      ...(typeof obj.reason === 'string' ? { reason: obj.reason } : {}),
      ...(obj.source === 'user' || obj.source === 'evaluator' || obj.source === 'system'
        ? { source: obj.source }
        : {}),
      createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : new Date(0).toISOString(),
      ...(typeof obj.updatedAt === 'string' ? { updatedAt: obj.updatedAt } : {}),
    };
  } catch {
    return undefined;
  }
}

function normalizeMemoryTraceFeedback(
  input: SetMemoryTraceFeedbackInput['feedback'],
  nowMs = Date.now(),
  existing?: MemoryTraceFeedback,
): MemoryTraceFeedback {
  const score = typeof input.score === 'number'
    ? Math.max(-1, Math.min(1, input.score))
    : undefined;
  const reason = typeof input.reason === 'string' && input.reason.trim()
    ? input.reason.trim().slice(0, 1000)
    : undefined;
  const nowIso = new Date(nowMs).toISOString();
  return {
    outcome: input.outcome,
    ...(score != null ? { score } : {}),
    ...(reason ? { reason } : {}),
    ...(input.source ? { source: input.source } : {}),
    createdAt: input.createdAt ?? existing?.createdAt ?? nowIso,
    updatedAt: input.updatedAt ?? nowIso,
  };
}

function memoryTraceRowToPayload(row: MemoryTraceRow): MemoryTraceEventPayload {
  const feedback = parseMemoryTraceFeedback(row.feedback_json);
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
    ...(feedback ? { feedback } : {}),
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

function rowToRecord(row: MemoryRecordRow): MemoryRecord {
  return {
    id: row.record_id,
    kind: row.kind as MemoryKind,
    status: row.status as MemoryStatus,
    scope: {
      agentId: row.agent_id,
      ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
      ...(row.session_key ? { sessionKey: row.session_key } : {}),
    },
    content: row.content,
    source: parseSource(row.source_json),
    ...(row.confidence != null ? { confidence: row.confidence } : {}),
    sensitivity: row.sensitivity as MemorySensitivity,
    evidence: parseEvidence(row.evidence_json),
    ...(timestampToIso(row.review_after) ? { reviewAfter: timestampToIso(row.review_after) } : {}),
    ...(timestampToIso(row.expires_at) ? { expiresAt: timestampToIso(row.expires_at) } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    tags: parseStringArray(row.tags_json),
  };
}

function bm25ToScore(rank: number): number {
  return Math.max(0, Math.min(1, 1 / (1 + Math.max(0, rank))));
}

function upsertMemoryRecordFts(
  db: ReturnType<typeof getSqliteDatabase>,
  row: Pick<UpsertMemoryRecordInput, 'providerId' | 'kind' | 'agentId' | 'workspaceId' | 'content'> & { id: string },
): void {
  db.prepare(`DELETE FROM memory_records_fts WHERE record_id = ?`).run(row.id);
  if (!row.content.trim()) return;
  db.prepare(
    `INSERT INTO memory_records_fts (
      content, record_id, provider_id, kind, agent_id, workspace_id
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.content, row.id, row.providerId, row.kind, row.agentId, row.workspaceId ?? null);
}

export function upsertMemoryRecord(input: UpsertMemoryRecordInput): MemoryRecord {
  const id = input.id ?? randomUUID();
  const now = input.nowMs ?? Date.now();
  const status = input.status ?? 'active';
  const sensitivity = input.sensitivity ?? 'normal';
  const reviewAfter = parseOptionalTimestamp(input.reviewAfter);
  const expiresAt = parseOptionalTimestamp(input.expiresAt);
  const source = {
    ...(input.source ?? {}),
    provider: input.source?.provider ?? input.providerId,
  };

  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO memory_records (
        record_id, provider_id, kind, agent_id, workspace_id, session_key,
        content, source_json, confidence, tags_json, status, sensitivity,
        evidence_json, review_after, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET
        provider_id = excluded.provider_id,
        kind = excluded.kind,
        agent_id = excluded.agent_id,
        workspace_id = excluded.workspace_id,
        session_key = excluded.session_key,
        content = excluded.content,
        source_json = excluded.source_json,
        confidence = excluded.confidence,
        tags_json = excluded.tags_json,
        status = excluded.status,
        sensitivity = excluded.sensitivity,
        evidence_json = excluded.evidence_json,
        review_after = excluded.review_after,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at`,
    ).run(
      id,
      input.providerId,
      input.kind,
      input.agentId,
      input.workspaceId ?? null,
      input.sessionKey ?? null,
      input.content,
      JSON.stringify(source),
      input.confidence ?? null,
      JSON.stringify(input.tags ?? []),
      status,
      sensitivity,
      JSON.stringify(input.evidence ?? []),
      reviewAfter,
      expiresAt,
      now,
      now,
    );
    upsertMemoryRecordFts(db, { ...input, id });
  });

  return {
    id,
    kind: input.kind,
    status,
    scope: {
      agentId: input.agentId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    },
    content: input.content,
    source,
    ...(input.confidence != null ? { confidence: input.confidence } : {}),
    sensitivity,
    evidence: input.evidence ?? [],
    ...(reviewAfter != null ? { reviewAfter: new Date(reviewAfter).toISOString() } : {}),
    ...(expiresAt != null ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    tags: input.tags ?? [],
  };
}

export function getMemoryRecord(recordId: string): MemoryRecord | null {
  const row = getSqliteDatabase()
    .prepare(`SELECT * FROM memory_records WHERE record_id = ?`)
    .get(recordId) as MemoryRecordRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function listMemoryRecords(options: ListMemoryRecordsOptions = {}): MemoryRecord[] {
  const where: string[] = [];
  const params: Array<string | number | null> = [];
  if (options.providerId) {
    where.push('provider_id = ?');
    params.push(options.providerId);
  }
  if (options.agentId) {
    where.push('agent_id = ?');
    params.push(options.agentId);
  }
  if (options.workspaceId) {
    where.push('workspace_id = ?');
    params.push(options.workspaceId);
  }
  if (options.kind) {
    where.push('kind = ?');
    params.push(options.kind);
  }
  if (options.status) {
    where.push('status = ?');
    params.push(options.status);
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
  return rows.map(rowToRecord);
}

export function searchMemoryRecords(options: SearchMemoryRecordsOptions): MemorySearchResult[] {
  const query = escapeFts5Query(options.query);
  if (!query) return [];

  const filters: string[] = ['memory_records_fts MATCH ?'];
  const params: Array<string | number | null> = [query];
  if (options.agentId) {
    filters.push('f.agent_id = ?');
    params.push(options.agentId);
  }
  if (options.workspaceId) {
    filters.push('f.workspace_id = ?');
    params.push(options.workspaceId);
  }
  if (options.providerId) {
    filters.push('f.provider_id = ?');
    params.push(options.providerId);
  }
  if (options.kinds && options.kinds.length > 0) {
    filters.push(`f.kind IN (${options.kinds.map(() => '?').join(', ')})`);
    params.push(...options.kinds);
  }
  const statuses = options.statuses && options.statuses.length > 0 ? options.statuses : ['active'];
  filters.push(`r.status IN (${statuses.map(() => '?').join(', ')})`);
  params.push(...statuses);

  const maxResults = Math.max(1, Math.min(50, options.maxResults ?? 5));
  const minScore = options.minScore ?? 0;
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
    .all(...params, maxResults * 3) as MemoryRecordSearchRow[];

  return rows
    .map((row) => {
      const record = rowToRecord(row);
      const score = bm25ToScore(row.rank);
      return {
        record,
        score,
        snippet: record.content,
        citation: {
          providerId: row.provider_id,
          recordId: row.record_id,
          path: record.source.path,
          lineStart: record.source.lineStart,
          lineEnd: record.source.lineEnd,
          createdAt: record.createdAt,
        },
      };
    })
    .filter((result) => result.score >= minScore)
    .slice(0, maxResults);
}

export function deleteMemoryRecord(recordId: string): boolean {
  return runSqliteWriteTransaction((db) => {
    db.prepare(`DELETE FROM memory_records_fts WHERE record_id = ?`).run(recordId);
    const result = db.prepare(`DELETE FROM memory_records WHERE record_id = ?`).run(recordId);
    return result.changes > 0;
  });
}

export function appendMemorySignal(input: AppendMemorySignalInput): string {
  const id = randomUUID();
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO memory_signals (
        signal_id, source, record_id, provider_id, agent_id, workspace_id,
        session_key, score, content, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.signal.source,
      input.signal.recordId ?? null,
      input.providerId ?? null,
      input.agentId ?? null,
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
  agentId?: string;
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
  if (options.agentId) {
    where.push('agent_id = ?');
    params.push(options.agentId);
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
      ...(row.agent_id ? { agentId: row.agent_id } : {}),
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
  const id = randomUUID();
  const now = input.nowMs ?? Date.now();
  const feedback = input.feedback
    ? normalizeMemoryTraceFeedback(input.feedback, now)
    : undefined;
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO memory_trace_events (
        trace_id, session_key, turn_id, phase, provider_id, request_json,
        result_count, selected_record_ids_json, skipped_reason, error, feedback_json, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      JSON.stringify(feedback ?? {}),
      Math.max(0, Math.floor(input.durationMs ?? 0)),
      now,
    );
  });
  return id;
}

export function listMemoryTraceEvents(options: {
  providerId?: string;
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

export function setMemoryTraceFeedback(input: SetMemoryTraceFeedbackInput): MemoryTraceEventPayload | null {
  const existing = getSqliteDatabase()
    .prepare(`SELECT * FROM memory_trace_events WHERE trace_id = ?`)
    .get(input.traceId) as MemoryTraceRow | undefined;
  if (!existing) {
    return null;
  }
  const feedback = normalizeMemoryTraceFeedback(
    input.feedback,
    input.nowMs,
    parseMemoryTraceFeedback(existing.feedback_json),
  );
  runSqliteWriteTransaction((db) => {
    db.prepare(`UPDATE memory_trace_events SET feedback_json = ? WHERE trace_id = ?`)
      .run(JSON.stringify(feedback), input.traceId);
  });
  return memoryTraceRowToPayload({ ...existing, feedback_json: JSON.stringify(feedback) });
}

export function summarizeMemoryRecallFeedback(options: {
  recordId?: string;
  providerId?: string;
  sessionKey?: string;
  limit?: number;
} = {}): MemoryRecallFeedbackSummary[] {
  const where = ['phase IN (?, ?)'];
  const params: Array<string | number> = ['search', 'inject'];
  if (options.providerId) {
    where.push('provider_id = ?');
    params.push(options.providerId);
  }
  if (options.sessionKey) {
    where.push('session_key = ?');
    params.push(options.sessionKey);
  }
  const limit = Math.max(1, Math.min(5000, options.limit ?? 1000));
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT * FROM memory_trace_events
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(...params, limit) as MemoryTraceRow[];

  const summaries = new Map<string, MemoryRecallFeedbackSummary & { scoreTotal: number; scoreCount: number }>();
  for (const row of rows) {
    const feedback = parseMemoryTraceFeedback(row.feedback_json);
    if (!feedback) continue;
    const recordIds = parseStringArray(row.selected_record_ids_json);
    for (const recordId of recordIds) {
      if (options.recordId && recordId !== options.recordId) continue;
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
      if (feedback.outcome === 'helpful') current.helpful += 1;
      if (feedback.outcome === 'not_helpful') current.notHelpful += 1;
      if (feedback.outcome === 'mixed') current.mixed += 1;
      if (feedback.outcome === 'irrelevant') current.irrelevant += 1;
      current.total += 1;
      if (typeof feedback.score === 'number') {
        current.scoreTotal += feedback.score;
        current.scoreCount += 1;
        current.averageScore = current.scoreTotal / current.scoreCount;
      }
      current.lastFeedbackAt ??= feedback.updatedAt ?? feedback.createdAt;
      summaries.set(recordId, current);
    }
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
