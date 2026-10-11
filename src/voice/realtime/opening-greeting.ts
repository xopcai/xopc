import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';

export type OpeningGreetingResult = 'completed' | 'skipped' | 'interrupted' | 'failed' | 'expired';
export interface OpeningGreetingIdentity {
  principalId: string;
  conversationId: string;
  logicalCallId: string;
  responseId: string;
}

/** Only an explicitly provided name is used; never infer identity from an account ID. */
export function openingGreetingText(callName: string | null | undefined, language: 'zh' | 'en'): string {
  const name = callName?.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return language === 'en' ? name ? `Hi, ${name}. I'm here.` : "Hi, I'm here."
    : name ? `嗨，${name}，我在。` : '嗨，我在。';
}

/** Claim before output: crashes and interrupted calls must never replay the greeting. */
export function claimOpeningGreeting(identity: OpeningGreetingIdentity, now = Date.now()): boolean {
  const db = getSqliteDatabase();
  db.prepare('DELETE FROM voice_opening_greetings WHERE created_at < ?').run(now - 86_400_000);
  return db.prepare(`INSERT OR IGNORE INTO voice_opening_greetings
    (principal_id, conversation_id, logical_call_id, response_id, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'claimed', ?, ?)`).run(identity.principalId, identity.conversationId,
      identity.logicalCallId, identity.responseId, now, now).changes === 1;
}

export function finishOpeningGreeting(identity: OpeningGreetingIdentity, state: OpeningGreetingResult, reason?: string): void {
  getSqliteDatabase().prepare(`UPDATE voice_opening_greetings SET state = ?, reason = ?, updated_at = ?
    WHERE principal_id = ? AND conversation_id = ? AND logical_call_id = ? AND state = 'claimed'`)
    .run(state, reason ?? null, Date.now(), identity.principalId, identity.conversationId, identity.logicalCallId);
}
