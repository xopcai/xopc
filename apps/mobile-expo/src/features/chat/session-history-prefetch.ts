import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../query/keys';
import {
  emptySessionMessagePage,
  fetchSessionMessagePage,
  type SessionMessagePage,
} from '../../query/sessions';
import { fetchSessionAgentConfig } from '../../query/models';

export async function loadSessionHistoryHead(
  sessionKey: string,
  before?: string,
): Promise<SessionMessagePage> {
  const page = await fetchSessionMessagePage(sessionKey, { limit: 50, before });
  return page ?? emptySessionMessagePage(sessionKey);
}

/** Prime the exact infinite-query entry consumed by ChatScreen before navigation. */
export function prefetchSessionHistoryHead(
  queryClient: QueryClient,
  sessionKey: string,
  profileId?: string | null,
): Promise<void> {
  return queryClient.prefetchInfiniteQuery({
    queryKey: queryKeys.sessionHistory(sessionKey, profileId),
    queryFn: ({ pageParam }) => loadSessionHistoryHead(sessionKey, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: SessionMessagePage) => (
      lastPage.pagination.hasMore ? lastPage.pagination.nextBeforeCursor : undefined
    ),
    staleTime: 15_000,
  });
}

/** Prime every query that can change the first rendered shape of a chat turn. */
export async function prefetchSessionChatEntry(
  queryClient: QueryClient,
  sessionKey: string,
  profileId?: string | null,
): Promise<void> {
  await Promise.all([
    prefetchSessionHistoryHead(queryClient, sessionKey, profileId),
    queryClient.prefetchQuery({
      queryKey: queryKeys.sessionAgentConfig(sessionKey),
      queryFn: () => fetchSessionAgentConfig(sessionKey),
      staleTime: 15_000,
    }),
  ]);
}
