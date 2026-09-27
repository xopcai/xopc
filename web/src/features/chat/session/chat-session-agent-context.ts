import { readLocalSessionDraft } from '@/features/chat/session/local-session-drafts';
import { getSessionDetail } from '@/features/sessions/session-api';

export type ChatSessionAgentContext = {
  agentId: string;
  projectId: string | null;
};

/** Local drafts do not exist in the Gateway yet, so their creation identity is authoritative. */
export async function resolveChatSessionAgentContext(
  conversationId: string,
): Promise<ChatSessionAgentContext> {
  const draft = await readLocalSessionDraft(conversationId);
  if (draft) {
    return {
      agentId: draft.creation.agentId.trim().toLowerCase(),
      projectId: draft.creation.projectId?.trim() || null,
    };
  }

  const session = await getSessionDetail(conversationId);
  return {
    agentId: (session.routing?.agentId ?? session.agentId).trim().toLowerCase(),
    projectId: session.projectId?.trim() || null,
  };
}
