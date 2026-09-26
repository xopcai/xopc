import { cancelConnectionObjective } from './connection-wait-repository.js';
import { randomUUID } from 'node:crypto';
import { validateConversationId, validateTranscriptId } from '@xopcai/gateway-contract';
import type { DatabaseSync } from 'node:sqlite';

import { notifyUserContextChange } from '../../user-context/changes.js';
import type { SessionListQuery, SessionMetadata, PaginatedResult } from '../../session/types.js';
import { buildDefaultSessionMetadata, type SessionMetadataSeed } from './session-metadata.js';
import { readCurrentTranscriptId } from './session-instance-repository.js';
import {
  buildGlobalSessionStats,
  metadataToSessionInsert,
  sessionRowToMetadata,
  type SessionRow,
} from './row-mappers.js';
import { optionalTimestampToMs } from './timestamps.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';
import { SESSION_PURPOSE_SQL, SESSION_SOURCE_SQL } from './session-identity-sql.js';

import { buildFts5SearchQuery } from './fts.js';
import { getSessionMetadata, readSessionRow, SESSION_COLUMNS, SESSION_FROM_JOIN } from './session-read-repository.js';

export { getSessionMetadata } from './session-read-repository.js';

function insertSessionAndTranscript(
  db: DatabaseSync,
  conversationId: string,
  transcriptId: string,
  cwd: string,
  metadata: SessionMetadata,
): void {
  const row = metadataToSessionInsert(conversationId, transcriptId, metadata);
  db.prepare(
    `INSERT INTO sessions (
      conversation_id, agent_id, active_transcript_id, status, name, tags_json,
      created_at, updated_at, last_accessed_at, session_started_at, last_interaction_at,
      source_channel, source_chat_id, session_type, hidden_from_session_list,
      parent_conversation_id, workflow_run_id, workflow_definition_id, workflow_agent_id, workflow_agent_label,
      project_id, routing_json, custom_data_json,
      message_count, estimated_tokens, compacted_count,
      last_flushed_at, flush_count
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )`,
  ).run(
    row.conversationId,
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
    row.hiddenFromSessionList,
    row.parentConversationId,
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
  );

  const now = Date.now();
  db.prepare(
    `INSERT INTO transcripts (transcript_id, conversation_id, status, created_at, cwd)
     VALUES (?, ?, 'active', ?, ?)`,
  ).run(transcriptId, conversationId, now, cwd);
}

export function ensureSessionInTransaction(
  db: DatabaseSync,
  conversationId: string,
  cwd: string,
  seed?: SessionMetadataSeed,
): SessionMetadata {
  validateConversationId(conversationId);
  const existing = readSessionRow(db, conversationId);
  if (existing) {
    if (!existing.cwd && cwd) {
      db.prepare('UPDATE transcripts SET cwd=? WHERE transcript_id=?').run(cwd, existing.active_transcript_id);
      existing.cwd = cwd;
    }
    return sessionRowToMetadata(conversationId, existing);
  }

  const transcriptId = validateTranscriptId(randomUUID());
  const metadata = buildDefaultSessionMetadata(conversationId, seed);
  metadata.transcriptId = transcriptId;
  insertSessionAndTranscript(db, conversationId, transcriptId, cwd, metadata);
  const row = readSessionRow(db, conversationId);
  if (!row) {
    throw new Error(`Failed to create session: ${conversationId}`);
  }
  return sessionRowToMetadata(conversationId, row);
}

export function ensureSessionRecord(
  conversationId: string,
  cwd: string,
  seed?: SessionMetadataSeed,
): SessionMetadata {
  return runSqliteWriteTransaction((db) => ensureSessionInTransaction(db, conversationId, cwd, seed));
}

export { readCurrentTranscriptId } from './session-instance-repository.js';

export function getCurrentTranscriptId(conversationId: string): string | null {
  return readCurrentTranscriptId(getSqliteDatabase(), conversationId);
}

export function listSessionMetadata(query: SessionListQuery = {}): PaginatedResult<SessionMetadata> {
  const db = getSqliteDatabase();
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (!query.includeHidden) {
    conditions.push(`s.hidden_from_session_list = 0`);
    // Deterministic memory-maintenance automations are operational records, not
    // user conversations. Keep both newly marked and legacy rows out of every
    // user-facing session query even if older metadata revealed the session.
    conditions.push(`NOT (
      s.source_channel = 'automation'
      AND (
        COALESCE(CASE WHEN json_valid(s.custom_data_json)
          THEN json_extract(s.custom_data_json, '$.systemInternal') END, 0) = 1
        OR COALESCE(CASE WHEN json_valid(s.custom_data_json)
          THEN json_extract(s.custom_data_json, '$.automationId') END, '') LIKE 'system-memory-%'
      )
    )`);
    // Legacy background sessions may have been revealed by their internal user
    // prompt before any assistant/result output was persisted. Keep those
    // shells out of user-facing lists without deleting their run linkage.
    conditions.push(`(
      s.source_channel NOT IN ('automation', 'workflow')
      OR COALESCE(TRIM(s.name), '') != ''
      OR EXISTS (
        SELECT 1 FROM transcript_entries visible_output
        WHERE visible_output.transcript_id = s.active_transcript_id
          AND visible_output.role IN ('assistant', 'toolResult')
      )
    )`);
  }

  if (query.sessionTypes?.length) {
    conditions.push(`s.session_type IN (${query.sessionTypes.map(() => '?').join(', ')})`);
    params.push(...query.sessionTypes);
  } else if (!query.includeHidden && !query.purposes?.length && !query.activity && !query.sources?.length) {
    conditions.push(`s.session_type = ?`);
    params.push('chat');
  }

  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    conditions.push(`s.status IN (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);
  }

  if (query.excludeArchived) conditions.push(`s.status != 'archived'`);
  if (query.sources?.length) {
    conditions.push(`${SESSION_SOURCE_SQL} IN (${query.sources.map(() => '?').join(',')})`);
    params.push(...query.sources);
  }
  if (query.purposes?.length) {
    conditions.push(`${SESSION_PURPOSE_SQL} IN (${query.purposes.map(() => '?').join(',')})`);
    params.push(...query.purposes);
  }
  if (query.activity === 'automatic') conditions.push(`${SESSION_SOURCE_SQL} IN ('automation', 'system')`);
  if (query.activity === 'manual') {
    conditions.push(`${SESSION_PURPOSE_SQL} = 'chat' AND ${SESSION_SOURCE_SQL} NOT IN ('automation', 'system')`);
  }
  if (query.agentId) {
    conditions.push('s.agent_id = ?');
    params.push(query.agentId);
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
    const includeConversationId = query.includeConversationId?.trim();
    if (includeConversationId) {
      clauses.push(`s.conversation_id = ?`);
      params.push(includeConversationId);
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

  if (query.search?.trim()) {
    const rawSearch = query.search.trim();
    const like = `%${rawSearch.toLowerCase()}%`;
    // Keep FTS selection inside SQLite so filtering/counting covers all matches,
    // without a pre-pagination cap or SQLite's bound-parameter limit.
    conditions.push(`(s.conversation_id IN (
      SELECT conversation_id FROM transcript_fts WHERE transcript_fts MATCH ?
    ) OR LOWER(s.conversation_id) LIKE ?
      OR LOWER(COALESCE(s.name, '')) LIKE ?
      OR LOWER(s.source_channel) LIKE ?
      OR LOWER(s.source_chat_id) LIKE ?
      OR LOWER(s.tags_json) LIKE ?)`);
    params.push(buildFts5SearchQuery(rawSearch), like, like, like, like, like);
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
       ORDER BY ${sortColumn} ${sortOrder}, s.conversation_id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as SessionRow[];

  const items = rows.map((row) => sessionRowToMetadata(row.conversation_id, row));
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
  conversationId: string,
  updates: Partial<SessionMetadata>,
): SessionMetadata {
  if ('projectId' in updates) notifyUserContextChange({ kind: 'session-reset', id: conversationId });
  return runSqliteWriteTransaction((db) => {
    const existing = readSessionRow(db, conversationId);
    if (!existing) {
      throw new Error(`Session not found: ${conversationId}`);
    }

    const requestedAgentId = updates.agentId ?? updates.routing?.agentId;
    if (requestedAgentId && requestedAgentId.trim().toLowerCase() !== existing.agent_id) {
      throw new Error('Changing a conversation agent requires a new conversation');
    }
    const current = sessionRowToMetadata(conversationId, existing);
    const merged = { ...current, ...updates, key: conversationId };
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
        parent_conversation_id = ?,
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
        flush_count = ?
      WHERE conversation_id = ?`,
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
      merged.parentConversationId ?? null,
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
      optionalTimestampToMs(merged.lastFlushedAt),
      merged.flushCount ?? 0,
      conversationId,
    );

    const row = readSessionRow(db, conversationId);
    if (!row) {
      throw new Error(`Session not found after patch: ${conversationId}`);
    }
    return sessionRowToMetadata(conversationId, row);
  });
}

export function updateSessionStats(
  conversationId: string,
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
      WHERE conversation_id = ?`,
    ).run(stats.messageCount, stats.estimatedTokens, now, now, now, conversationId);
  });
}

export function incrementSessionStatsOnAppend(conversationId: string, tokenDelta = 0): void {
  runSqliteWriteTransaction((db) => {
    const now = Date.now();
    db.prepare(
      `UPDATE sessions SET
        message_count = message_count + 1,
        estimated_tokens = estimated_tokens + ?,
        updated_at = ?,
        last_accessed_at = ?,
        last_interaction_at = ?
      WHERE conversation_id = ?`,
    ).run(tokenDelta, now, now, now, conversationId);
  });
}

export function resetSessionRecord(
  conversationId: string,
  cwd: string,
): { transcriptId: string; previousTranscriptId: string } | null {
  notifyUserContextChange({ kind: 'session-reset', id: conversationId });
  return runSqliteWriteTransaction((db) => {
    const existing = readSessionRow(db, conversationId);
    if (!existing) {
      return null;
    }

    cancelConnectionObjective(conversationId);
    const previousTranscriptId = existing.active_transcript_id;
    const now = Date.now();
    db.prepare(
      `UPDATE transcripts SET status = 'archived', archive_reason = 'reset', archived_at = ?
       WHERE transcript_id = ?`,
    ).run(now, previousTranscriptId);

    const newTranscriptId = validateTranscriptId(randomUUID());
    db.prepare(
      `INSERT INTO transcripts (transcript_id, conversation_id, status, created_at, cwd)
       VALUES (?, ?, 'active', ?, ?)`,
    ).run(newTranscriptId, conversationId, now, cwd);

    db.prepare(
      `UPDATE sessions SET
        active_transcript_id = ?,
        updated_at = ?,
        session_started_at = ?,
        last_interaction_at = NULL,
        message_count = 0,
        estimated_tokens = 0
      WHERE conversation_id = ?`,
    ).run(newTranscriptId, now, now, conversationId);

    return { transcriptId: newTranscriptId, previousTranscriptId };
  });
}

export function deleteSessionRecord(conversationId: string): boolean {
  notifyUserContextChange({ kind: 'session-reset', id: conversationId });
  return runSqliteWriteTransaction((db) => {
    const existing = readSessionRow(db, conversationId);
    if (!existing) {
      return false;
    }

    const now = Date.now();
    db.prepare(
      `UPDATE transcripts SET status = 'archived', archive_reason = 'delete', archived_at = ?
       WHERE transcript_id = ?`,
    ).run(now, existing.active_transcript_id);

    cancelConnectionObjective(conversationId);
    db.prepare(`DELETE FROM sessions WHERE conversation_id = ?`).run(conversationId);
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
  return rows.map((row) => sessionRowToMetadata(row.conversation_id, row));
}

export function findConversationIdByTranscriptId(transcriptId: string): string | null {
  const db = getSqliteDatabase();
  const row = db
    .prepare(`SELECT conversation_id FROM sessions WHERE active_transcript_id = ?`)
    .get(transcriptId) as { conversation_id?: string } | undefined;
  return row?.conversation_id ?? null;
}

export function getGlobalSessionStats(): ReturnType<typeof buildGlobalSessionStats> {
  const all = listSessionMetadata({ limit: 100_000, offset: 0 });
  return buildGlobalSessionStats(all.items);
}

export function resolveSessionAgentId(conversationId: string): string {
  return getSessionMetadata(conversationId)?.routing?.agentId ?? 'main';
}
