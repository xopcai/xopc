import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { validateSessionId } from '../../session/session-id.js';
import type { SessionListQuery, SessionMetadata, PaginatedResult } from '../../session/types.js';
import { buildDefaultSessionMetadata, type SessionMetadataSeed } from './session-metadata.js';
import {
  buildGlobalSessionStats,
  metadataToSessionInsert,
  sessionRowToMetadata,
  type SessionRow,
} from './row-mappers.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

const SESSION_COLUMNS = `
  s.session_key, s.agent_id, s.session_id, s.status, s.name, s.tags_json,
  s.created_at, s.updated_at, s.last_accessed_at, s.session_started_at, s.last_interaction_at,
  s.source_channel, s.source_chat_id, s.session_type, s.hidden_from_session_list,
  s.parent_session_key, s.workflow_run_id, s.workflow_definition_id, s.workflow_agent_id, s.workflow_agent_label,
  s.project_id, s.routing_json, s.custom_data_json,
  s.message_count, s.estimated_tokens, s.compacted_count,
  s.last_flushed_at, s.flush_count,
  s.thinking_level, s.verbose_level,
  t.cwd AS cwd
`;

import { buildFts5SearchQuery } from './fts.js';

const SESSION_FROM_JOIN = `
  FROM sessions s
  LEFT JOIN transcripts t ON t.session_id = s.session_id
`;

const SELECT_SESSION = `SELECT ${SESSION_COLUMNS} ${SESSION_FROM_JOIN} WHERE s.session_key = ?`;

function readSessionRow(db: DatabaseSync, sessionKey: string): SessionRow | undefined {
  return db.prepare(SELECT_SESSION).get(sessionKey) as SessionRow | undefined;
}

function insertSessionAndTranscript(
  db: DatabaseSync,
  sessionKey: string,
  sessionId: string,
  cwd: string,
  metadata: SessionMetadata,
): void {
  const row = metadataToSessionInsert(sessionKey, sessionId, metadata);
  db.prepare(
    `INSERT INTO sessions (
      session_key, agent_id, session_id, status, name, tags_json,
      created_at, updated_at, last_accessed_at, session_started_at, last_interaction_at,
      source_channel, source_chat_id, session_type, hidden_from_session_list,
      parent_session_key, workflow_run_id, workflow_definition_id, workflow_agent_id, workflow_agent_label,
      project_id, routing_json, custom_data_json,
      message_count, estimated_tokens, compacted_count,
      last_flushed_at, flush_count,
      thinking_level, verbose_level
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?
    )`,
  ).run(
    row.sessionKey,
    row.agentId,
    row.sessionId,
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
    row.hiddenFromSessionList,
    row.parentSessionKey,
    row.workflowRunId,
    row.workflowDefinitionId,
    row.workflowAgentId,
    row.workflowAgentLabel,
    row.projectId,
    row.routingJson,
    row.customDataJson,
    row.messageCount,
    row.estimatedTokens,
    row.compactedCount,
    row.lastFlushedAt,
    row.flushCount,
    row.thinkingLevel,
    row.verboseLevel,
  );

  const now = Date.now();
  db.prepare(
    `INSERT INTO transcripts (session_id, session_key, status, created_at, cwd)
     VALUES (?, ?, 'active', ?, ?)`,
  ).run(sessionId, sessionKey, now, cwd);
}

export function ensureSessionInTransaction(
  db: DatabaseSync,
  sessionKey: string,
  cwd: string,
  seed?: SessionMetadataSeed,
): SessionMetadata {
  const existing = readSessionRow(db, sessionKey);
  if (existing) {
    return sessionRowToMetadata(sessionKey, existing);
  }

  const sessionId = validateSessionId(randomUUID());
  const metadata = buildDefaultSessionMetadata(sessionKey, seed);
  metadata.sessionId = sessionId;
  insertSessionAndTranscript(db, sessionKey, sessionId, cwd, metadata);
  const row = readSessionRow(db, sessionKey);
  if (!row) {
    throw new Error(`Failed to create session: ${sessionKey}`);
  }
  return sessionRowToMetadata(sessionKey, row);
}

export function ensureSessionRecord(
  sessionKey: string,
  cwd: string,
  seed?: SessionMetadataSeed,
): SessionMetadata {
  return runSqliteWriteTransaction((db) => ensureSessionInTransaction(db, sessionKey, cwd, seed));
}

export function readCurrentSessionId(db: DatabaseSync, sessionKey: string): string | null {
  const row = db
    .prepare(`SELECT session_id FROM sessions WHERE session_key = ?`)
    .get(sessionKey) as { session_id?: string } | undefined;
  return row?.session_id ?? null;
}

export function getSessionMetadata(sessionKey: string): SessionMetadata | null {
  const db = getSqliteDatabase();
  const row = readSessionRow(db, sessionKey);
  if (!row) {
    return null;
  }
  return sessionRowToMetadata(sessionKey, row);
}

export function getCurrentSessionId(sessionKey: string): string | null {
  return readCurrentSessionId(getSqliteDatabase(), sessionKey);
}

export function listSessionMetadata(query: SessionListQuery = {}): PaginatedResult<SessionMetadata> {
  const db = getSqliteDatabase();
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (!query.includeHidden) {
    conditions.push(`s.hidden_from_session_list = 0`);
  }

  if (query.sessionTypes?.length) {
    conditions.push(`s.session_type IN (${query.sessionTypes.map(() => '?').join(', ')})`);
    params.push(...query.sessionTypes);
  } else if (!query.includeHidden) {
    conditions.push(`s.session_type = ?`);
    params.push('chat');
  }

  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    conditions.push(`s.status IN (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);
  }

  if (query.projectId) {
    conditions.push(`s.project_id = ?`);
    params.push(query.projectId);
  } else if (query.unassigned) {
    conditions.push(`(s.project_id IS NULL OR s.project_id = '')`);
  }

  if (query.updatedAfter !== undefined) {
    const clauses = [`s.updated_at >= ?`];
    params.push(query.updatedAfter);
    if (query.includePinned) {
      clauses.push(`s.status = 'pinned'`);
    }
    const includeSessionKey = query.includeSessionKey?.trim();
    if (includeSessionKey) {
      clauses.push(`s.session_key = ?`);
      params.push(includeSessionKey);
    }
    conditions.push(`(${clauses.join(' OR ')})`);
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
    conditions.push(`LOWER(s.source_channel) IN (${channels.map(() => '?').join(', ')})`);
    params.push(...channels);
  }

  if (query.tags?.length) {
    for (const tag of query.tags) {
      conditions.push(`s.tags_json LIKE ?`);
      params.push(`%"${tag}"%`);
    }
  }

  let searchKeys: string[] | null = null;
  if (query.search?.trim()) {
    const rawSearch = query.search.trim();
    const ftsQuery = buildFts5SearchQuery(rawSearch);
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
    conditions.push(`s.session_key IN (${searchKeys.map(() => '?').join(', ')})`);
    params.push(...searchKeys);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortColumn = sessionSortColumn(query.sortBy);
  const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const countRow = db
    .prepare(`SELECT COUNT(*) AS total FROM sessions s ${where}`)
    .get(...params) as { total: number };
  const total = countRow.total;

  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const rows = db
    .prepare(
      `SELECT ${SESSION_COLUMNS} ${SESSION_FROM_JOIN} ${where}
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
      return 's.created_at';
    case 'messageCount':
      return 's.message_count';
    case 'lastAccessedAt':
      return 's.last_accessed_at';
    case 'updatedAt':
    default:
      return 's.updated_at';
  }
}

export function patchSessionMetadata(
  sessionKey: string,
  updates: Partial<SessionMetadata>,
): SessionMetadata {
  return runSqliteWriteTransaction((db) => {
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
        hidden_from_session_list = ?,
        parent_session_key = ?,
        workflow_run_id = ?,
        workflow_definition_id = ?,
        workflow_agent_id = ?,
        workflow_agent_label = ?,
        project_id = ?,
        routing_json = ?,
        custom_data_json = ?,
        message_count = ?,
        estimated_tokens = ?,
        compacted_count = ?,
        last_flushed_at = ?,
        flush_count = ?,
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
      merged.sessionType,
      merged.hiddenFromSessionList ? 1 : 0,
      merged.parentSessionKey ?? null,
      merged.workflowRunId ?? null,
      merged.workflowDefinitionId ?? null,
      merged.workflowAgentId ?? null,
      merged.workflowAgentLabel ?? null,
      merged.projectId ?? null,
      merged.routing ? JSON.stringify(merged.routing) : null,
      merged.customData ? JSON.stringify(merged.customData) : null,
      merged.messageCount,
      merged.estimatedTokens,
      merged.compactedCount,
      merged.lastFlushedAt ?? null,
      merged.flushCount ?? 0,
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
  runSqliteWriteTransaction((db) => {
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
  runSqliteWriteTransaction((db) => {
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
  return runSqliteWriteTransaction((db) => {
    const existing = readSessionRow(db, sessionKey);
    if (!existing) {
      return null;
    }

    const previousSessionId = existing.session_id;
    const now = Date.now();
    db.prepare(
      `UPDATE transcripts SET status = 'archived', archive_reason = 'reset', archived_at = ?
       WHERE session_id = ?`,
    ).run(now, previousSessionId);

    const newSessionId = validateSessionId(randomUUID());
    db.prepare(
      `INSERT INTO transcripts (session_id, session_key, status, created_at, cwd)
       VALUES (?, ?, 'active', ?, ?)`,
    ).run(newSessionId, sessionKey, now, cwd);

    db.prepare(
      `UPDATE sessions SET
        session_id = ?,
        updated_at = ?,
        session_started_at = ?,
        last_interaction_at = NULL,
        message_count = 0,
        estimated_tokens = 0
      WHERE session_key = ?`,
    ).run(newSessionId, now, now, sessionKey);

    return { sessionId: newSessionId, previousSessionId };
  });
}

export function deleteSessionRecord(sessionKey: string): boolean {
  return runSqliteWriteTransaction((db) => {
    const existing = readSessionRow(db, sessionKey);
    if (!existing) {
      return false;
    }

    const now = Date.now();
    db.prepare(
      `UPDATE transcripts SET status = 'archived', archive_reason = 'delete', archived_at = ?
       WHERE session_id = ?`,
    ).run(now, existing.session_id);

    db.prepare(`DELETE FROM sessions WHERE session_key = ?`).run(sessionKey);
    return true;
  });
}

export function listSessionsByAgent(agentId: string): SessionMetadata[] {
  const db = getSqliteDatabase();
  const rows = db
    .prepare(
      `SELECT ${SESSION_COLUMNS} ${SESSION_FROM_JOIN}
       WHERE s.agent_id = ?
       ORDER BY s.updated_at DESC`,
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

export function findSessionKeyBySessionId(sessionId: string): string | null {
  const db = getSqliteDatabase();
  const row = db
    .prepare(`SELECT session_key FROM sessions WHERE session_id = ?`)
    .get(sessionId) as { session_key?: string } | undefined;
  return row?.session_key ?? null;
}

export function getGlobalSessionStats(): ReturnType<typeof buildGlobalSessionStats> {
  const all = listSessionMetadata({ limit: 100_000, offset: 0 });
  return buildGlobalSessionStats(all.items);
}

export function resolveSessionAgentId(sessionKey: string): string {
  return getSessionMetadata(sessionKey)?.routing?.agentId ?? 'main';
}
