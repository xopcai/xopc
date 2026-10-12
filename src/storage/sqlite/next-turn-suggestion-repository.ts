import type { NextTurnSuggestion, NextTurnSuggestionFeedback, NextTurnSuggestionResponse } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from './transaction.js';

export function readNextTurnSuggestion(conversationId: string, locale: string, snapshotKey: string, now = Date.now()): NextTurnSuggestionResponse | undefined {
  const row = getSqliteDatabase().prepare(`SELECT state, payload_json FROM next_turn_suggestions
    WHERE conversation_id = ? AND locale = ? AND snapshot_key = ? AND expires_at > ?`)
    .get(conversationId, locale, snapshotKey, now) as { state: 'ready' | 'none'; payload_json: string | null } | undefined;
  return row ? { status: row.state, ...(row.payload_json ? { suggestion: JSON.parse(row.payload_json) as NextTurnSuggestion } : {}) } : undefined;
}

export function saveNextTurnSuggestion(conversationId: string, locale: string, snapshotKey: string, id: string,
  expiresAt: number, suggestion: NextTurnSuggestion | null): void {
  getSqliteDatabase().prepare(`INSERT INTO next_turn_suggestions
    (conversation_id, locale, snapshot_key, suggestion_id, state, payload_json, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(conversation_id, locale) DO UPDATE SET
    snapshot_key = excluded.snapshot_key, suggestion_id = excluded.suggestion_id, state = excluded.state,
    payload_json = excluded.payload_json, expires_at = excluded.expires_at`)
    .run(conversationId, locale, snapshotKey, id, suggestion ? 'ready' : 'none', suggestion ? JSON.stringify(suggestion) : null, expiresAt);
  getSqliteDatabase().prepare('DELETE FROM next_turn_suggestions WHERE expires_at <= ?').run(Date.now());
  getSqliteDatabase().prepare('DELETE FROM next_turn_suggestion_feedback WHERE created_at < ?').run(Date.now() - 30 * 86_400_000);
}

export function recordNextTurnSuggestionFeedback(conversationId: string, feedback: NextTurnSuggestionFeedback): boolean {
  const db = getSqliteDatabase();
  const exists = db.prepare(`SELECT 1 FROM next_turn_suggestions WHERE conversation_id = ? AND suggestion_id = ? AND state = 'ready'
    UNION ALL SELECT 1 FROM next_turn_suggestion_feedback WHERE conversation_id = ? AND suggestion_id = ? AND impression_id = ? AND event = 'accepted' LIMIT 1`)
    .get(conversationId, feedback.suggestionId, conversationId, feedback.suggestionId, feedback.impressionId);
  if (!exists) return false;
  db.prepare(`INSERT OR IGNORE INTO next_turn_suggestion_feedback
    (conversation_id, suggestion_id, impression_id, event, edited, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(conversationId, feedback.suggestionId, feedback.impressionId, feedback.event, feedback.edited ? 1 : 0, Date.now());
  return true;
}
