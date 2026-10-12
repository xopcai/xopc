import { createHash } from 'node:crypto';

import { getSessionMetadata, getCurrentTranscriptId } from '../../storage/sqlite/session-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { getSessionInputState } from '../../storage/sqlite/session-input-repository.js';
import { getActiveConnectionWait } from '../../storage/sqlite/connection-wait-repository.js';
import { getActiveClarification } from '../../storage/sqlite/clarification-wait-repository.js';
import { buildSessionContextForLlm, type TranscriptStoredRow } from '../../session/session-context-for-llm.js';

export type SuggestionSnapshot = {
  conversationId: string; transcriptId: string; sourceRunId: string; inputRevision: number;
  transcriptCursor: number; agentId: string; messages: Array<{ role: 'user' | 'assistant'; text: string }>;
};

/** Reads only this conversation; shared memory and tool results never enter the predictor. */
export function readSuggestionSnapshot(conversationId: string): SuggestionSnapshot | null {
  const metadata = getSessionMetadata(conversationId);
  const transcriptId = getCurrentTranscriptId(conversationId);
  if (!metadata || !transcriptId || metadata.sessionType !== 'chat') return null;
  const db = getSqliteDatabase();
  if (getActiveConnectionWait(conversationId) || getActiveClarification(conversationId)) return null;
  const state = getSessionInputState(conversationId);
  if (state.activeRunId || state.inputs.some(input => ['queued', 'running', 'injecting'].includes(input.status))
    || (state.preparation && state.preparation.state !== 'ready')) return null;
  if (db.prepare(`SELECT 1 FROM session_inputs WHERE conversation_id = ? AND status IN ('queued','running','injecting') LIMIT 1`).get(conversationId)) return null;
  const last = db.prepare(`SELECT run_id, status, expected_transcript_id, origin_json FROM session_inputs
    WHERE conversation_id = ? AND run_id IS NOT NULL ORDER BY updated_at_ms DESC, rowid DESC LIMIT 1`)
    .get(conversationId) as { run_id: string; status: string; expected_transcript_id: string | null; origin_json: string } | undefined;
  if (!last || last.status !== 'completed' || (last.expected_transcript_id && last.expected_transcript_id !== transcriptId)) return null;
  const origin = JSON.parse(last.origin_json) as { type: string; channel?: string };
  if (origin.type !== 'endpoint' && !(origin.type === 'channel' && origin.channel === 'webchat')) return null;
  const cursor = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM transcript_entries WHERE transcript_id = ?')
    .get(transcriptId) as { seq: number };
  const rows = db.prepare(`SELECT payload_json FROM transcript_entries WHERE transcript_id = ?
    AND entry_kind = 'message' AND role IN ('user','assistant') ORDER BY seq DESC LIMIT 12`)
    .all(transcriptId) as Array<{ payload_json: string }>;
  const messages = buildSessionContextForLlm(rows.reverse().map(row => JSON.parse(row.payload_json) as TranscriptStoredRow))
    .flatMap(message => {
      if (message.role !== 'user' && message.role !== 'assistant') return [];
      const text = typeof message.content === 'string' ? message.content : message.content
        .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
      return text.trim() ? [{ role: message.role, text: text.slice(0, 1600) }] : [];
    }).slice(-6);
  if (messages.at(-1)?.role !== 'assistant' || !messages.some(message => message.role === 'user')) return null;
  while (messages.length > 2 && JSON.stringify(messages).length > 6000) messages.shift();
  return { conversationId, transcriptId, sourceRunId: last.run_id, inputRevision: state.revision,
    transcriptCursor: cursor.seq, agentId: metadata.agentId, messages };
}

export function suggestionSnapshotKey(snapshot: SuggestionSnapshot, locale: string, modelRef: string | undefined): string {
  const { messages: _messages, ...identity } = snapshot;
  return createHash('sha256').update(JSON.stringify({ ...identity, locale, modelRef, version: 1 })).digest('hex');
}
