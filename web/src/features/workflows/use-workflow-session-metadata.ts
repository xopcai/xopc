import useSWR from 'swr';

import { getSessionDetail } from '@/features/sessions/session-api';
import { useGatewayStore } from '@/stores/gateway-store';

export interface WorkflowSessionMetadata {
  workflowRunId: string | null;
  sessionType: string | null;
  sourceNoteId: string | null;
  sourceNoteTitle: string | null;
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
      const rawSourceNoteId = detail.customData?.sourceNoteId;
      const sourceNoteId =
        typeof rawSourceNoteId === 'string' && rawSourceNoteId.trim()
          ? rawSourceNoteId.trim()
          : null;
      const rawSourceNoteTitle = detail.customData?.sourceNoteTitle;
      const sourceNoteTitle =
        typeof rawSourceNoteTitle === 'string' && rawSourceNoteTitle.trim()
          ? rawSourceNoteTitle.trim()
          : null;
      return { workflowRunId, sessionType, sourceNoteId, sourceNoteTitle };
    },
    { revalidateOnFocus: false },
  );
}
