import { TASK_RESULT_DELIVERY_TYPE } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

export interface PersonalUnreadSnapshot {
  conversationId: string;
  transcriptId: string;
  lastSeq: number;
  unreadCount: number;
}

/** Count delivered replies, excluding worker/tool output and separate artifact cards. */
export function personalUnreadSnapshot(conversationId: string): PersonalUnreadSnapshot | null {
  const db = getSqliteDatabase();
  const session = db.prepare(`SELECT active_transcript_id AS transcriptId,
    json_extract(custom_data_json, '$.personalRead.transcriptId') AS readTranscriptId,
    json_extract(custom_data_json, '$.personalRead.lastSeq') AS readSeq
    FROM sessions WHERE conversation_id = ?`).get(conversationId) as
    { transcriptId: string; readTranscriptId: string | null; readSeq: number | null } | undefined;
  if (!session?.transcriptId) return null;
  const readSeq = session.readTranscriptId === session.transcriptId ? session.readSeq ?? 0 : 0;
  const result = db.prepare(`SELECT (SELECT COALESCE(MAX(seq), 0) FROM transcript_entries WHERE transcript_id = ?) AS lastSeq,
    COUNT(*) AS unreadCount FROM transcript_entries
    WHERE transcript_id = ? AND seq > ? AND (
      (role = 'assistant' AND COALESCE(json_extract(payload_json, '$.metadata.hiddenFromClient'), 0) != 1
        AND COALESCE(json_extract(payload_json, '$.stopReason'), '') != 'toolUse'
        AND EXISTS (SELECT 1 FROM json_each(payload_json, '$.content')
          WHERE json_extract(value, '$.type') = 'text' AND length(trim(json_extract(value, '$.text'))) > 0))
      OR (json_extract(payload_json, '$.customType') = ?
        AND json_extract(payload_json, '$.details.deliveryId') LIKE 'reply:%')
    )`).get(session.transcriptId, session.transcriptId, readSeq, TASK_RESULT_DELIVERY_TYPE) as { lastSeq: number; unreadCount: number };
  return { conversationId, transcriptId: session.transcriptId, ...result };
}

/** Acknowledge only the snapshot the client saw; newer arrivals remain unread. */
export function markPersonalRead(conversationId: string, transcriptId: string, lastSeq: number): void {
  getSqliteDatabase().prepare(`UPDATE sessions SET custom_data_json = json_set(COALESCE(custom_data_json, '{}'),
    '$.personalRead', json_object('transcriptId', ?, 'lastSeq', ?))
    WHERE conversation_id = ? AND active_transcript_id = ?
      AND ? <= (SELECT COALESCE(MAX(seq), 0) FROM transcript_entries WHERE transcript_id = ?)
      AND (COALESCE(json_extract(custom_data_json, '$.personalRead.transcriptId'), '') != ?
        OR COALESCE(json_extract(custom_data_json, '$.personalRead.lastSeq'), 0) <= ?)`)
    .run(transcriptId, lastSeq, conversationId, transcriptId, lastSeq, transcriptId, transcriptId, lastSeq);
}
