import useSWR from 'swr';

import { fetchProject, type Project } from '@/features/projects/api';
import { readLocalSessionDraft } from '@/features/chat/session/local-session-drafts';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { getSessionDetail } from '@/features/sessions/session-api';
import { useGatewayStore } from '@/stores/gateway-store';

export function useChatProjectScope(conversationId?: string | null, draftProjectId?: string | null): Project | null {
  const token = useGatewayStore((state) => state.conversationId);
  const baseUrl = useGatewayStore((state) => state.baseUrl);
  const localDraft = useChatSessionStore((state) => conversationId ? state.sessions[conversationId]?.localDraft : undefined);
  const { data, error } = useSWR(
    conversationId || draftProjectId ? ['chat-project-scope', baseUrl, token, conversationId, draftProjectId, localDraft === true ? 'draft' : localDraft === false ? 'persisted' : 'unknown'] : null,
    async () => {
      const draft = conversationId ? await readLocalSessionDraft(conversationId) : undefined;
      const projectId = draft
        ? draft.creation.projectId
        : conversationId ? (await getSessionDetail(conversationId)).projectId : draftProjectId;
      return projectId ? fetchProject(projectId) : null;
    },
    { keepPreviousData: false, shouldRetryOnError: false },
  );
  return error ? null : data ?? null;
}
