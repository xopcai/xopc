import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { validateSessionId } from '../../session/session-id.js';
import type { SessionListQuery, SessionMetadata, PaginatedResult } from '../../session/types.js';
import {
  buildDefaultSessionMetadata,
  resolveAgentIdFromSessionKey,
} from './session-metadata.js';
import {
  buildGlobalSessionStats,
  metadataToSessionInsert,
  sessionRowToMetadata,
  type SessionRow,
} from './row-mappers.js';
import { getSqliteDatabase, withSqliteWriteTransaction } from './transaction.js';

const SESSION_COLUMNS = `
  session_key, agent_id, current_transcript_id, status, name, tags_json,
  created_at, updated_at, last_accessed_at, session_started_at, last_interaction_at,
  source_channel, source_chat_id, session_type, routing_json, custom_data_json,
  abort_cutoff_timestamp, message_count, estimated_tokens, compacted_count,
  thinking_level, verbose_level
`;

function escapeFts5Query(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  return `"${trimmed.replace(/"/g, '""')}"`;
}

const SELECT_SESSION = `SELECT ${SESSION_COLUMNS} FROM sessions WHERE session_key = ?`;

function readSessionRow(db: DatabaseSync, sessionKey: string): SessionRow | undefined {
  return db.prepare(SELECT_SESSION).get(sessionKey) as SessionRow | undefined;
}

function insertSessionAndTranscript(
  db: DatabaseSync,
  sessionKey: string,
  transcriptId: string,
  cwd: string,
  metadata: SessionMetadata,
): void {
  const row = metadataToSessionInsert(sessionKey, transcriptId, metadata);
  db.prepare(
    `INSERT INTO sessions (
      session_key, agent_id, current_transcript_id, status, name, tags_json,
      created_at, updated_at, last_accessed_at, session_started_at, last_interaction_at,
      source_channel, source_chat_id, session_type, routing_json, custom_data_json,
      abort_cutoff_timestamp, message_count, estimated_tokens, compacted_count,
      thinking_level, verbose_level
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?
    )`,
  ).run(
    row.sessionKey,
    row.agentId,
    row.transcriptId,
    row.status,
    row.name,
    row.tagsJson,
    row.createdAt,
    row.updatedAt,
    row.lastAccessedAt,
    row.sessionStartedAt,
    row.lastInteractionAt,
    row.sourceChannel,
    row.sourceChatId,
    row.sessionType,
    row.routingJson,
    row.customDataJson,
    row.abortCutoffTimestamp,
    row.messageCount,
    row.estimatedTokens,
    row.compactedCount,
    row.thinkingLevel,
    row.verboseLevel,
  );

  const now = Date.now();
  db.prepare(
    `INSERT INTO transcripts (transcript_id, session_key, status, created_at, cwd)
     VALUES (?, ?, 'active', ?, ?)`,
  ).run(transcriptId, sessionKey, now, cwd);
}

export function ensureSessionInTransaction(
  db: DatabaseSync,
  sessionKey: string,
  cwd: string,
): SessionMetadata {
  const existing = readSessionRow(db, sessionKey);
  if (existing) {
    return sessionRowToMetadata(sessionKey, existing);
  }

  const transcriptId = validateSessionId(randomUUID());
  const metadata = buildDefaultSessionMetadata(sessionKey);
  metadata.transcriptId = transcriptId;
  insertSessionAndTranscript(db, sessionKey, transcriptId, cwd, metadata);
  const row = readSessionRow(db, sessionKey);
  if (!row) {
    throw new Error(`Failed to create session: ${sessionKey}`);
  }
  return sessionRowToMetadata(sessionKey, row);
}

export function ensureSessionRecord(sessionKey: string, cwd: string): SessionMetadata {
  return withSqliteWriteTransaction((db) => ensureSessionInTransaction(db, sessionKey, cwd));
}

export function readCurrentTranscriptId(db: DatabaseSync, sessionKey: string): string | null {
  const row = db
    .prepare(`SELECT current_transcript_id FROM sessions WHERE session_key = ?`)
    .get(sessionKey) as { current_transcript_id?: string } | undefined;
  return row?.current_transcript_id ?? null;
}

export function getSessionMetadata(sessionKey: string): SessionMetadata | null {
  const db = getSqliteDatabase();
  const row = readSessionRow(db, sessionKey);
  if (!row) {
    return null;
  }
  return sessionRowToMetadata(sessionKey, row);
}

export function getCurrentTranscriptId(sessionKey: string): string | null {
  return readCurrentTranscriptId(getSqliteDatabase(), sessionKey);
}

export function listSessionMetadata(query: SessionListQuery = {}): PaginatedResult<SessionMetadata> {
  const db = getSqliteDatabase();
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);
  }

  if (query.channel) {
    const rawChannels = query.channel
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    const channels = [
      ...new Set(
        rawChannels.flatMap((c) => {
          if (c === 'webchat') return ['webchat', 'ui'];
          if (c === 'gateway') return ['gateway', 'webui'];
          return [c];
        }),
      ),
    ];
    if (channels.length === 0) {
      return { items: [], total: 0, limit: query.limit ?? 50, offset: query.offset ?? 0, hasMore: false };
    }
    const directMatch = `LOWER(source_channel) IN (${channels.map(() => '?').join(', ')})`;
    const keyPatterns = new Set<string>();
    for (const c of channels) {
      if (c === 'webchat' || c === 'ui') {
        keyPatterns.add(`session_key LIKE 'agent:%:webchat:%'`);
      } else if (c === 'gateway' || c === 'webui') {
        keyPatterns.add(`session_key LIKE 'agent:%:gateway:%'`);
      } else {
        keyPatterns.add(`session_key LIKE 'agent:%:${c.replace(/'/g, "''")}:%'`);
      }
    }
    const keyFallback =
      keyPatterns.size > 0
        ? `(TRIM(COALESCE(source_channel, '')) = '' AND (${[...keyPatterns].join(' OR ')}))`
        : '';
    conditions.push(keyFallback ? `(${directMatch} OR ${keyFallback})` : directMatch);
    params.push(...channels);
  }

  if (query.tags?.length) {
    for (const tag of query.tags) {
      conditions.push(`tags_json LIKE ?`);
      params.push(`%"${tag}"%`);
    }
  }

  let searchKeys: string[] | null = null;
  if (query.search?.trim()) {
    const rawSearch = query.search.trim();
    const ftsQuery = escapeFts5Query(rawSearch);
    const ftsRows = db
      .prepare(
        `SELECT DISTINCT session_key FROM transcript_fts WHERE transcript_fts MATCH ? LIMIT 500`,
      )
      .all(ftsQuery) as Array<{ session_key: string }>;
    const ftsKeys = new Set(ftsRows.map((r) => r.session_key));
    const like = `%${rawSearch.toLowerCase()}%`;
    const metaRows = db
      .prepare(
        `SELECT session_key FROM sessions
         WHERE LOWER(session_key) LIKE ?
            OR LOWER(COALESCE(name, '')) LIKE ?
            OR LOWER(source_channel) LIKE ?
            OR LOWER(source_chat_id) LIKE ?
            OR LOWER(tags_json) LIKE ?`,
      )
      .all(like, like, like, like, like) as Array<{ session_key: string }>;
    searchKeys = [...new Set([...ftsKeys, ...metaRows.map((r) => r.session_key)])];
    if (searchKeys.length === 0) {
      return { items: [], total: 0, limit: query.limit ?? 50, offset: query.offset ?? 0, hasMore: false };
    }
    conditions.push(`session_key IN (${searchKeys.map(() => '?').join(', ')})`);
    params.push(...searchKeys);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortColumn = sessionSortColumn(query.sortBy);
  const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const countRow = db
    .prepare(`SELECT COUNT(*) AS total FROM sessions ${where}`)
    .get(...params) as { total: number };
  const total = countRow.total;

  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const rows = db
    .prepare(
      `SELECT ${SESSION_COLUMNS} FROM sessions ${where}
       ORDER BY ${sortColumn} ${sortOrder}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as SessionRow[];

  const items = rows.map((row) => sessionRowToMetadata(row.session_key, row));
  return { items, total, limit, offset, hasMore: offset + limit < total };
}

function sessionSortColumn(sortBy: SessionListQuery['sortBy']): string {
  switch (sortBy) {
    case 'createdAt':
      return 'created_at';
    case 'messageCount':
      return 'message_count';
    case 'lastAccessedAt':
      return 'last_accessed_at';
    case 'updatedAt':
    default:
      return 'updated_at';
  }
}

export function patchSessionMetadata(
  sessionKey: string,
  updates: Partial<SessionMetadata>,
): SessionMetadata {
  return withSqliteWriteTransaction((db) => {
    const existing = readSessionRow(db, sessionKey);
    if (!existing) {
      throw new Error(`Session not found: ${sessionKey}`);
    }

    const current = sessionRowToMetadata(sessionKey, existing);
    const merged = { ...current, ...updates, key: sessionKey };
    const now = Date.now();

    db.prepare(
      `UPDATE sessions SET
        status = ?,
        name = ?,
        tags_json = ?,
        updated_at = ?,
        last_accessed_at = ?,
        session_started_at = ?,
        last_interaction_at = ?,
        source_channel = ?,
        source_chat_id = ?,
        session_type = ?,
        routing_json = ?,
        custom_data_json = ?,
        abort_cutoff_timestamp = ?,
        message_count = ?,
        estimated_tokens = ?,
        compacted_count = ?,
        thinking_level = ?,
        verbose_level = ?
      WHERE session_key = ?`,
    ).run(
      merged.status,
      merged.name ?? null,
      JSON.stringify(merged.tags ?? []),
      Date.parse(merged.updatedAt) || now,
      Date.parse(merged.lastAccessedAt) || now,
      merged.sessionStartedAt ? Date.parse(merged.sessionStartedAt) : existing.session_started_at,
      merged.lastInteractionAt ? Date.parse(merged.lastInteractionAt) : existing.last_interaction_at,
      merged.sourceChannel,
      merged.sourceChatId,
      merged.sessionType ?? null,
      merged.routing ? JSON.stringify(merged.routing) : null,
      merged.customData ? JSON.stringify(merged.customData) : null,
      merged.abortCutoffTimestamp ?? null,
      merged.messageCount,
      merged.estimatedTokens,
      merged.compactedCount,
      existing.thinking_level,
      existing.verbose_level,
      sessionKey,
    );

    const row = readSessionRow(db, sessionKey);
    if (!row) {
      throw new Error(`Session not found after patch: ${sessionKey}`);
    }
    return sessionRowToMetadata(sessionKey, row);
  });
}

export function updateSessionStats(
  sessionKey: string,
  stats: { messageCount: number; estimatedTokens: number; lastInteractionAt?: number },
): void {
  withSqliteWriteTransaction((db) => {
    const now = stats.lastInteractionAt ?? Date.now();
    db.prepare(
      `UPDATE sessions SET
        message_count = ?,
        estimated_tokens = ?,
        updated_at = ?,
        last_accessed_at = ?,
        last_interaction_at = ?
      WHERE session_key = ?`,
    ).run(stats.messageCount, stats.estimatedTokens, now, now, now, sessionKey);
  });
}

export function incrementSessionStatsOnAppend(sessionKey: string, tokenDelta = 0): void {
  withSqliteWriteTransaction((db) => {
    const now = Date.now();
    db.prepare(
      `UPDATE sessions SET
        message_count = message_count + 1,
        estimated_tokens = estimated_tokens + ?,
        updated_at = ?,
        last_accessed_at = ?,
        last_interaction_at = ?
      WHERE session_key = ?`,
    ).run(tokenDelta, now, now, now, sessionKey);
  });
}

export function resetSessionRecord(
  sessionKey: string,
  cwd: string,
): { sessionId: string; previousSessionId: string } | null {
  return withSqliteWriteTransaction((db) => {
    const existing = readSessionRow(db, sessionKey);
    if (!existing) {
      return null;
    }

    const previousSessionId = existing.current_transcript_id;
    const now = Date.now();
    db.prepare(
      `UPDATE transcripts SET status = 'archived', archive_reason = 'reset', archived_at = ?
       WHERE transcript_id = ?`,
    ).run(now, previousSessionId);

    const newTranscriptId = validateSessionId(randomUUID());
    db.prepare(
      `INSERT INTO transcripts (transcript_id, session_key, status, created_at, cwd)
       VALUES (?, ?, 'active', ?, ?)`,
    ).run(newTranscriptId, sessionKey, now, cwd);

    db.prepare(
      `UPDATE sessions SET
        current_transcript_id = ?,
        updated_at = ?,
        session_started_at = ?,
        last_interaction_at = NULL,
        message_count = 0,
        estimated_tokens = 0
      WHERE session_key = ?`,
    ).run(newTranscriptId, now, now, sessionKey);

    return { sessionId: newTranscriptId, previousSessionId };
  });
}

export function deleteSessionRecord(sessionKey: string): boolean {
  return withSqliteWriteTransaction((db) => {
    const existing = readSessionRow(db, sessionKey);
    if (!existing) {
      return false;
    }

    const now = Date.now();
    db.prepare(
      `UPDATE transcripts SET status = 'archived', archive_reason = 'delete', archived_at = ?
       WHERE transcript_id = ?`,
    ).run(now, existing.current_transcript_id);

    db.prepare(`DELETE FROM sessions WHERE session_key = ?`).run(sessionKey);
    return true;
  });
}

export function listSessionsByAgent(agentId: string): SessionMetadata[] {
  const db = getSqliteDatabase();
  const rows = db
    .prepare(
      `SELECT ${SESSION_COLUMNS} FROM sessions WHERE agent_id = ? ORDER BY updated_at DESC`,
    )
    .all(agentId.toLowerCase()) as SessionRow[];
  return rows.map((row) => sessionRowToMetadata(row.session_key, row));
}

export function getSessionPersistedLevels(sessionKey: string): {
  thinkingLevel: string | null;
  verboseLevel: string | null;
} | null {
  const db = getSqliteDatabase();
  const row = db
    .prepare(`SELECT thinking_level, verbose_level FROM sessions WHERE session_key = ?`)
    .get(sessionKey) as { thinking_level: string | null; verbose_level: string | null } | undefined;
  if (!row) {
    return null;
  }
  return { thinkingLevel: row.thinking_level, verboseLevel: row.verbose_level };
}

export function findSessionKeyByTranscriptId(transcriptId: string): string | null {
  const db = getSqliteDatabase();
  const row = db
    .prepare(`SELECT session_key FROM sessions WHERE current_transcript_id = ?`)
    .get(transcriptId) as { session_key?: string } | undefined;
  return row?.session_key ?? null;
}

export function getGlobalSessionStats(): ReturnType<typeof buildGlobalSessionStats> {
  const all = listSessionMetadata({ limit: 100_000, offset: 0 });
  return buildGlobalSessionStats(all.items);
}

export function resolveSessionAgentId(sessionKey: string): string {
  return resolveAgentIdFromSessionKey(sessionKey);
}
