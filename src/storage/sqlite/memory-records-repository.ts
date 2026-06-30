import { randomUUID } from 'node:crypto';

import type {
  MemoryKind,
  MemoryRecord,
  MemorySearchResult,
  MemorySignal,
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
  nowMs?: number;
}

export interface ListMemoryRecordsOptions {
  providerId?: string;
  agentId?: string;
  workspaceId?: string;
  kind?: MemoryKind;
  limit?: number;
  offset?: number;
}

export interface SearchMemoryRecordsOptions {
  query: string;
  agentId?: string;
  workspaceId?: string;
  providerId?: string;
  kinds?: MemoryKind[];
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
  duration_ms: number;
  created_at: number;
};

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
  durationMs?: number;
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
  durationMs: number;
  createdAt: string;
}

function parseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
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
    scope: {
      agentId: row.agent_id,
      ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
      ...(row.session_key ? { sessionKey: row.session_key } : {}),
    },
    content: row.content,
    source: parseSource(row.source_json),
    ...(row.confidence != null ? { confidence: row.confidence } : {}),
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
  const source = {
    ...(input.source ?? {}),
    provider: input.source?.provider ?? input.providerId,
  };

  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO memory_records (
        record_id, provider_id, kind, agent_id, workspace_id, session_key,
        content, source_json, confidence, tags_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      now,
      now,
    );
    upsertMemoryRecordFts(db, { ...input, id });
  });

  return {
    id,
    kind: input.kind,
    scope: {
      agentId: input.agentId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    },
    content: input.content,
    source,
    ...(input.confidence != null ? { confidence: input.confidence } : {}),
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
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO memory_trace_events (
        trace_id, session_key, turn_id, phase, provider_id, request_json,
        result_count, selected_record_ids_json, skipped_reason, error, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  return rows.map((row) => ({
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
    durationMs: row.duration_ms,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

function parseJsonValue(json: string, fallback: unknown): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return fallback;
  }
}
