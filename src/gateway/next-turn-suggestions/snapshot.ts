import { createHash } from 'node:crypto';

import { PERSONAL_PROACTIVE_MESSAGE_TYPE, TASK_RESULT_DELIVERY_TYPE } from '@xopcai/gateway-contract';

import { mediaGenerationPhase } from '../../media/generation-changes.js';
import { getSessionMetadata, getCurrentTranscriptId } from '../../storage/sqlite/session-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { getSessionInputState } from '../../storage/sqlite/session-input-repository.js';
import { getActiveConnectionWait } from '../../storage/sqlite/connection-wait-repository.js';
import { getActiveClarification } from '../../storage/sqlite/clarification-wait-repository.js';
import { buildSessionContextForLlm, buildSessionDisplayMessages, isTranscriptCustomMessageEntry, type TranscriptStoredRow } from '../../session/session-context-for-llm.js';
import { getVideoDraft } from '../../video-generation/drafts.js';

type MediaJob = { id: string; state: Parameters<typeof mediaGenerationPhase>[0] };
type SuggestionMedia = {
  id: string;
  kind: 'music' | 'video';
  phase: ReturnType<typeof mediaGenerationPhase> | 'draft';
  title?: string;
  version?: number;
  draftRevision?: number;
};

export type SuggestionSnapshot = {
  conversationId: string; transcriptId: string; sourceRunId: string; inputRevision: number;
  transcriptCursor: number; agentId: string; messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  media: SuggestionMedia[];
};

function readSuggestionMedia(conversationId: string, transcriptId: string): SuggestionMedia[] {
  const db = getSqliteDatabase();
  const music = db.prepare(`SELECT id, state, title, version_number FROM music_generation_jobs
    WHERE conversation_id = ? AND transcript_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 3`)
    .all(conversationId, transcriptId) as Array<MediaJob & { title: string; version_number: number }>;
  const videos = db.prepare(`SELECT id, state FROM video_generation_jobs
    WHERE conversation_id = ? AND transcript_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 3`)
    .all(conversationId, transcriptId) as MediaJob[];
  const media: SuggestionMedia[] = [
    ...music.map((job): SuggestionMedia => ({
      id: job.id, kind: 'music', phase: mediaGenerationPhase(job.state), title: job.title, version: job.version_number,
    })),
    ...videos.map((job): SuggestionMedia => ({ id: job.id, kind: 'video', phase: mediaGenerationPhase(job.state) })),
  ];
  const draft = getVideoDraft(conversationId, transcriptId);
  if (draft && !db.prepare('SELECT 1 FROM video_generation_jobs WHERE conversation_id = ? AND id = ?').get(conversationId, draft.id)) {
    media.push({ id: draft.id, kind: 'video', phase: 'draft', draftRevision: draft.revision });
  }
  return media;
}

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
    AND (entry_kind = 'message' AND role IN ('user','assistant')
      OR json_extract(payload_json, '$.customType') IN (?, ?)) ORDER BY seq DESC LIMIT 12`)
    .all(transcriptId, TASK_RESULT_DELIVERY_TYPE, PERSONAL_PROACTIVE_MESSAGE_TYPE) as Array<{ payload_json: string }>;
  // Predict from what the user saw: background replies are assistant responses, not task reference prompts.
  const contextRows = rows.reverse().flatMap<TranscriptStoredRow>(row => {
    const stored = JSON.parse(row.payload_json) as TranscriptStoredRow;
    return isTranscriptCustomMessageEntry(stored) ? buildSessionDisplayMessages([stored]) : [stored];
  });
  const messages = buildSessionContextForLlm(contextRows)
    .flatMap(message => {
      if (message.role !== 'user' && message.role !== 'assistant') return [];
      const text = typeof message.content === 'string' ? message.content : message.content
        .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
      return text.trim() ? [{ role: message.role, text: text.slice(0, 1600) }] : [];
    }).slice(-6);
  if (messages.at(-1)?.role !== 'assistant' || !messages.some(message => message.role === 'user')) return null;
  while (messages.length > 2 && JSON.stringify(messages).length > 6000) messages.shift();
  return { conversationId, transcriptId, sourceRunId: last.run_id, inputRevision: state.revision,
    transcriptCursor: cursor.seq, agentId: metadata.agentId, messages, media: readSuggestionMedia(conversationId, transcriptId) };
}

export function suggestionSnapshotKey(snapshot: SuggestionSnapshot, locale: string, modelRef: string | undefined): string {
  const { messages: _messages, ...identity } = snapshot;
  return createHash('sha256').update(JSON.stringify({ ...identity, locale, modelRef, version: 3 })).digest('hex');
}
