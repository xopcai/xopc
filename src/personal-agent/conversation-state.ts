import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

/** A conversation revision also changes when foreground work finishes, invalidating old-context drafts. */
export function personalConversationState(conversationId: string): { revision: number; idle: boolean } {
  const db = getSqliteDatabase();
  const runtime = db.prepare('SELECT revision, active_run_id FROM session_input_runtime WHERE conversation_id = ?')
    .get(conversationId) as { revision: number; active_run_id: string | null } | undefined;
  const pending = db.prepare(`SELECT 1 FROM session_inputs WHERE conversation_id = ?
    AND status IN ('queued','running','injecting') LIMIT 1`).get(conversationId);
  const preparation = db.prepare('SELECT state FROM session_preparations WHERE conversation_id = ?')
    .get(conversationId) as { state: string } | undefined;
  return { revision: runtime?.revision ?? 0, idle: !runtime?.active_run_id && !pending
    && (!preparation || preparation.state === 'ready') };
}
