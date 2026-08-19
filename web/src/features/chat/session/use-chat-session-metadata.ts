import useSWR from 'swr';

import { getSessionDetail } from '@/features/sessions/session-api';
import { useGatewayStore } from '@/stores/gateway-store';

export interface ChatSessionMetadata {
  workflowRunId: string | null;
  outcomeId: string | null;
  ownerAgentId: string | null;
  sessionType: string | null;
  sourceNoteId: string | null;
  sourceNoteTitle: string | null;
  sourceWorkItemId: string | null;
}

/** Read execution bindings from the session's authoritative metadata. */
export function useChatSessionMetadata(sessionKey: string | null | undefined) {
  const token = useGatewayStore((s) => s.token);
  const trimmedKey = sessionKey?.trim() || null;

  return useSWR(
    token && trimmedKey ? ['chat-session-meta', trimmedKey, token] : null,
    async (): Promise<ChatSessionMetadata> => {
      const detail = await getSessionDetail(trimmedKey!);
      const rawRunId = detail.customData?.workflowRunId;
      const workflowRunId =
        typeof rawRunId === 'string' && rawRunId.trim() ? rawRunId.trim() : null;
      const rawOutcomeId = detail.customData?.outcomeId;
      const outcomeId =
        typeof rawOutcomeId === 'string' && rawOutcomeId.trim() ? rawOutcomeId.trim() : null;
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
      const sourceWorkItemId =
        sourceBinding?.kind === 'work_item' && typeof sourceBinding.sourceId === 'string' && sourceBinding.sourceId.trim()
          ? sourceBinding.sourceId.trim()
          : null;
      return {
        workflowRunId,
        outcomeId,
        ownerAgentId,
        sessionType,
        sourceNoteId,
        sourceNoteTitle: null,
        sourceWorkItemId,
      };
    },
    { revalidateOnFocus: false },
  );
}
