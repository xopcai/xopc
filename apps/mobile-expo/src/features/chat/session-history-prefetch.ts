import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../query/keys';
import {
  emptySessionMessagePage,
  fetchSessionMessagePage,
  type SessionMessagePage,
} from '../../query/sessions';
import { fetchSessionAgentConfig } from '../../query/models';

export async function loadSessionHistoryHead(
  conversationId: string,
  before?: string,
): Promise<SessionMessagePage> {
  const page = await fetchSessionMessagePage(conversationId, { limit: 50, before });
  return page ?? emptySessionMessagePage(conversationId);
}

/** Prime the exact infinite-query entry consumed by ChatScreen before navigation. */
export function prefetchSessionHistoryHead(
  queryClient: QueryClient,
  conversationId: string,
  profileId?: string | null,
): Promise<void> {
  return queryClient.prefetchInfiniteQuery({
    queryKey: queryKeys.sessionHistory(conversationId, profileId),
    queryFn: ({ pageParam }) => loadSessionHistoryHead(conversationId, pageParam),
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
  conversationId: string,
  profileId?: string | null,
): Promise<void> {
  await Promise.all([
    prefetchSessionHistoryHead(queryClient, conversationId, profileId),
    queryClient.prefetchQuery({
      queryKey: queryKeys.sessionAgentConfig(conversationId),
      queryFn: () => fetchSessionAgentConfig(conversationId),
      staleTime: 15_000,
    }),
  ]);
}
