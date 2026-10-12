import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { getUnderstandingConsent } from '../user-context/sources/consent-repository.js';
import { getSessionMetadata } from '../storage/sqlite/session-repository.js';
import { isOwnerIdentity } from '../user-context/identity-bindings.js';
import type { KnowledgeItem, KnowledgeReadPolicy, KnowledgeVisibilityContext } from './domain.js';

export type KnowledgeExclusion = 'principal' | 'scope' | 'source_not_allowed' | 'expired'
  | 'conflicted' | 'sensitive' | 'evidence_missing' | 'source_revoked' | 'source_changed' | 'agent_not_allowed';

export function knowledgeContentSources(item: KnowledgeItem): Array<'memory' | 'local_import' | 'connector'> {
  if (item.source.kind === 'product_import') return ['local_import'];
  if (typeof item.source.sourceInstanceId === 'string' && item.source.sourceInstanceId.startsWith('local-folder:')) {
    return item.recordClass === 'memory' ? ['memory', 'local_import'] : ['local_import'];
  }
  if (item.recordClass === 'source_index' || item.source.sourceInstanceId || item.source.sourceRunId
    || item.source.consentReceiptId) return item.recordClass === 'memory' ? ['memory', 'connector'] : ['connector'];
  return ['memory'];
}

/** Source reliability affects how knowledge is described, never execution authority. */
export function knowledgeExclusion(item: KnowledgeItem, context: KnowledgeVisibilityContext,
  policy?: KnowledgeReadPolicy, asOf = Date.now()): KnowledgeExclusion | undefined {
  if (item.principalId !== 'local-owner') return 'principal';
  const visible = item.scope.type === 'global' || item.scope.id === ({ agent: context.agentId,
    workspace: context.workspaceId, project: context.projectId, session: context.conversationId,
  } as Record<string, string | undefined>)[item.scope.type];
  if (!visible || (policy && !policy.scopes.includes(item.scope.type))) return 'scope';
  if (policy && !knowledgeContentSources(item).every(source => policy.contentSources.includes(source))) return 'source_not_allowed';
  if (item.status !== 'active' || (item.validFrom !== undefined && item.validFrom > asOf)
    || (item.validTo !== undefined && item.validTo < asOf) || (item.expiresAt !== undefined && item.expiresAt < asOf)
    || (item.reviewAt !== undefined && item.reviewAt <= asOf)) return 'expired';
  if (item.verification === 'conflicted' || item.verification === 'tentative') return 'conflicted';
  if (item.sensitivity === 'secret' || item.sensitivity === 'regulated') return 'sensitive';
  if (item.originClass !== 'owner' && item.sourceConversationId) {
    const session = getSessionMetadata(item.sourceConversationId);
    if (!session?.routing || session.routing.peerKind !== 'direct' || !isOwnerIdentity(session.routing)) return 'source_revoked';
  }
  const db = getSqliteDatabase();
  const links = db.prepare(`SELECT e.*, l.content_hash AS linked_hash, l.consent_receipt_id
    FROM knowledge_evidence_links l JOIN context_evidence e ON e.evidence_id = l.evidence_id
    WHERE l.knowledge_id = ?`).all(item.id) as Array<{
    source_type: string; source_item_id: string | null; source_instance_id: string | null;
    content_hash: string | null; linked_hash: string | null; consent_receipt_id: string | null;
    conversation_id: string | null;
  }>;
  if (item.originClass === 'untrusted' && !links.length) return 'evidence_missing';
  for (const link of links) {
    if (link.conversation_id) {
      const session = getSessionMetadata(link.conversation_id);
      if (!session?.routing || session.routing.peerKind !== 'direct' || !isOwnerIdentity(session.routing)) return 'source_revoked';
    }
    if (link.linked_hash && link.linked_hash !== link.content_hash) return 'source_changed';
    if (link.source_item_id) {
      const source = db.prepare('SELECT content_hash, deleted_at FROM knowledge_source_items WHERE item_id = ?')
        .get(link.source_item_id) as { content_hash: string; deleted_at: string | null } | undefined;
      if (!source || source.deleted_at) return 'source_revoked';
      if (link.linked_hash && link.linked_hash !== source.content_hash) return 'source_changed';
    }
    if (link.source_type === 'connector') {
      if (!link.consent_receipt_id) return 'evidence_missing';
      const consent = getUnderstandingConsent(link.consent_receipt_id);
      if (!consent || consent.revokedAt !== undefined || !consent.purposes.includes('work_assistance')) return 'source_revoked';
      const grant = db.prepare('SELECT status FROM understanding_source_grants WHERE grant_id = ?')
        .get(consent.grantId) as { status: string } | undefined;
      if (grant?.status !== 'active') return 'source_revoked';
      if (consent.allowedAgentIds && !consent.allowedAgentIds.includes(context.agentId)) return 'agent_not_allowed';
    }
  }
  return undefined;
}

export function canUseKnowledge(item: KnowledgeItem, context: KnowledgeVisibilityContext,
  policy?: KnowledgeReadPolicy, asOf = Date.now()): boolean {
  return knowledgeExclusion(item, context, policy, asOf) === undefined;
}
