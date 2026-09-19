import { getConversationRouting } from '../routing/session-key.js';
import { getSessionMetadata } from '../storage/sqlite/session-repository.js';

export function connectorPrincipalForSession(conversationId: string | undefined): {
  principalId: string;
  agentId?: string;
  isLocalOwner: boolean;
} {
  let parsed = getConversationRouting(conversationId);
  const agentId = parsed?.agentId;
  const visited = new Set<string>();
  while (conversationId && parsed?.source === 'workflow' && !visited.has(conversationId) && visited.size < 8) {
    visited.add(conversationId);
    const metadata = getSessionMetadata(conversationId);
    const parent = metadata?.parentConversationId ?? metadata?.customData?.parentConversationId;
    if (typeof parent !== 'string') {
      if (metadata?.sessionType === 'workflow-run') return { principalId: 'local-owner', agentId, isLocalOwner: true };
      break;
    }
    const parentRouting = getConversationRouting(parent);
    if (!parentRouting) break;
    conversationId = parent;
    parsed = parentRouting;
  }
  if (!parsed || parsed.source === 'cli' || parsed.source === 'webchat') {
    return { principalId: 'local-owner', agentId, isLocalOwner: true };
  }
  return {
    principalId: `channel:${parsed.source}:${parsed.accountId}:${parsed.peerKind}:${parsed.peerId}`,
    agentId,
    isLocalOwner: false,
  };
}
