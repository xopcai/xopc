import { getConversationRouting } from '../routing/session-key.js';

export function connectorPrincipalForSession(conversationId: string | undefined): {
  principalId: string;
  agentId?: string;
  isLocalOwner: boolean;
} {
  const parsed = getConversationRouting(conversationId);
  if (!parsed || parsed.source === 'cli' || parsed.source === 'webchat') {
    return { principalId: 'local-owner', agentId: parsed?.agentId, isLocalOwner: true };
  }
  return {
    principalId: `channel:${parsed.source}:${parsed.accountId}:${parsed.peerKind}:${parsed.peerId}`,
    agentId: parsed.agentId,
    isLocalOwner: false,
  };
}
