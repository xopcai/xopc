import { resolveSessionIdentity } from '@xopcai/gateway-contract';
import useSWR from 'swr';

import { readLocalSessionDraft } from '@/features/chat/session/local-session-drafts';
import { getSessionDetail } from '@/features/sessions/session-api';
import { useGatewayStore } from '@/stores/gateway-store';

export type ChatSessionAgentContext = {
  agentId: string;
  projectId: string | null;
  agentSetup?: true;
  expertChat?: true;
};

export function chatSessionAgentContextKey(gatewaySession: string | undefined, conversationId: string) {
  return ['gateway-chat-session-agent', gatewaySession, conversationId] as const;
}

export function useChatSessionAgentContext(conversationId?: string | null) {
  const gatewaySession = useGatewayStore(state => state.conversationId);
  const key = conversationId?.trim();
  return useSWR(
    gatewaySession && key ? chatSessionAgentContextKey(gatewaySession, key) : null,
    ([, , sessionId]) => resolveChatSessionAgentContext(sessionId),
    { revalidateOnFocus: false },
  );
}

/** Local drafts do not exist in the Gateway yet, so their creation identity is authoritative. */
export async function resolveChatSessionAgentContext(
  conversationId: string,
): Promise<ChatSessionAgentContext> {
  const draft = await readLocalSessionDraft(conversationId);
  if (draft) {
    return {
      agentId: draft.creation.agentId.trim().toLowerCase(),
      projectId: draft.creation.projectId?.trim() || null,
      ...(draft.creation.agentSetup ? { agentSetup: true } : {}),
      ...(!draft.creation.agentSetup && !draft.creation.temporary ? { expertChat: true } : {}),
    };
  }

  const session = await getSessionDetail(conversationId, { limit: 1 });
  const identity = typeof session.sourceChannel === 'string' ? resolveSessionIdentity(session) : undefined;
  const isExpertChat = identity?.source === 'workbench' && identity.purpose === 'chat'
    && session.status !== 'archived' && !session.parentConversationId && session.customData?.agentSetup !== true;
  return {
    agentId: (session.routing?.agentId ?? session.agentId).trim().toLowerCase(),
    projectId: session.projectId?.trim() || null,
    ...(session.customData?.agentSetup === true ? { agentSetup: true } : {}),
    ...(isExpertChat ? { expertChat: true } : {}),
  };
}
