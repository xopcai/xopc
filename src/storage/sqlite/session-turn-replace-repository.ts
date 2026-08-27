import { randomUUID } from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import {
  buildSessionContextForLlm,
  buildSessionDisplayMessages,
  type TranscriptStoredRow,
} from '../../session/session-context-for-llm.js';
import {
  estimateTokensFromMessages,
  transcriptEntryRowToStoredRow,
  type TranscriptEntryRow,
} from './row-mappers.js';
import { getXopcDatabase } from './connection.js';
import { runSqliteWriteTransaction } from './transaction.js';

export type ReplaceLatestSessionTurnInput = {
  sessionKey: string;
  targetTurnId: string;
  clientMessageId: string;
  content: string;
  attachments?: unknown[];
  thinking?: string;
  origin: TurnOrigin;
};

export type ReplaceLatestSessionTurnResult =
  | {
      ok: true;
      idempotent: boolean;
      inputId: string;
      removedMessages: AgentMessage[];
      remainingMessages: AgentMessage[];
    }
  | {
      ok: false;
      code: 'TARGET_NOT_FOUND' | 'NOT_LATEST' | 'SESSION_BUSY';
    };

function isUserRow(row: TranscriptStoredRow): boolean {
  return (row as { role?: unknown }).role === 'user';
}

function rowTurnId(row: TranscriptStoredRow): string | undefined {
  const value = (row as { turnId?: unknown }).turnId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validateTargetRows(
  rows: TranscriptStoredRow[],
  targetTurnId: string,
): { ok: true; targetIndex: number } | { ok: false; code: 'TARGET_NOT_FOUND' | 'NOT_LATEST' } {
  const targetIndex = rows.findIndex(
    (row) => (row as { role?: unknown }).role === 'user' && rowTurnId(row) === targetTurnId,
  );
  if (targetIndex < 0) return { ok: false, code: 'TARGET_NOT_FOUND' };
  if (rows.slice(targetIndex + 1).some(isUserRow)) return { ok: false, code: 'NOT_LATEST' };
  return { ok: true, targetIndex };
}

/** Validate before aborting a run; the transactional mutation validates again. */
export function validateLatestSessionTurnTarget(
  sessionKey: string,
  targetTurnId: string,
): { ok: true } | { ok: false; code: 'TARGET_NOT_FOUND' | 'NOT_LATEST' } {
  const { db } = getXopcDatabase();
  const session = db
    .prepare(`SELECT session_id FROM sessions WHERE session_key = ?`)
    .get(sessionKey) as { session_id: string } | undefined;
  if (!session) return { ok: false, code: 'TARGET_NOT_FOUND' };
  const entries = db
    .prepare(
      `SELECT entry_id, session_id, seq, entry_kind, role, payload_json, created_at
       FROM transcript_entries WHERE session_id = ? ORDER BY seq ASC`,
    )
    .all(session.session_id) as TranscriptEntryRow[];
  const result = validateTargetRows(entries.map(transcriptEntryRowToStoredRow), targetTurnId);
  return result.ok ? { ok: true } : result;
}

/**
 * Replace the latest persisted user turn with a durable queued input.
 * Transcript deletion and input insertion share one SQLite transaction so a
 * failed enqueue cannot leave the conversation without the original turn.
 */
export function replaceLatestSessionTurnAndQueueInput(
  input: ReplaceLatestSessionTurnInput,
): ReplaceLatestSessionTurnResult {
  return runSqliteWriteTransaction((db) => {
    const existing = db
      .prepare(`SELECT id FROM session_inputs WHERE session_key = ? AND client_message_id = ?`)
      .get(input.sessionKey, input.clientMessageId) as { id: string } | undefined;
    if (existing) {
      return {
        ok: true,
        idempotent: true,
        inputId: existing.id,
        removedMessages: [],
        remainingMessages: [],
      };
    }

    const session = db
      .prepare(`SELECT session_id FROM sessions WHERE session_key = ?`)
      .get(input.sessionKey) as { session_id: string } | undefined;
    if (!session) return { ok: false, code: 'TARGET_NOT_FOUND' };

    db.prepare(
      `INSERT INTO session_input_runtime(session_key, revision, updated_at_ms)
       VALUES (?, 0, ?) ON CONFLICT(session_key) DO NOTHING`,
    ).run(input.sessionKey, Date.now());

    const runtime = db
      .prepare(`SELECT active_run_id FROM session_input_runtime WHERE session_key = ?`)
      .get(input.sessionKey) as { active_run_id: string | null } | undefined;
    const pending = db
      .prepare(
        `SELECT 1 AS found FROM session_inputs
         WHERE session_key = ? AND status IN ('queued', 'running', 'injecting', 'interrupted')
         LIMIT 1`,
      )
      .get(input.sessionKey) as { found: number } | undefined;
    if (runtime?.active_run_id || pending) return { ok: false, code: 'SESSION_BUSY' };

    const entries = db
      .prepare(
        `SELECT entry_id, session_id, seq, entry_kind, role, payload_json, created_at
         FROM transcript_entries WHERE session_id = ? ORDER BY seq ASC`,
      )
      .all(session.session_id) as TranscriptEntryRow[];
    const rows = entries.map(transcriptEntryRowToStoredRow);
    const target = validateTargetRows(rows, input.targetTurnId);
    if (target.ok === false) return target;

    const targetSeq = entries[target.targetIndex]!.seq;
    const removedEntries = entries.filter(
      (entry) => entry.seq >= targetSeq && entry.entry_kind !== 'compaction',
    );
    const remainingEntries = entries.filter(
      (entry) => entry.seq < targetSeq && entry.entry_kind !== 'compaction',
    );
    const deleteEntries = entries.filter(
      (entry) => entry.seq >= targetSeq || entry.entry_kind === 'compaction',
    );
    const removedRows = removedEntries.map(transcriptEntryRowToStoredRow);
    const remainingRows = remainingEntries.map(transcriptEntryRowToStoredRow);

    const deleteFts = db.prepare(`DELETE FROM transcript_fts WHERE entry_id = ?`);
    const deleteEntry = db.prepare(`DELETE FROM transcript_entries WHERE entry_id = ?`);
    for (const entry of deleteEntries) {
      deleteFts.run(entry.entry_id);
      deleteEntry.run(entry.entry_id);
    }

    const llm = buildSessionContextForLlm(remainingRows);
    const now = Date.now();
    db.prepare(
      `UPDATE sessions SET message_count = ?, estimated_tokens = ?, compacted_count = 0,
       updated_at = ?, last_accessed_at = ?, last_interaction_at = ? WHERE session_key = ?`,
    ).run(
      llm.length,
      estimateTokensFromMessages(llm),
      now,
      now,
      now,
      input.sessionKey,
    );

    const maxPosition = db
      .prepare(
        `SELECT COALESCE(MAX(position), 0) AS value FROM session_inputs
         WHERE session_key = ? AND status IN ('queued', 'running', 'injecting', 'interrupted')`,
      )
      .get(input.sessionKey) as { value: number };
    const inputId = randomUUID();
    db.prepare(
      `INSERT INTO session_inputs(id, session_key, client_message_id,
       requested_delivery, effective_delivery, status, content, attachments_json,
       thinking, origin_json, position, target_run_id, version, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, 'next', 'next', 'queued', ?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
    ).run(
      inputId,
      input.sessionKey,
      input.clientMessageId,
      input.content,
      input.attachments ? JSON.stringify(input.attachments) : null,
      input.thinking ?? null,
      JSON.stringify(input.origin),
      maxPosition.value + 1,
      now,
      now,
    );
    db.prepare(
      `UPDATE session_input_runtime SET revision = revision + 1, updated_at_ms = ?
       WHERE session_key = ?`,
    ).run(now, input.sessionKey);

    return {
      ok: true,
      idempotent: false,
      inputId,
      removedMessages: buildSessionDisplayMessages(removedRows),
      remainingMessages: buildSessionDisplayMessages(remainingRows),
    };
  });
}
