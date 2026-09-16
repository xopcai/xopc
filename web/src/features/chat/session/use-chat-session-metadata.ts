import useSWR from 'swr';
import type { SessionIdentityInput } from '@xopcai/gateway-contract';

import { getSessionDetail } from '@/features/sessions/session-api';
import { useGatewayStore } from '@/stores/gateway-store';

export interface ChatSessionMetadata {
  identity?: SessionIdentityInput;
  workflowRunId: string | null;
  ownerAgentId: string | null;
  sessionType: string | null;
  sourceNoteId: string | null;
  sourceNoteTitle: string | null;
  parentConversationId: string | null;
  forkedFromSessionName: string | null;
}

/** Read execution bindings from the session's authoritative metadata. */
export function useChatSessionMetadata(conversationId: string | null | undefined) {
  const token = useGatewayStore((s) => s.conversationId);
  const trimmedKey = conversationId?.trim() || null;

  return useSWR(
    token && trimmedKey ? ['chat-session-meta', trimmedKey, token] : null,
    async (): Promise<ChatSessionMetadata> => {
      const detail = await getSessionDetail(trimmedKey!);
      const rawRunId = detail.customData?.workflowRunId;
      const workflowRunId =
        typeof rawRunId === 'string' && rawRunId.trim() ? rawRunId.trim() : null;
      const sessionType =
        typeof detail.sessionType === 'string' && detail.sessionType.trim()
          ? detail.sessionType.trim()
          : null;
      const ownerAgentId =
        typeof detail.routing?.agentId === 'string' && detail.routing.agentId.trim()
          ? detail.routing.agentId.trim()
          : null;
      const rawSourceBinding = detail.customData?.sourceBinding;
      const sourceBinding = rawSourceBinding && typeof rawSourceBinding === 'object'
        ? rawSourceBinding as Record<string, unknown>
        : null;
      const sourceNoteId =
        sourceBinding?.kind === 'note' && typeof sourceBinding.sourceId === 'string' && sourceBinding.sourceId.trim()
          ? sourceBinding.sourceId.trim()
          : null;
      const parentConversationId =
        typeof detail.parentConversationId === 'string' && detail.parentConversationId.trim()
          ? detail.parentConversationId.trim()
          : null;
      const rawForkedFromSessionName = detail.customData?.forkedFromSessionName;
      return {
        identity: { sourceChannel: detail.sourceChannel, sessionType: detail.sessionType, customData: detail.customData },
        workflowRunId,
        ownerAgentId,
        sessionType,
        sourceNoteId,
        sourceNoteTitle: null,
        parentConversationId,
        forkedFromSessionName:
          typeof rawForkedFromSessionName === 'string' && rawForkedFromSessionName.trim()
            ? rawForkedFromSessionName.trim()
            : null,
      };
    },
    { revalidateOnFocus: false },
  );
}
