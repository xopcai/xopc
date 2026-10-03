import useSWR from 'swr';

import { getSessionDetail } from '@/features/sessions/session-api';
import { readLocalSessionDraft } from '@/features/chat/session/local-session-drafts';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { useGatewayStore } from '@/stores/gateway-store';

import {
  parseWorkflowRunLinksFromTranscriptRows,
  type WorkflowRunLinkEntry,
} from './parse-workflow-run-links';

/** Parent-session pointer cards persisted as `kind: 'context'` transcript rows. */
export function useSessionWorkflowRunLinks(conversationId: string | null | undefined) {
  const token = useGatewayStore((s) => s.conversationId);
  const trimmedKey = conversationId?.trim() || null;
  const localDraft = useChatSessionStore((s) => trimmedKey ? s.sessions[trimmedKey]?.localDraft : undefined);

  return useSWR(
    token && trimmedKey && !localDraft ? ['session-workflow-run-links', trimmedKey, token, localDraft === false ? 'persisted' : 'unknown'] : null,
    async (): Promise<WorkflowRunLinkEntry[]> => {
      if (await readLocalSessionDraft(trimmedKey!)) return [];
      const detail = await getSessionDetail(trimmedKey!, { includeTranscriptRows: true });
      return parseWorkflowRunLinksFromTranscriptRows(detail.transcriptRows);
    },
    { revalidateOnFocus: false },
  );
}
