import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { MediaRef } from '../../media/types.js';
import type { CompactionBoundarySummary } from '../../session/types.js';
import {
  buildSessionContextForLlm,
  isRuntimeOnlyTranscriptMessage,
  type TranscriptStoredRow,
  type XopcTranscriptCompactionEntry,
} from '../../session/session-context-for-llm.js';
import {
  classifyStoredRow,
  estimateTokensFromMessages,
  extractFtsContent,
  transcriptEntryRowToStoredRow,
  type TranscriptEntryRow,
} from './row-mappers.js';
import { getCurrentTranscriptId, readCurrentTranscriptId } from './session-repository.js';
import { escapeFts5Query } from './fts.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export interface TranscriptSourceEntry {
  entryId: string;
  seq: number;
  createdAt: number;
  row: TranscriptStoredRow;
}

export interface CompactionSourceSnapshot {
  transcriptId: string;
  lastSeq: number;
  entries: TranscriptSourceEntry[];
}

export interface SessionTranscriptRecallMatch {
  entryId: string;
  seq: number;
  role: string | null;
  createdAt: number;
  content: string;
}

function nextSeq(db: DatabaseSync, transcriptId: string): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(seq), 0) AS max_seq FROM transcript_entries WHERE transcript_id = ?`)
    .get(transcriptId) as { max_seq: number };
  return (row.max_seq ?? 0) + 1;
}

function shouldRevealSessionForUserMessage(db: DatabaseSync, conversationId: string): boolean {
  const row = db.prepare(`SELECT custom_data_json FROM sessions WHERE conversation_id = ?`)
    .get(conversationId) as { custom_data_json?: string | null } | undefined;
  if (!row?.custom_data_json) return true;
  try {
    const customData = JSON.parse(row.custom_data_json) as Record<string, unknown>;
    return customData.deferVisibilityUntilOutput !== true;
  } catch {
    return true;
  }
}

function insertEntry(
  db: DatabaseSync,
  params: {
    transcriptId: string;
    conversationId: string;
    row: TranscriptStoredRow;
    entryId?: string;
    createdAt?: number;
  },
): TranscriptEntryRow {
  const { entryKind, role } = classifyStoredRow(params.row);
  const entryId = params.entryId ?? randomUUID();
  const seq = nextSeq(db, params.transcriptId);
  const createdAt = params.createdAt ?? Date.now();
  const payloadJson = JSON.stringify(params.row);

  db.prepare(
    `INSERT INTO transcript_entries (entry_id, transcript_id, seq, entry_kind, role, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(entryId, params.transcriptId, seq, entryKind, role, payloadJson, createdAt);

  const content = extractFtsContent(params.row);
  if (content.trim()) {
    db.prepare(
      `INSERT INTO transcript_fts (content, conversation_id, transcript_id, entry_id)
       VALUES (?, ?, ?, ?)`,
    ).run(content, params.conversationId, params.transcriptId, entryId);
  }

  return {
    entry_id: entryId,
    transcript_id: params.transcriptId,
    seq,
    entry_kind: entryKind,
    role,
    payload_json: payloadJson,
    created_at: createdAt,
  };
}

function isUserMessageRow(row: TranscriptStoredRow): boolean {
  const classified = classifyStoredRow(row);
  return classified.entryKind === 'message' && classified.role === 'user';
}

function withSessionInputContextMetadata(
  db: DatabaseSync,
  conversationId: string,
  row: TranscriptStoredRow,
): TranscriptStoredRow {
  if (!isUserMessageRow(row)) return row;
  const message = row as AgentMessage & { turnId?: unknown; metadata?: unknown };
  const turnId = typeof message.turnId === 'string' ? message.turnId.trim() : '';
  if (!turnId) return row;
  const metadata = message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
    ? message.metadata as Record<string, unknown>
    : {};
  if (Array.isArray(metadata.sourceContexts) && metadata.sourceContexts.length > 0) return row;

  const input = db.prepare(
    `SELECT context_refs_json FROM session_inputs
     WHERE conversation_id = ? AND run_id = ? AND context_refs_json IS NOT NULL
     LIMIT 1`,
  ).get(conversationId, turnId) as { context_refs_json: string } | undefined;
  if (!input) return row;

  try {
    const sourceContexts = JSON.parse(input.context_refs_json) as unknown;
    if (!Array.isArray(sourceContexts) || sourceContexts.length === 0) return row;
    return {
      ...message,
      metadata: { ...metadata, sourceContexts },
    } as unknown as TranscriptStoredRow;
  } catch {
    return row;
  }
}

export function appendTranscriptEntry(
  conversationId: string,
  row: TranscriptStoredRow,
  opts?: { transcriptId?: string; tokenDelta?: number },
): TranscriptEntryRow {
  if (isRuntimeOnlyTranscriptMessage(row)) {
    throw new Error('Runtime-only messages cannot be persisted in a session transcript');
  }
  return runSqliteWriteTransaction((db) => {
    const transcriptId = opts?.transcriptId ?? readCurrentTranscriptId(db, conversationId);
    if (!transcriptId) {
      throw new Error(`Session not found: ${conversationId}`);
    }
    const persistedRow = withSessionInputContextMetadata(db, conversationId, row);
    const inserted = insertEntry(db, { transcriptId, conversationId, row: persistedRow });
    if (classifyStoredRow(persistedRow).entryKind === 'message') {
      const tokenDelta = opts?.tokenDelta ?? 0;
      const now = Date.now();
      const hiddenUpdate = isUserMessageRow(persistedRow)
        && shouldRevealSessionForUserMessage(db, conversationId)
        ? `hidden_from_session_list = 0,`
        : '';
      db.prepare(
        `UPDATE sessions SET
          message_count = message_count + 1,
          estimated_tokens = estimated_tokens + ?,
          ${hiddenUpdate}
          updated_at = ?,
          last_accessed_at = ?,
          last_interaction_at = ?
        WHERE conversation_id = ?`,
      ).run(tokenDelta, now, now, now, conversationId);
    }
    return inserted;
  });
}

export function appendCompactionBoundaryIfUnchanged(
  conversationId: string,
  expected: Pick<CompactionSourceSnapshot, 'transcriptId' | 'lastSeq'>,
  row: Omit<XopcTranscriptCompactionEntry, 'baseSeq'>,
): TranscriptEntryRow | null {
  return runSqliteWriteTransaction((db) => {
    const transcriptId = readCurrentTranscriptId(db, conversationId);
    if (!transcriptId) throw new Error(`Session not found: ${conversationId}`);
    if (transcriptId !== expected.transcriptId) return null;
    const currentLastSeq = nextSeq(db, transcriptId) - 1;
    if (currentLastSeq !== expected.lastSeq) return null;
    const boundary = { ...row, baseSeq: expected.lastSeq };
    const inserted = insertEntry(db, { transcriptId, conversationId, row: boundary });
    const now = Date.now();
    db.prepare(
      `UPDATE sessions SET
        message_count = ?,
        estimated_tokens = ?,
        compacted_count = compacted_count + 1,
        updated_at = ?,
        last_accessed_at = ?,
        last_interaction_at = ?
       WHERE conversation_id = ?`,
    ).run(boundary.messages.length, boundary.tokensAfter, now, now, now, conversationId);
    return inserted;
  });
}

export function loadCompactionSourceSnapshot(conversationId: string): CompactionSourceSnapshot | null {
  const db = getSqliteDatabase();
  const transcriptId = getCurrentTranscriptId(conversationId);
  if (!transcriptId) return null;
  const rows = db
    .prepare(
      `SELECT entry_id, transcript_id, seq, entry_kind, role, payload_json, created_at
       FROM transcript_entries
       WHERE transcript_id = ?
       ORDER BY seq ASC`,
    )
    .all(transcriptId) as TranscriptEntryRow[];
  return {
    transcriptId,
    lastSeq: rows.at(-1)?.seq ?? 0,
    entries: rows.map((entry) => ({
      entryId: entry.entry_id,
      seq: entry.seq,
      createdAt: entry.created_at,
      row: transcriptEntryRowToStoredRow(entry),
    })),
  };
}

export function searchSessionTranscript(
  conversationId: string,
  query: string,
  options: { limit?: number; beforeSeq?: number } = {},
): SessionTranscriptRecallMatch[] {
  const transcriptId = getCurrentTranscriptId(conversationId);
  const normalized = query.trim();
  if (!transcriptId || !normalized) return [];
  const limit = Math.min(20, Math.max(1, options.limit ?? 8));
  const beforeSeq = options.beforeSeq ?? Number.MAX_SAFE_INTEGER;
  const db = getSqliteDatabase();
  const ftsRows = db
    .prepare(
      `SELECT e.entry_id, e.seq, e.role, e.created_at, f.content
       FROM transcript_fts f
       JOIN transcript_entries e
         ON e.transcript_id = f.transcript_id AND e.entry_id = f.entry_id
       WHERE transcript_fts MATCH ?
         AND f.transcript_id = ?
         AND e.entry_kind <> 'compaction'
         AND e.seq < ?
       ORDER BY bm25(transcript_fts), e.seq DESC
       LIMIT ?`,
    )
    .all(escapeFts5Query(normalized), transcriptId, beforeSeq, limit);
  const escapedLike = normalized.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
  const literalRows = db
    .prepare(
      `SELECT entry_id, seq, role, created_at, payload_json AS content
       FROM transcript_entries
       WHERE transcript_id = ?
         AND entry_kind <> 'compaction'
         AND seq < ?
         AND payload_json LIKE ? ESCAPE '\\'
       ORDER BY seq DESC
       LIMIT ?`,
    )
    .all(transcriptId, beforeSeq, `%${escapedLike}%`, limit);
  const seen = new Set<string>();
  return [...ftsRows, ...literalRows]
    .flatMap((row) => {
      const result = row as {
        entry_id: string;
        seq: number;
        role: string | null;
        created_at: number;
        content: string;
      };
      if (seen.has(result.entry_id)) return [];
      seen.add(result.entry_id);
      return [{
        entryId: result.entry_id,
        seq: result.seq,
        role: result.role,
        createdAt: result.created_at,
        content: result.content,
      }];
    })
    .slice(0, limit);
}

export function loadTranscriptRowsForSession(conversationId: string): TranscriptStoredRow[] {
  const transcriptId = getCurrentTranscriptId(conversationId);
  if (!transcriptId) {
    return [];
  }
  return loadTranscriptRows(transcriptId);
}

export function loadTranscriptHistoryRowsForSession(conversationId: string): TranscriptStoredRow[] {
  if (!getCurrentTranscriptId(conversationId)) {
    return [];
  }
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT e.entry_id, e.transcript_id, e.seq, e.entry_kind, e.role, e.payload_json, e.created_at
       FROM transcript_entries e
       JOIN transcripts t ON t.transcript_id = e.transcript_id
       WHERE t.conversation_id = ?
         AND (t.status = 'active' OR t.archive_reason IN ('reset', 'stale'))
       ORDER BY t.created_at ASC, t.rowid ASC, e.seq ASC`,
    )
    .all(conversationId) as TranscriptEntryRow[];
  return rows.map(transcriptEntryRowToStoredRow);
}

export function loadTranscriptRows(transcriptId: string): TranscriptStoredRow[] {
  const db = getSqliteDatabase();
  const rows = db
    .prepare(
      `SELECT entry_id, transcript_id, seq, entry_kind, role, payload_json, created_at
       FROM transcript_entries
       WHERE transcript_id = ?
       ORDER BY seq ASC`,
    )
    .all(transcriptId) as TranscriptEntryRow[];
  return rows.map(transcriptEntryRowToStoredRow);
}

export function loadLlmMessagesForSession(conversationId: string): AgentMessage[] {
  const transcriptId = getCurrentTranscriptId(conversationId);
  if (!transcriptId) return [];
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT entry_id, transcript_id, seq, entry_kind, role, payload_json, created_at
       FROM transcript_entries
       WHERE transcript_id = ?
         AND seq >= COALESCE(
           (SELECT MAX(seq) FROM transcript_entries WHERE transcript_id = ? AND entry_kind = 'compaction'),
           1
         )
       ORDER BY seq ASC`,
    )
    .all(transcriptId, transcriptId) as TranscriptEntryRow[];
  const activeRows = rows.map(transcriptEntryRowToStoredRow);
  return buildSessionContextForLlm(activeRows);
}

export function findLatestAssistantTranscriptEntryId(conversationId: string): string | null {
  const transcriptId = getCurrentTranscriptId(conversationId);
  if (!transcriptId) return null;
  const row = getSqliteDatabase()
    .prepare(
      `SELECT entry_id
       FROM transcript_entries
       WHERE transcript_id = ? AND entry_kind = 'message' AND role = 'assistant'
       ORDER BY seq DESC
       LIMIT 1`,
    )
    .get(transcriptId) as { entry_id: string } | undefined;
  return row?.entry_id ?? null;
}

/** Attach generated media to one exact assistant row without rewriting the transcript. */
export function appendMediaToAssistantTranscriptEntry(
  conversationId: string,
  entryId: string,
  media: MediaRef,
): boolean {
  if (!entryId.trim() || !media.uri?.trim()) return false;
  return runSqliteWriteTransaction((db) => {
    const transcriptId = readCurrentTranscriptId(db, conversationId);
    if (!transcriptId) return false;
    const row = db
      .prepare(
        `SELECT payload_json
         FROM transcript_entries
         WHERE transcript_id = ? AND entry_id = ? AND entry_kind = 'message' AND role = 'assistant'`,
      )
      .get(transcriptId, entryId) as { payload_json: string } | undefined;
    if (!row) return false;

    let message: AgentMessage & { media?: MediaRef[] };
    try {
      message = JSON.parse(row.payload_json) as AgentMessage & { media?: MediaRef[] };
    } catch {
      return false;
    }
    const existing = Array.isArray(message.media) ? message.media : [];
    if (existing.some((item) => item?.uri === media.uri)) return true;
    const next = { ...message, media: [...existing, media] };
    const result = db.prepare(
      `UPDATE transcript_entries SET payload_json = ?
       WHERE transcript_id = ? AND entry_id = ?`,
    ).run(JSON.stringify(next), transcriptId, entryId);
    return result.changes === 1;
  });
}

export function replaceTranscriptRows(
  conversationId: string,
  rows: TranscriptStoredRow[],
): void {
  if (rows.some(isRuntimeOnlyTranscriptMessage)) {
    throw new Error('Runtime-only messages cannot be persisted in a session transcript');
  }
  runSqliteWriteTransaction((db) => {
    const transcriptId = readCurrentTranscriptId(db, conversationId);
    if (!transcriptId) {
      throw new Error(`Session not found: ${conversationId}`);
    }

    db.prepare(`DELETE FROM transcript_fts WHERE transcript_id = ?`).run(transcriptId);
    db.prepare(`DELETE FROM transcript_entries WHERE transcript_id = ?`).run(transcriptId);

    for (const row of rows) {
      insertEntry(db, { transcriptId, conversationId, row });
    }

    const llm = buildSessionContextForLlm(rows);
    const now = Date.now();
    const hasUserMessage = llm.some((message) => message.role === 'user');
    const hiddenUpdate = hasUserMessage && shouldRevealSessionForUserMessage(db, conversationId)
      ? `hidden_from_session_list = 0,`
      : '';
    db.prepare(
      `UPDATE sessions SET
        message_count = ?,
        estimated_tokens = ?,
        ${hiddenUpdate}
        updated_at = ?,
        last_accessed_at = ?,
        last_interaction_at = ?
      WHERE conversation_id = ?`,
    ).run(llm.length, estimateTokensFromMessages(llm), now, now, now, conversationId);
  });
}

export function paginateTranscriptMessages(
  conversationId: string,
  options: {
    offset?: number;
    limit?: number;
    beforeIndex?: number;
    includeContext?: boolean;
    /** Include reset/rollover transcripts for read-only conversation history. */
    includeArchived?: boolean;
  } = {},
): {
  rows: TranscriptStoredRow[];
  messages: AgentMessage[];
  total: number;
  startSeq: number;
  endSeq: number;
} {
  const transcriptId = getCurrentTranscriptId(conversationId);
  if (!transcriptId) {
    return { rows: [], messages: [], total: 0, startSeq: 0, endSeq: 0 };
  }

  const db = getSqliteDatabase();
  const kinds = options.includeContext ? ['message', 'context'] : ['message'];
  const kindPlaceholders = kinds.map(() => '?').join(', ');
  const includeArchived = options.includeArchived === true;
  const transcriptWhere = includeArchived
    ? `t.conversation_id = ? AND (t.status = 'active' OR t.archive_reason IN ('reset', 'stale'))`
    : 'e.transcript_id = ?';
  const transcriptArg = includeArchived ? conversationId : transcriptId;

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM transcript_entries e
       JOIN transcripts t ON t.transcript_id = e.transcript_id
       WHERE ${transcriptWhere} AND e.entry_kind IN (${kindPlaceholders})`,
    )
    .get(transcriptArg, ...kinds) as { total: number };
  const total = countRow.total;

  const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? 50)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));

  let rows: TranscriptEntryRow[];
  if (options.beforeIndex !== undefined && Number.isFinite(options.beforeIndex)) {
    const endExclusive = Math.min(total, Math.max(0, Math.trunc(options.beforeIndex)));
    const startInclusive = Math.max(0, endExclusive - limit);
    rows = db
      .prepare(
        `SELECT entry_id, transcript_id, seq, entry_kind, role, payload_json, created_at
         FROM (
           SELECT e.entry_id, e.transcript_id, e.seq, e.entry_kind, e.role, e.payload_json, e.created_at,
                  ROW_NUMBER() OVER (ORDER BY t.created_at ASC, t.rowid ASC, e.seq ASC) - 1 AS idx
           FROM transcript_entries e
           JOIN transcripts t ON t.transcript_id = e.transcript_id
           WHERE ${transcriptWhere} AND e.entry_kind IN (${kindPlaceholders})
         )
         WHERE idx >= ? AND idx < ?
         ORDER BY idx ASC`,
      )
      .all(transcriptArg, ...kinds, startInclusive, endExclusive) as TranscriptEntryRow[];
  } else {
    rows = db
      .prepare(
        `SELECT e.entry_id, e.transcript_id, e.seq, e.entry_kind, e.role, e.payload_json, e.created_at
         FROM transcript_entries e
         JOIN transcripts t ON t.transcript_id = e.transcript_id
         WHERE ${transcriptWhere} AND e.entry_kind IN (${kindPlaceholders})
         ORDER BY t.created_at DESC, t.rowid DESC, e.seq DESC
         LIMIT ? OFFSET ?`,
      )
      .all(transcriptArg, ...kinds, limit, offset) as TranscriptEntryRow[];
    rows.reverse();
  }

  const storedRows = rows.map(transcriptEntryRowToStoredRow);
  const messages = buildSessionContextForLlm(storedRows);
  const startSeq = rows[0]?.seq ?? 0;
  const endSeq = rows[rows.length - 1]?.seq ?? 0;
  return { rows: storedRows, messages, total, startSeq, endSeq };
}

export function listCompactionBoundaries(conversationId: string): CompactionBoundarySummary[] {
  const db = getSqliteDatabase();
  const transcriptId = getCurrentTranscriptId(conversationId);
  if (!transcriptId) return [];
  const rows = db
    .prepare(
      `SELECT entry_id, seq, payload_json, created_at
       FROM transcript_entries
       WHERE transcript_id = ? AND entry_kind = 'compaction'
       ORDER BY seq DESC`,
    )
    .all(transcriptId) as Array<{
    entry_id: string;
    seq: number;
    payload_json: string;
    created_at: number;
  }>;

  return rows.map((row) => {
    const payload = JSON.parse(row.payload_json) as XopcTranscriptCompactionEntry;
    return {
      id: row.entry_id,
      seq: row.seq,
      createdAt: new Date(row.created_at).toISOString(),
      messageCount: payload.messages.length,
      tokensBefore: payload.tokensBefore,
      tokensAfter: payload.tokensAfter,
      summaryPreview: payload.summary.slice(0, 500),
      audit: payload.audit,
    };
  });
}

export function restoreBeforeCompactionBoundary(conversationId: string, compactionId: string): void {
  runSqliteWriteTransaction((db) => {
    const transcriptId = readCurrentTranscriptId(db, conversationId);
    if (!transcriptId) throw new Error(`Session not found: ${conversationId}`);
    const boundary = db
      .prepare(
        `SELECT seq FROM transcript_entries
         WHERE transcript_id = ? AND entry_id = ? AND entry_kind = 'compaction'`,
      )
      .get(transcriptId, compactionId) as { seq: number } | undefined;
    if (!boundary) throw new Error(`Compaction boundary not found: ${compactionId}`);
    const removedEntryIds = db
      .prepare(
        `SELECT entry_id
         FROM transcript_entries
         WHERE transcript_id = ? AND seq >= ?`,
      )
      .all(transcriptId, boundary.seq) as Array<{ entry_id: string }>;
    for (const entry of removedEntryIds) {
      db.prepare(`DELETE FROM transcript_fts WHERE entry_id = ?`).run(entry.entry_id);
    }
    db.prepare(`DELETE FROM transcript_entries WHERE transcript_id = ? AND seq >= ?`)
      .run(transcriptId, boundary.seq);
    const remainingEntries = db
      .prepare(
        `SELECT entry_id, transcript_id, seq, entry_kind, role, payload_json, created_at
         FROM transcript_entries
         WHERE transcript_id = ?
         ORDER BY seq ASC`,
      )
      .all(transcriptId) as TranscriptEntryRow[];
    const restoredMessages = buildSessionContextForLlm(remainingEntries.map(transcriptEntryRowToStoredRow));
    if (restoredMessages.length === 0) {
      throw new Error(`No restorable context exists before compaction boundary: ${compactionId}`);
    }
    const tokensAfter = estimateTokensFromMessages(restoredMessages);
    const compactedCount = remainingEntries.filter((entry) => entry.entry_kind === 'compaction').length;
    const now = Date.now();
    db.prepare(
      `UPDATE sessions SET
        message_count = ?,
        estimated_tokens = ?,
        compacted_count = ?,
        updated_at = ?,
        last_accessed_at = ?,
        last_interaction_at = ?
      WHERE conversation_id = ?`,
    ).run(restoredMessages.length, tokensAfter, compactedCount, now, now, now, conversationId);
  });
}
