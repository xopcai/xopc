import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { CompactionCheckpointDetail, CompactionCheckpointSummary } from '../../session/types.js';
import type { TranscriptCompactionRecord } from '../../session/transcript-format.js';
import {
  buildSessionContextForLlm,
  type TranscriptStoredRow,
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

const MAX_CHECKPOINTS_PER_TRANSCRIPT = 15;

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

export function appendTranscriptEntry(
  sessionKey: string,
  row: TranscriptStoredRow,
  opts?: { sessionId?: string; tokenDelta?: number },
): TranscriptEntryRow {
  return runSqliteWriteTransaction((db) => {
    const sessionId = opts?.sessionId ?? readCurrentSessionId(db, sessionKey);
    if (!sessionId) {
      throw new Error(`Session not found: ${sessionKey}`);
    }
    const inserted = insertEntry(db, { sessionId, sessionKey, row });
    if (classifyStoredRow(row).entryKind === 'message') {
      const tokenDelta = opts?.tokenDelta ?? 0;
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
    }
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
  const rows = loadTranscriptRowsForSession(sessionKey);
  return buildSessionContextForLlm(rows);
}

export function replaceTranscriptRows(
  sessionKey: string,
  rows: TranscriptStoredRow[],
  opts?: { appendCompaction?: TranscriptCompactionRecord },
): void {
  runSqliteWriteTransaction((db) => {
    const sessionId = readCurrentSessionId(db, sessionKey);
    if (!sessionId) {
      throw new Error(`Session not found: ${sessionKey}`);
    }

    db.prepare(`DELETE FROM transcript_fts WHERE session_id = ?`).run(sessionId);
    db.prepare(`DELETE FROM transcript_entries WHERE session_id = ?`).run(sessionId);

    const toWrite = [...rows];
    if (opts?.appendCompaction) {
      toWrite.push({
        type: 'compaction',
        ...opts.appendCompaction,
      } as unknown as TranscriptStoredRow);
    }

    for (const row of toWrite) {
      insertEntry(db, { sessionId, sessionKey, row });
    }

    const llm = buildSessionContextForLlm(toWrite);
    const now = Date.now();
    db.prepare(
      `UPDATE sessions SET
        message_count = ?,
        estimated_tokens = ?,
        updated_at = ?,
        last_accessed_at = ?,
        last_interaction_at = ?
      WHERE session_key = ?`,
    ).run(llm.length, estimateTokensFromMessages(llm), now, now, now, sessionKey);
  });
}

export function loadCheckpointRows(sessionKey: string, checkpointId: string): TranscriptStoredRow[] {
  const db = getSqliteDatabase();
  const checkpoint = db
    .prepare(
      `SELECT checkpoint_id FROM compaction_checkpoints
       WHERE session_key = ? AND checkpoint_id = ?`,
    )
    .get(sessionKey, checkpointId) as { checkpoint_id: string } | undefined;
  if (!checkpoint) {
    return [];
  }
  const entries = db
    .prepare(
      `SELECT payload_json FROM checkpoint_entries
       WHERE checkpoint_id = ?
       ORDER BY seq ASC`,
    )
    .all(checkpointId) as Array<{ payload_json: string }>;
  return entries.map((entry) => JSON.parse(entry.payload_json) as TranscriptStoredRow);
}

export function paginateTranscriptMessages(
  sessionKey: string,
  options: {
    offset?: number;
    limit?: number;
    beforeSeq?: number;
    /** 0-based exclusive end index (legacy cursor from gateway UI). */
    beforeEndIndex?: number;
    includeContext?: boolean;
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

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS total FROM transcript_entries
       WHERE session_id = ? AND entry_kind IN (${kindPlaceholders})`,
    )
    .get(sessionId, ...kinds) as { total: number };
  const total = countRow.total;

  const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? 50)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));

  let rows: TranscriptEntryRow[];
  if (options.beforeEndIndex !== undefined && Number.isFinite(options.beforeEndIndex)) {
    const endExclusive = Math.min(total, Math.max(0, Math.trunc(options.beforeEndIndex)));
    const startInclusive = Math.max(0, endExclusive - limit);
    rows = db
      .prepare(
        `SELECT entry_id, session_id, seq, entry_kind, role, payload_json, created_at
         FROM (
           SELECT entry_id, session_id, seq, entry_kind, role, payload_json, created_at,
                  ROW_NUMBER() OVER (ORDER BY seq ASC) - 1 AS idx
           FROM transcript_entries
           WHERE session_id = ? AND entry_kind IN (${kindPlaceholders})
         )
         WHERE idx >= ? AND idx < ?
         ORDER BY seq ASC`,
      )
      .all(sessionId, ...kinds, startInclusive, endExclusive) as TranscriptEntryRow[];
  } else if (options.beforeSeq !== undefined && Number.isFinite(options.beforeSeq)) {
    rows = db
      .prepare(
        `SELECT entry_id, session_id, seq, entry_kind, role, payload_json, created_at
         FROM transcript_entries
         WHERE session_id = ? AND entry_kind IN (${kindPlaceholders}) AND seq < ?
         ORDER BY seq DESC
         LIMIT ?`,
      )
      .all(sessionId, ...kinds, options.beforeSeq, limit) as TranscriptEntryRow[];
    rows.reverse();
  } else {
    rows = db
      .prepare(
        `SELECT entry_id, session_id, seq, entry_kind, role, payload_json, created_at
         FROM transcript_entries
         WHERE session_id = ? AND entry_kind IN (${kindPlaceholders})
         ORDER BY seq DESC
         LIMIT ? OFFSET ?`,
      )
      .all(sessionId, ...kinds, limit, offset) as TranscriptEntryRow[];
    rows.reverse();
  }

  const storedRows = rows.map(transcriptEntryRowToStoredRow);
  const messages = buildSessionContextForLlm(storedRows);
  const startSeq = rows[0]?.seq ?? 0;
  const endSeq = rows[rows.length - 1]?.seq ?? 0;
  return { rows: storedRows, messages, total, startSeq, endSeq };
}

export function captureCompactionCheckpoint(sessionKey: string): string | null {
  return runSqliteWriteTransaction((db) => {
    const sessionId = readCurrentSessionId(db, sessionKey);
    if (!sessionId) {
      return null;
    }

    const entries = db
      .prepare(
        `SELECT entry_id, session_id, seq, entry_kind, role, payload_json, created_at
         FROM transcript_entries WHERE session_id = ? ORDER BY seq ASC`,
      )
      .all(sessionId) as TranscriptEntryRow[];
    if (entries.length === 0) {
      return null;
    }

    const checkpointId = randomUUID();
    const now = Date.now();
    const messageCount = entries.filter((e) => e.entry_kind === 'message').length;
    const sizeBytes = entries.reduce((sum, e) => sum + e.payload_json.length, 0);

    db.prepare(
      `INSERT INTO compaction_checkpoints
        (checkpoint_id, session_id, session_key, created_at, message_count, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(checkpointId, sessionId, sessionKey, now, messageCount, sizeBytes);

    const insertCheckpointEntry = db.prepare(
      `INSERT INTO checkpoint_entries (checkpoint_id, seq, entry_kind, role, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const entry of entries) {
      insertCheckpointEntry.run(
        checkpointId,
        entry.seq,
        entry.entry_kind,
        entry.role,
        entry.payload_json,
      );
    }

    pruneCompactionCheckpoints(db, sessionId);
    return checkpointId;
  });
}

function pruneCompactionCheckpoints(db: DatabaseSync, sessionId: string): void {
  const rows = db
    .prepare(
      `SELECT checkpoint_id FROM compaction_checkpoints
       WHERE session_id = ?
       ORDER BY created_at ASC`,
    )
    .all(sessionId) as Array<{ checkpoint_id: string }>;
  if (rows.length <= MAX_CHECKPOINTS_PER_TRANSCRIPT) {
    return;
  }
  const toDelete = rows.slice(0, rows.length - MAX_CHECKPOINTS_PER_TRANSCRIPT);
  const del = db.prepare(`DELETE FROM compaction_checkpoints WHERE checkpoint_id = ?`);
  for (const row of toDelete) {
    del.run(row.checkpoint_id);
  }
}

export function listCompactionCheckpoints(sessionKey: string): CompactionCheckpointSummary[] {
  const db = getSqliteDatabase();
  const rows = db
    .prepare(
      `SELECT checkpoint_id, created_at, message_count, size_bytes
       FROM compaction_checkpoints
       WHERE session_key = ?
       ORDER BY created_at DESC`,
    )
    .all(sessionKey) as Array<{
    checkpoint_id: string;
    created_at: number;
    message_count: number;
    size_bytes: number;
  }>;

  return rows.map((row) => ({
    id: row.checkpoint_id,
    sizeBytes: row.size_bytes,
    modifiedAt: new Date(row.created_at).toISOString(),
  }));
}

export function getCompactionCheckpointDetail(
  sessionKey: string,
  checkpointId: string,
): CompactionCheckpointDetail | null {
  const db = getSqliteDatabase();
  const row = db
    .prepare(
      `SELECT checkpoint_id, created_at, message_count, size_bytes
       FROM compaction_checkpoints
       WHERE session_key = ? AND checkpoint_id = ?`,
    )
    .get(sessionKey, checkpointId) as
    | {
        checkpoint_id: string;
        created_at: number;
        message_count: number;
        size_bytes: number;
      }
    | undefined;
  if (!row) {
    return null;
  }
  return {
    id: row.checkpoint_id,
    sizeBytes: row.size_bytes,
    modifiedAt: new Date(row.created_at).toISOString(),
    messageCount: row.message_count,
  };
}

export function restoreCompactionCheckpoint(sessionKey: string, checkpointId: string): void {
  runSqliteWriteTransaction((db) => {
    const sessionId = readCurrentSessionId(db, sessionKey);
    if (!sessionId) {
      throw new Error(`Session not found: ${sessionKey}`);
    }

    const checkpoint = db
      .prepare(
        `SELECT checkpoint_id FROM compaction_checkpoints
         WHERE session_key = ? AND checkpoint_id = ?`,
      )
      .get(sessionKey, checkpointId) as { checkpoint_id: string } | undefined;
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const entries = db
      .prepare(
        `SELECT seq, entry_kind, role, payload_json
         FROM checkpoint_entries
         WHERE checkpoint_id = ?
         ORDER BY seq ASC`,
      )
      .all(checkpointId) as Array<{
      seq: number;
      entry_kind: string;
      role: string | null;
      payload_json: string;
    }>;

    db.prepare(`DELETE FROM transcript_fts WHERE session_id = ?`).run(sessionId);
    db.prepare(`DELETE FROM transcript_entries WHERE session_id = ?`).run(sessionId);

    for (const entry of entries) {
      const payload = JSON.parse(entry.payload_json) as TranscriptStoredRow;
      insertEntry(db, {
        sessionId,
        sessionKey,
        row: payload,
        createdAt: Date.now(),
      });
    }

    const llm = buildSessionContextForLlm(entries.map((e) => JSON.parse(e.payload_json) as TranscriptStoredRow));
    const now = Date.now();
    db.prepare(
      `UPDATE sessions SET
        message_count = ?,
        estimated_tokens = ?,
        updated_at = ?,
        last_accessed_at = ?,
        last_interaction_at = ?
      WHERE session_key = ?`,
    ).run(llm.length, estimateTokensFromMessages(llm), now, now, now, sessionKey);
  });
}
