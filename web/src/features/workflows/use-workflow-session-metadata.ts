import useSWR from 'swr';

import { getSessionDetail } from '@/features/sessions/session-api';
import { useGatewayStore } from '@/stores/gateway-store';

export interface WorkflowSessionMetadata {
  workflowRunId: string | null;
  ownerAgentId: string | null;
  sessionType: string | null;
  sourceNoteId: string | null;
  sourceNoteTitle: string | null;
  sourceWorkItemId: string | null;
}

/** Read workflow run binding from session metadata (`customData.workflowRunId`). */
export function useWorkflowSessionMetadata(sessionKey: string | null | undefined) {
  const token = useGatewayStore((s) => s.token);
  const trimmedKey = sessionKey?.trim() || null;

  return useSWR(
    token && trimmedKey ? ['workflow-session-meta', trimmedKey, token] : null,
    async (): Promise<WorkflowSessionMetadata> => {
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
      const sourceWorkItemId =
        sourceBinding?.kind === 'work_item' && typeof sourceBinding.sourceId === 'string' && sourceBinding.sourceId.trim()
          ? sourceBinding.sourceId.trim()
          : null;
      const sourceNoteTitle = null;
      return { workflowRunId, ownerAgentId, sessionType, sourceNoteId, sourceNoteTitle, sourceWorkItemId };
    },
    { revalidateOnFocus: false },
  );
}
