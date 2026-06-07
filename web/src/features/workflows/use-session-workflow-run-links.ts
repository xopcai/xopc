import useSWR from 'swr';

import { getSessionDetail } from '@/features/sessions/session-api';
import { useGatewayStore } from '@/stores/gateway-store';

import {
  parseWorkflowRunLinksFromTranscriptRows,
  type WorkflowRunLinkEntry,
} from './parse-workflow-run-links';

/** Parent-session pointer cards persisted as `kind: 'context'` transcript rows. */
export function useSessionWorkflowRunLinks(sessionKey: string | null | undefined) {
  const token = useGatewayStore((s) => s.token);
  const trimmedKey = sessionKey?.trim() || null;

  return useSWR(
    token && trimmedKey ? ['session-workflow-run-links', trimmedKey, token] : null,
    async (): Promise<WorkflowRunLinkEntry[]> => {
      const detail = await getSessionDetail(trimmedKey!, { includeTranscriptRows: true });
      return parseWorkflowRunLinksFromTranscriptRows(detail.transcriptRows);
    },
    { revalidateOnFocus: false },
  );
}
