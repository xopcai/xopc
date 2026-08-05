import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

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
import { getCurrentSessionId, readCurrentSessionId } from './session-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

function nextSeq(db: DatabaseSync, sessionId: string): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(seq), 0) AS max_seq FROM transcript_entries WHERE session_id = ?`)
    .get(sessionId) as { max_seq: number };
  return (row.max_seq ?? 0) + 1;
}

function insertEntry(
  db: DatabaseSync,
  params: {
    sessionId: string;
    sessionKey: string;
    row: TranscriptStoredRow;
    entryId?: string;
    createdAt?: number;
  },
): TranscriptEntryRow {
  const { entryKind, role } = classifyStoredRow(params.row);
  const entryId = params.entryId ?? randomUUID();
  const seq = nextSeq(db, params.sessionId);
  const createdAt = params.createdAt ?? Date.now();
  const payloadJson = JSON.stringify(params.row);

  db.prepare(
    `INSERT INTO transcript_entries (entry_id, session_id, seq, entry_kind, role, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(entryId, params.sessionId, seq, entryKind, role, payloadJson, createdAt);

  const content = extractFtsContent(params.row);
  if (content.trim()) {
    db.prepare(
      `INSERT INTO transcript_fts (content, session_key, session_id, entry_id)
       VALUES (?, ?, ?, ?)`,
    ).run(content, params.sessionKey, params.sessionId, entryId);
  }

  return {
    entry_id: entryId,
    session_id: params.sessionId,
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

export function appendTranscriptEntry(
  sessionKey: string,
  row: TranscriptStoredRow,
  opts?: { sessionId?: string; tokenDelta?: number },
): TranscriptEntryRow {
  if (isRuntimeOnlyTranscriptMessage(row)) {
    throw new Error('Runtime-only messages cannot be persisted in a session transcript');
  }
  return runSqliteWriteTransaction((db) => {
    const sessionId = opts?.sessionId ?? readCurrentSessionId(db, sessionKey);
    if (!sessionId) {
      throw new Error(`Session not found: ${sessionKey}`);
    }
    const inserted = insertEntry(db, { sessionId, sessionKey, row });
    if (classifyStoredRow(row).entryKind === 'message') {
      const tokenDelta = opts?.tokenDelta ?? 0;
      const now = Date.now();
      const hiddenUpdate = isUserMessageRow(row) ? `hidden_from_session_list = 0,` : '';
      db.prepare(
        `UPDATE sessions SET
          message_count = message_count + 1,
          estimated_tokens = estimated_tokens + ?,
          ${hiddenUpdate}
          updated_at = ?,
          last_accessed_at = ?,
          last_interaction_at = ?
        WHERE session_key = ?`,
      ).run(tokenDelta, now, now, now, sessionKey);
    }
    return inserted;
  });
}

export function appendCompactionBoundary(
  sessionKey: string,
  row: Omit<XopcTranscriptCompactionEntry, 'baseSeq'>,
): TranscriptEntryRow {
  return runSqliteWriteTransaction((db) => {
    const sessionId = readCurrentSessionId(db, sessionKey);
    if (!sessionId) throw new Error(`Session not found: ${sessionKey}`);
    const boundary = { ...row, baseSeq: nextSeq(db, sessionId) - 1 };
    const inserted = insertEntry(db, { sessionId, sessionKey, row: boundary });
    const now = Date.now();
    db.prepare(
      `UPDATE sessions SET
        message_count = ?,
        estimated_tokens = ?,
        compacted_count = compacted_count + 1,
        updated_at = ?,
        last_accessed_at = ?,
        last_interaction_at = ?
       WHERE session_key = ?`,
    ).run(boundary.messages.length, boundary.tokensAfter, now, now, now, sessionKey);
    return inserted;
  });
}

export function loadTranscriptRowsForSession(sessionKey: string): TranscriptStoredRow[] {
  const sessionId = getCurrentSessionId(sessionKey);
  if (!sessionId) {
    return [];
  }
  return loadTranscriptRows(sessionId);
}

export function loadTranscriptHistoryRowsForSession(sessionKey: string): TranscriptStoredRow[] {
  if (!getCurrentSessionId(sessionKey)) {
    return [];
  }
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT e.entry_id, e.session_id, e.seq, e.entry_kind, e.role, e.payload_json, e.created_at
       FROM transcript_entries e
       JOIN transcripts t ON t.session_id = e.session_id
       WHERE t.session_key = ?
         AND (t.status = 'active' OR t.archive_reason IN ('reset', 'stale'))
       ORDER BY t.created_at ASC, t.rowid ASC, e.seq ASC`,
    )
    .all(sessionKey) as TranscriptEntryRow[];
  return rows.map(transcriptEntryRowToStoredRow);
}

export function loadTranscriptRows(sessionId: string): TranscriptStoredRow[] {
  const db = getSqliteDatabase();
  const rows = db
    .prepare(
      `SELECT entry_id, session_id, seq, entry_kind, role, payload_json, created_at
       FROM transcript_entries
       WHERE session_id = ?
       ORDER BY seq ASC`,
    )
    .all(sessionId) as TranscriptEntryRow[];
  return rows.map(transcriptEntryRowToStoredRow);
}

export function loadLlmMessagesForSession(sessionKey: string): AgentMessage[] {
  const sessionId = getCurrentSessionId(sessionKey);
  if (!sessionId) return [];
  const rows = getSqliteDatabase()
    .prepare(
      `SELECT entry_id, session_id, seq, entry_kind, role, payload_json, created_at
       FROM transcript_entries
       WHERE session_id = ?
         AND seq >= COALESCE(
           (SELECT MAX(seq) FROM transcript_entries WHERE session_id = ? AND entry_kind = 'compaction'),
           1
         )
       ORDER BY seq ASC`,
    )
    .all(sessionId, sessionId) as TranscriptEntryRow[];
  const activeRows = rows.map(transcriptEntryRowToStoredRow);
  return buildSessionContextForLlm(activeRows);
}

export function replaceTranscriptRows(
  sessionKey: string,
  rows: TranscriptStoredRow[],
): void {
  if (rows.some(isRuntimeOnlyTranscriptMessage)) {
    throw new Error('Runtime-only messages cannot be persisted in a session transcript');
  }
  runSqliteWriteTransaction((db) => {
    const sessionId = readCurrentSessionId(db, sessionKey);
    if (!sessionId) {
      throw new Error(`Session not found: ${sessionKey}`);
    }

    db.prepare(`DELETE FROM transcript_fts WHERE session_id = ?`).run(sessionId);
    db.prepare(`DELETE FROM transcript_entries WHERE session_id = ?`).run(sessionId);

    for (const row of rows) {
      insertEntry(db, { sessionId, sessionKey, row });
    }

    const llm = buildSessionContextForLlm(rows);
    const now = Date.now();
    const hasUserMessage = llm.some((message) => message.role === 'user');
    const hiddenUpdate = hasUserMessage ? `hidden_from_session_list = 0,` : '';
    db.prepare(
      `UPDATE sessions SET
        message_count = ?,
        estimated_tokens = ?,
        ${hiddenUpdate}
        updated_at = ?,
        last_accessed_at = ?,
        last_interaction_at = ?
      WHERE session_key = ?`,
    ).run(llm.length, estimateTokensFromMessages(llm), now, now, now, sessionKey);
  });
}

export function paginateTranscriptMessages(
  sessionKey: string,
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
  const sessionId = getCurrentSessionId(sessionKey);
  if (!sessionId) {
    return { rows: [], messages: [], total: 0, startSeq: 0, endSeq: 0 };
  }

  const db = getSqliteDatabase();
  const kinds = options.includeContext ? ['message', 'context'] : ['message'];
  const kindPlaceholders = kinds.map(() => '?').join(', ');
  const includeArchived = options.includeArchived === true;
  const transcriptWhere = includeArchived
    ? `t.session_key = ? AND (t.status = 'active' OR t.archive_reason IN ('reset', 'stale'))`
    : 'e.session_id = ?';
  const transcriptArg = includeArchived ? sessionKey : sessionId;

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM transcript_entries e
       JOIN transcripts t ON t.session_id = e.session_id
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
        `SELECT entry_id, session_id, seq, entry_kind, role, payload_json, created_at
         FROM (
           SELECT e.entry_id, e.session_id, e.seq, e.entry_kind, e.role, e.payload_json, e.created_at,
                  ROW_NUMBER() OVER (ORDER BY t.created_at ASC, t.rowid ASC, e.seq ASC) - 1 AS idx
           FROM transcript_entries e
           JOIN transcripts t ON t.session_id = e.session_id
           WHERE ${transcriptWhere} AND e.entry_kind IN (${kindPlaceholders})
         )
         WHERE idx >= ? AND idx < ?
         ORDER BY idx ASC`,
      )
      .all(transcriptArg, ...kinds, startInclusive, endExclusive) as TranscriptEntryRow[];
  } else {
    rows = db
      .prepare(
        `SELECT e.entry_id, e.session_id, e.seq, e.entry_kind, e.role, e.payload_json, e.created_at
         FROM transcript_entries e
         JOIN transcripts t ON t.session_id = e.session_id
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

export function listCompactionBoundaries(sessionKey: string): CompactionBoundarySummary[] {
  const db = getSqliteDatabase();
  const sessionId = getCurrentSessionId(sessionKey);
  if (!sessionId) return [];
  const rows = db
    .prepare(
      `SELECT entry_id, seq, payload_json, created_at
       FROM transcript_entries
       WHERE session_id = ? AND entry_kind = 'compaction'
       ORDER BY seq DESC`,
    )
    .all(sessionId) as Array<{
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
      restoredFromCompactionId: payload.restoredFromCompactionId,
    };
  });
}

export function restoreBeforeCompactionBoundary(sessionKey: string, compactionId: string): void {
  runSqliteWriteTransaction((db) => {
    const sessionId = readCurrentSessionId(db, sessionKey);
    if (!sessionId) throw new Error(`Session not found: ${sessionKey}`);
    const boundary = db
      .prepare(
        `SELECT seq FROM transcript_entries
         WHERE session_id = ? AND entry_id = ? AND entry_kind = 'compaction'`,
      )
      .get(sessionId, compactionId) as { seq: number } | undefined;
    if (!boundary) throw new Error(`Compaction boundary not found: ${compactionId}`);
    const entries = db
      .prepare(
        `SELECT entry_id, session_id, seq, entry_kind, role, payload_json, created_at
         FROM transcript_entries
         WHERE session_id = ? AND seq < ?
         ORDER BY seq ASC`,
      )
      .all(sessionId, boundary.seq) as TranscriptEntryRow[];
    const restoredMessages = buildSessionContextForLlm(entries.map(transcriptEntryRowToStoredRow));
    if (restoredMessages.length === 0) {
      throw new Error(`No restorable context exists before compaction boundary: ${compactionId}`);
    }
    const current = db.prepare(`SELECT estimated_tokens FROM sessions WHERE session_key = ?`)
      .get(sessionKey) as { estimated_tokens: number };
    const tokensAfter = estimateTokensFromMessages(restoredMessages);
    const baseSeq = nextSeq(db, sessionId) - 1;
    const row: XopcTranscriptCompactionEntry = {
      type: 'compaction',
      at: new Date().toISOString(),
      baseSeq,
      plannerVersion: 2,
      summaryModelRef: 'logical-restore',
      qualityAudit: 'disabled',
      summary: `Restored the effective context that existed before compaction boundary ${compactionId}.`,
      messages: restoredMessages,
      firstKeptIndex: 0,
      tokensBefore: current.estimated_tokens,
      tokensAfter,
      restoredFromCompactionId: compactionId,
    };
    insertEntry(db, { sessionId, sessionKey, row });
    const now = Date.now();
    db.prepare(
      `UPDATE sessions SET
        message_count = ?,
        estimated_tokens = ?,
        compacted_count = compacted_count + 1,
        updated_at = ?,
        last_accessed_at = ?,
        last_interaction_at = ?
      WHERE session_key = ?`,
    ).run(restoredMessages.length, tokensAfter, now, now, now, sessionKey);
  });
}
