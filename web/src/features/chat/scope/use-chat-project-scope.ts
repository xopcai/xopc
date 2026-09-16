import useSWR from 'swr';

import { fetchProject, type Project } from '@/features/projects/api';
import { getSessionDetail } from '@/features/sessions/session-api';
import { useGatewayStore } from '@/stores/gateway-store';

export function useChatProjectScope(conversationId?: string | null, draftProjectId?: string | null): Project | null {
  const token = useGatewayStore((state) => state.conversationId);
  const baseUrl = useGatewayStore((state) => state.baseUrl);
  const { data, error } = useSWR(
    conversationId || draftProjectId ? ['chat-project-scope', baseUrl, token, conversationId, draftProjectId] : null,
    async () => {
      const projectId = conversationId ? (await getSessionDetail(conversationId)).projectId : draftProjectId;
      return projectId ? fetchProject(projectId) : null;
    },
    { keepPreviousData: false, shouldRetryOnError: false },
  );
  return error ? null : data ?? null;
}
