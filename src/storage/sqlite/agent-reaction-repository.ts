import type { SessionAgentReaction } from '@xopcai/gateway-contract';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export type ReactionTarget = Omit<SessionAgentReaction, 'entryId' | 'emoji' | 'createdAtMs' | 'actorName'> & { inputId: string };

export const DEFAULT_AGENT_REACTION = '💬';

const ACTIVE_REACTION_INPUT = `SELECT s.active_transcript_id, r.active_run_id FROM sessions s
    JOIN session_input_runtime r ON r.conversation_id = s.conversation_id
    JOIN session_inputs i ON i.id = r.active_input_id AND i.conversation_id = s.conversation_id
    JOIN session_input_receipts receipt ON receipt.conversation_id = i.conversation_id
      AND receipt.client_message_id = i.client_message_id AND receipt.input_id = i.id
      AND receipt.transcript_id = s.active_transcript_id
    WHERE s.conversation_id = ? AND s.active_transcript_id = ? AND s.agent_id = ?
      AND r.active_run_id = ? AND i.id = ? AND i.client_message_id = ? AND i.status = 'running'
      AND i.kind = 'message' AND i.effective_delivery = 'next'
      AND i.expected_transcript_id = s.active_transcript_id
      AND json_extract(i.origin_json, '$.type') = 'endpoint'
      AND (? = 1 OR NOT EXISTS (SELECT 1 FROM session_inputs steer WHERE steer.conversation_id = i.conversation_id
        AND (steer.target_run_id = r.active_run_id OR steer.run_id = r.active_run_id)
        AND steer.id <> i.id AND steer.effective_delivery = 'steer'))`;

function reactionInputBindings(target: ReactionTarget, allowSteering = false) {
  return [target.conversationId, target.transcriptId, target.actorAgentId, target.runId, target.inputId,
    target.clientMessageId, Number(allowSteering)];
}

export function hasActiveReactionInput(target: ReactionTarget): boolean {
  return getSqliteDatabase().prepare(ACTIVE_REACTION_INPUT).get(...reactionInputBindings(target)) !== undefined;
}

export function activeReactionEntry(target: ReactionTarget, options?: { allowSteering: boolean }): { entryId: string; seq: number } | undefined {
  const entries = getSqliteDatabase().prepare(`SELECT e.entry_id AS entryId, e.seq
    FROM (${ACTIVE_REACTION_INPUT}) input JOIN transcript_entries e ON e.transcript_id = input.active_transcript_id
    WHERE e.entry_kind = 'message' AND e.role = 'user' AND json_extract(e.payload_json, '$.turnId') = input.active_run_id
      AND COALESCE(json_extract(e.payload_json, '$.metadata.steered'), 0) = 0
      AND COALESCE(json_extract(e.payload_json, '$.metadata.hiddenFromClient'), 0) = 0
    ORDER BY e.seq DESC LIMIT 2`).all(...reactionInputBindings(target, options?.allowSteering)) as Array<{ entryId: string; seq: number }>;
  return entries.length === 1 ? entries[0] : undefined;
}

export function reactionCoolingDown(conversationId: string, now: number): boolean {
  return Boolean(getSqliteDatabase().prepare(`SELECT 1 FROM session_agent_reactions
    WHERE conversation_id = ? AND created_at_ms > ? AND emoji <> ? LIMIT 1`)
    .get(conversationId, now - 20_000, DEFAULT_AGENT_REACTION));
}

export function commitAgentReaction(input: ReactionTarget, entryId: string, emoji: string, actorName: string): SessionAgentReaction | null {
  return runSqliteWriteTransaction(db => {
    const now = Date.now();
    const isDefault = emoji === DEFAULT_AGENT_REACTION;
    if (activeReactionEntry(input, { allowSteering: isDefault })?.entryId !== entryId
      || (!isDefault && reactionCoolingDown(input.conversationId, now))) return null;
    const { inputId: _inputId, ...identity } = input;
    const result = db.prepare(`INSERT INTO session_agent_reactions
      (conversation_id, transcript_id, client_message_id, entry_id, actor_agent_id, run_id, emoji, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(input.conversationId, input.transcriptId,
      input.clientMessageId, entryId, input.actorAgentId, input.runId, emoji, now);
    return result.changes ? { ...identity, entryId, emoji, createdAtMs: now, actorName } : null;
  });
}

export function readAgentReactions(conversationId: string, transcriptId: string, entries: readonly string[], actorName: string): SessionAgentReaction[] {
  if (!entries.length) return [];
  return getSqliteDatabase().prepare(`SELECT r.conversation_id AS conversationId, r.transcript_id AS transcriptId,
    r.client_message_id AS clientMessageId, r.entry_id AS entryId, r.actor_agent_id AS actorAgentId,
    r.run_id AS runId, r.emoji, r.created_at_ms AS createdAtMs, ? AS actorName
    FROM session_agent_reactions r JOIN sessions s ON s.conversation_id = r.conversation_id
      AND s.active_transcript_id = r.transcript_id
    WHERE r.conversation_id = ? AND r.transcript_id = ? AND r.entry_id IN (${entries.map(() => '?').join(',')})`)
    .all(actorName, conversationId, transcriptId, ...entries) as unknown as SessionAgentReaction[];
}
