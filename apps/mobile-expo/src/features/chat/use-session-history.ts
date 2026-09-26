/**
 * Session history data hook.
 *
 * Manages infinite-query for session message pages, caching,
 * page merging, and prefetching older pages.
 */
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { queryKeys } from '../../query/keys';
import { fetchSessionMessagePage, useGatewayConfigured, type SessionMessagePage } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import {
  readCachedSessionHistoryPage,
  readCachedSessionHistoryHead,
  writeCachedSessionHistoryPage,
  writeCachedSessionHistoryHead,
} from './session-history-cache';
import {
  appendOlderSessionHistoryPage,
  mergeLatestSessionHistoryPage,
} from './session-message-parser';
import { loadSessionHistoryHead } from './session-history-prefetch';

export function useSessionHistory(conversationId: string) {
  const queryClient = useQueryClient();
  const configured = useGatewayConfigured();
  const activeGatewayId = useGatewayStore((state) => state.activeGatewayId);
  const prefetchedOlderHistoryCursorRef = useRef('');

  const cachedSessionHistoryHead = useMemo(() => (
    conversationId ? readCachedSessionHistoryHead(activeGatewayId, conversationId) : null
  ), [activeGatewayId, conversationId]);

  const sessionHistoryQuery = useInfiniteQuery({
    queryKey: queryKeys.sessionHistory(conversationId, activeGatewayId),
    queryFn: async ({ pageParam }) => {
      if (!pageParam) return loadSessionHistoryHead(conversationId);
      const current = queryClient.getQueryData<InfiniteData<SessionMessagePage | null, string | undefined>>(
        queryKeys.sessionHistory(conversationId, activeGatewayId),
      );
      const transcriptId = current?.pages?.[0]?.session.transcriptId
        ?? readCachedSessionHistoryHead(activeGatewayId, conversationId)?.session.transcriptId;
      const cached = readCachedSessionHistoryPage(
        activeGatewayId,
        conversationId,
        transcriptId,
        pageParam,
      );
      if (cached) return cached;
      const page = await loadSessionHistoryHead(conversationId, pageParam);
      writeCachedSessionHistoryPage(activeGatewayId, conversationId, pageParam, page);
      return page;
    },
    // Seed stale data rather than a placeholder: a failed refresh must not erase offline history.
    initialData: cachedSessionHistoryHead
      ? { pages: [cachedSessionHistoryHead], pageParams: [undefined] }
      : undefined,
    initialDataUpdatedAt: 0,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (
      lastPage?.pagination.hasMore ? lastPage.pagination.nextBeforeCursor : undefined
    ),
    enabled: Boolean(conversationId && configured),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Write head page to cache when data arrives
  useEffect(() => {
    const headPage = sessionHistoryQuery.data?.pages[0];
    if (!activeGatewayId || !conversationId || !headPage || !sessionHistoryQuery.dataUpdatedAt || sessionHistoryQuery.isPlaceholderData) return;
    writeCachedSessionHistoryHead(activeGatewayId, conversationId, headPage);
    const revision = headPage.pagination.revision;
    if (typeof revision === 'number') {
      void import('./session-sync-cursor').then(({ writeSessionSyncCursor }) => {
        writeSessionSyncCursor(activeGatewayId, conversationId, {
          transcriptId: headPage.session.transcriptId,
          revision,
        });
      });
    }
  }, [activeGatewayId, sessionHistoryQuery.data?.pages, sessionHistoryQuery.dataUpdatedAt, sessionHistoryQuery.isPlaceholderData, conversationId]);

  // Reset prefetch cursor on session change
  useEffect(() => {
    prefetchedOlderHistoryCursorRef.current = '';
  }, [conversationId]);

  // Prefetch older pages
  useEffect(() => {
    const loadedPages = sessionHistoryQuery.data?.pages ?? [];
    const lastLoadedPage = loadedPages[loadedPages.length - 1];
    const olderCursor = lastLoadedPage?.pagination.nextBeforeCursor;
    if (!conversationId || !lastLoadedPage?.pagination.hasMore || !olderCursor) return;
    if (sessionHistoryQuery.isFetching || sessionHistoryQuery.isFetchingNextPage) return;

    const prefetchKey = `${conversationId}:${olderCursor}`;
    if (prefetchedOlderHistoryCursorRef.current === prefetchKey) return;
    prefetchedOlderHistoryCursorRef.current = prefetchKey;

    void queryClient.prefetchQuery({
      queryKey: queryKeys.sessionHistoryOlderPreview(conversationId, olderCursor, activeGatewayId),
      queryFn: async () => {
        const transcriptId = loadedPages[0]?.session.transcriptId;
        const cached = readCachedSessionHistoryPage(
          activeGatewayId,
          conversationId,
          transcriptId,
          olderCursor,
        );
        if (cached) return cached;
        const page = await fetchSessionMessagePage(conversationId, { limit: 50, before: olderCursor });
        if (page) writeCachedSessionHistoryPage(activeGatewayId, conversationId, olderCursor, page);
        return page;
      },
      staleTime: 60_000,
    }).catch(() => {
      prefetchedOlderHistoryCursorRef.current = '';
    });
  }, [activeGatewayId, queryClient, sessionHistoryQuery.data?.pages, sessionHistoryQuery.isFetching, sessionHistoryQuery.isFetchingNextPage, conversationId]);

  return {
    sessionHistoryQuery,
    configured,
  };
}

export { mergeLatestSessionHistoryPage, appendOlderSessionHistoryPage };
