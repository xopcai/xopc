/**
 * Session history data hook.
 *
 * Manages infinite-query for session message pages, caching,
 * page merging, and prefetching older pages.
 */
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { queryKeys } from '../../query/keys';
import { fetchSessionMessagePage, emptySessionMessagePage, useGatewayConfigured } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import {
  readCachedSessionHistoryHead,
  writeCachedSessionHistoryHead,
} from './session-history-cache';
import {
  appendOlderSessionHistoryPage,
  mergeLatestSessionHistoryPage,
} from './session-message-parser';

export function useSessionHistory(sessionKey: string) {
  const queryClient = useQueryClient();
  const configured = useGatewayConfigured();
  const activeGatewayId = useGatewayStore((state) => state.activeGatewayId);
  const prefetchedOlderHistoryCursorRef = useRef('');

  const cachedSessionHistoryHead = useMemo(() => (
    sessionKey ? readCachedSessionHistoryHead(activeGatewayId, sessionKey) : null
  ), [activeGatewayId, sessionKey]);

  const sessionHistoryQuery = useInfiniteQuery({
    queryKey: queryKeys.sessionHistory(sessionKey, activeGatewayId),
    queryFn: async ({ pageParam }) => {
      const page = await fetchSessionMessagePage(sessionKey, {
        limit: 50,
        before: pageParam,
      });
      return page ?? emptySessionMessagePage(sessionKey);
    },
    placeholderData: cachedSessionHistoryHead
      ? { pages: [cachedSessionHistoryHead], pageParams: [undefined] }
      : undefined,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (
      lastPage?.pagination.hasMore ? lastPage.pagination.nextBeforeCursor : undefined
    ),
    enabled: Boolean(sessionKey && configured),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Write head page to cache when data arrives
  useEffect(() => {
    const headPage = sessionHistoryQuery.data?.pages[0];
    if (!activeGatewayId || !sessionKey || !headPage || sessionHistoryQuery.isPlaceholderData) return;
    writeCachedSessionHistoryHead(activeGatewayId, sessionKey, headPage);
  }, [activeGatewayId, sessionHistoryQuery.data?.pages, sessionHistoryQuery.isPlaceholderData, sessionKey]);

  // Reset prefetch cursor on session change
  useEffect(() => {
    prefetchedOlderHistoryCursorRef.current = '';
  }, [sessionKey]);

  // Prefetch older pages
  useEffect(() => {
    const loadedPages = sessionHistoryQuery.data?.pages ?? [];
    const lastLoadedPage = loadedPages[loadedPages.length - 1];
    const olderCursor = lastLoadedPage?.pagination.nextBeforeCursor;
    if (!sessionKey || !lastLoadedPage?.pagination.hasMore || !olderCursor) return;
    if (sessionHistoryQuery.isFetching || sessionHistoryQuery.isFetchingNextPage) return;

    const prefetchKey = `${sessionKey}:${olderCursor}`;
    if (prefetchedOlderHistoryCursorRef.current === prefetchKey) return;
    prefetchedOlderHistoryCursorRef.current = prefetchKey;

    void queryClient.prefetchQuery({
      queryKey: queryKeys.sessionHistoryOlderPreview(sessionKey, olderCursor, activeGatewayId),
      queryFn: () => fetchSessionMessagePage(sessionKey, { limit: 50, before: olderCursor }),
      staleTime: 60_000,
    }).catch(() => {
      prefetchedOlderHistoryCursorRef.current = '';
    });
  }, [activeGatewayId, queryClient, sessionHistoryQuery.data?.pages, sessionHistoryQuery.isFetching, sessionHistoryQuery.isFetchingNextPage, sessionKey]);

  return {
    sessionHistoryQuery,
    configured,
  };
}

export { mergeLatestSessionHistoryPage, appendOlderSessionHistoryPage };
