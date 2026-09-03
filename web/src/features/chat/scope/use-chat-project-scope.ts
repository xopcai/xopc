import useSWR from 'swr';

import { fetchProject, type Project } from '@/features/projects/api';
import { getSessionDetail } from '@/features/sessions/session-api';
import { useGatewayStore } from '@/stores/gateway-store';

export function useChatProjectScope(sessionKey?: string | null, draftProjectId?: string | null): Project | null {
  const token = useGatewayStore((state) => state.token);
  const baseUrl = useGatewayStore((state) => state.baseUrl);
  const { data, error } = useSWR(
    sessionKey || draftProjectId ? ['chat-project-scope', baseUrl, token, sessionKey, draftProjectId] : null,
    async () => {
      const projectId = sessionKey ? (await getSessionDetail(sessionKey)).projectId : draftProjectId;
      return projectId ? fetchProject(projectId) : null;
    },
    { keepPreviousData: false, shouldRetryOnError: false },
  );
  return error ? null : data ?? null;
}
