import type { DatabaseSync } from 'node:sqlite';

export function readCurrentTranscriptId(db: DatabaseSync, conversationId: string): string | null {
  const row = db
    .prepare(`SELECT active_transcript_id FROM sessions WHERE conversation_id = ?`)
    .get(conversationId) as { active_transcript_id?: string } | undefined;
  return row?.active_transcript_id ?? null;
}
