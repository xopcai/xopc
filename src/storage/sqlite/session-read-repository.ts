import type { DatabaseSync } from 'node:sqlite';

import type { SessionMetadata } from '../../session/types.js';
import { sessionRowToMetadata, type SessionRow } from './row-mappers.js';
import { getSqliteDatabase } from './transaction.js';

export const SESSION_COLUMNS = `
  s.conversation_id, s.agent_id, s.active_transcript_id, s.status, s.name, s.tags_json,
  s.created_at, s.updated_at, s.last_accessed_at, s.session_started_at, s.last_interaction_at,
  s.source_channel, s.source_chat_id, s.session_type, s.hidden_from_session_list,
  s.parent_conversation_id, s.workflow_run_id, s.workflow_definition_id, s.workflow_agent_id, s.workflow_agent_label,
  s.project_id, s.routing_json, s.custom_data_json,
  s.message_count, s.estimated_tokens, s.compacted_count,
  s.last_flushed_at, s.flush_count,
  t.cwd AS cwd
`;

export const SESSION_FROM_JOIN = `
  FROM sessions s
  LEFT JOIN transcripts t ON t.transcript_id = s.active_transcript_id
`;

export function readSessionRow(db: DatabaseSync, conversationId: string): SessionRow | undefined {
  return db.prepare(`SELECT ${SESSION_COLUMNS} ${SESSION_FROM_JOIN} WHERE s.conversation_id = ?`)
    .get(conversationId) as SessionRow | undefined;
}

/** Read metadata without importing session lifecycle operations. */
export function getSessionMetadata(conversationId: string): SessionMetadata | null {
  const row = readSessionRow(getSqliteDatabase(), conversationId);
  return row ? sessionRowToMetadata(conversationId, row) : null;
}
