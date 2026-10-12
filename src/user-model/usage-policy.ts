import type { AssertionAllowedUse, UserAssertion } from './domain.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/index.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { getSessionMetadata } from '../storage/sqlite/session-repository.js';
import { getUnderstandingConsent } from '../user-context/sources/consent-repository.js';
import { isOwnerIdentity } from '../user-context/identity-bindings.js';

/** Automatic personalization never grants execution authority. */
export function isWorkingAssumption(assertion: UserAssertion): boolean {
  return (assertion.status === 'candidate' || assertion.status === 'active')
    && (assertion.authority === 'user_observed' || assertion.authority === 'system_inferred')
    && assertion.confidence >= 0.7
    && (assertion.consequence === 'low' || assertion.consequence === 'medium')
    && assertion.sensitivity === 'normal'
    && assertion.disclosurePolicy !== 'ask_before_reference';
}

export function canUseAssertion(
  assertion: UserAssertion,
  asOf = Date.now(),
  context: { use?: AssertionAllowedUse; agentId?: string } = {},
): boolean {
  if (assertion.consentReceiptId) {
    if (!isXopcDatabaseOpen()) return false;
    const consent = getUnderstandingConsent(assertion.consentReceiptId);
    if (!consent || consent.revokedAt !== undefined || !consent.allowedDomains.includes(assertion.domain)) return false;
    if (!getSqliteDatabase().prepare("SELECT 1 FROM understanding_source_grants WHERE grant_id = ? AND status = 'active'")
      .get(consent.grantId)) return false;
  }
  if (isXopcDatabaseOpen() && assertion.id) {
    const db = getSqliteDatabase();
    const evidence = db.prepare(`SELECT e.source_type, e.source_item_id, e.conversation_id, e.content_hash,
      link.content_hash AS linked_hash FROM user_assertion_evidence link JOIN context_evidence e ON e.evidence_id = link.evidence_id
      WHERE link.assertion_id = ? AND link.relation = 'supports'`).all(assertion.id) as Array<{
        source_type: string; source_item_id: string | null; conversation_id: string | null; content_hash: string | null; linked_hash: string | null }>;
    if (assertion.createdBy === 'connector' && (!assertion.consentReceiptId || !evidence.length)) return false;
    for (const link of evidence) {
      if (link.conversation_id) {
        const session = getSessionMetadata(link.conversation_id);
        if (!session?.routing || session.routing.peerKind !== 'direct' || !isOwnerIdentity(session.routing)) return false;
      }
      if (link.source_type === 'connector') {
        if (!link.source_item_id || !link.linked_hash || link.linked_hash !== link.content_hash) return false;
        const source = db.prepare('SELECT content_hash, deleted_at FROM knowledge_source_items WHERE item_id = ?')
          .get(link.source_item_id) as { content_hash: string; deleted_at: number | null } | undefined;
        if (!source || source.deleted_at || source.content_hash !== link.linked_hash) return false;
      }
    }
  }
  return (assertion.validFrom === undefined || assertion.validFrom <= asOf)
    && (assertion.validTo === undefined || assertion.validTo >= asOf)
    && (assertion.deleteAfter === undefined || assertion.deleteAfter > asOf)
    && (assertion.reviewAt === undefined || assertion.reviewAt > asOf)
    && (!context.use || !assertion.allowedUses || assertion.allowedUses.includes(context.use))
    && (!assertion.allowedAgentIds || Boolean(context.agentId && assertion.allowedAgentIds.includes(context.agentId)))
    && assertion.sensitivity !== 'secret'
    && assertion.sensitivity !== 'regulated'
    && assertion.disclosurePolicy !== 'ask_before_reference'
    && ((assertion.status === 'active' && assertion.authority === 'user_explicit')
      || isWorkingAssumption(assertion));
}
