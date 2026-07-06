/**
 * React-Query bindings for share endpoints.
 *
 *  - `useShareList()`           : list shares (history)
 *  - `useCreateShare()`         : mutation → invalidates list
 *  - `useRevokeShare()`         : mutation → invalidates list
 *  - `useThumbnailReadiness()`  : polls HEAD until the server has a real
 *                                 (non-placeholder) thumbnail; stops after
 *                                 `maxAttempts` or once 'ready'/'gone'.
 *
 * Keep all share UI consuming these hooks so cache invalidation stays
 * coherent. Do NOT call createAutoShare / listShares directly from a
 * component — let React-Query own the cache.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createAutoShare,
  extendShare,
  listShares,
  probeThumbnail,
  revokeShare,
  type ShareAutoPayload,
  type ShareAutoRequest,
  type ShareListItem,
} from '../api/share';
import { consumePrefetchedShare } from '../features/share/share-prefetch';
import { useGatewayStore } from '../stores/gateway-store';
import { queryKeys } from './keys';

export function useShareList() {
  return useQuery<ShareListItem[]>({
    queryKey: queryKeys.shares,
    queryFn: listShares,
    // Stale-while-revalidate window keeps the history snappy on tab focus.
    staleTime: 30_000,
  });
}

export function useCreateShare() {
  const qc = useQueryClient();
  return useMutation<ShareAutoPayload, Error, ShareAutoRequest>({
    // If the caller (e.g. chat preview) prefetched this exact request, reuse
    // that in-flight/resolved Promise — the sheet becomes instant on tap.
    mutationFn: (req) => consumePrefetchedShare(req) ?? createAutoShare(req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.shares });
    },
  });
}

export function useRevokeShare() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: revokeShare,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.shares });
    },
  });
}

export function useExtendShare() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; extendTtlMs?: number; maxViews?: number | null }>({
    mutationFn: ({ id, ...patch }) => extendShare(id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.shares });
    },
  });
}

/**
 * Polls a thumbnail URL until the gateway has the real (non-placeholder) bytes.
 *
 * Usage:
 *   const { status } = useThumbnailReadiness(payload?.thumbnail.url, payload?.thumbnail.status);
 *   <Image source={{ uri: thumbnailUrlWithCacheBust(url, status) }} />
 *
 * Implementation notes:
 *  - Polls every `intervalMs` (default 600 ms) up to `maxAttempts` (default 8 ≈ 5 s).
 *  - Honors React component lifecycle (cancels on unmount).
 *  - `initialStatus === 'ready'` returns immediately without polling.
 */
export function useThumbnailReadiness(
  thumbnailUrl: string | undefined,
  initialStatus: 'ready' | 'pending' | 'unavailable' | undefined,
  opts: { intervalMs?: number; maxAttempts?: number } = {},
): { status: 'ready' | 'pending' | 'gone' | 'unknown' | 'unavailable'; attempt: number } {
  const intervalMs = opts.intervalMs ?? 600;
  const maxAttempts = opts.maxAttempts ?? 8;
  const token = useGatewayStore((s) => s.token);

  const [status, setStatus] = useState<'ready' | 'pending' | 'gone' | 'unknown' | 'unavailable'>(() =>
    initialStatus ?? 'unknown',
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setStatus(initialStatus ?? 'unknown');
    setAttempt(0);
  }, [thumbnailUrl, initialStatus]);

  useEffect(() => {
    if (!thumbnailUrl) return;
    if (status === 'ready' || status === 'gone' || status === 'unavailable') return;
    if (attempt >= maxAttempts) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const next = await probeThumbnail(thumbnailUrl, token);
      if (cancelled) return;
      setStatus(next);
      setAttempt((n) => n + 1);
    }, attempt === 0 ? 0 : intervalMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [thumbnailUrl, status, attempt, intervalMs, maxAttempts, token]);

  return { status, attempt };
}

/**
 * Cache-busts the thumbnail URL once the readiness transitions to ready, so
 * the `<Image>` source actually re-fetches the now-real bytes (otherwise
 * RN's image cache keeps showing the placeholder we already loaded).
 */
export function thumbnailUrlWithCacheBust(
  url: string | undefined,
  status: 'ready' | 'pending' | 'gone' | 'unknown' | 'unavailable',
): string | undefined {
  if (!url) return undefined;
  if (status !== 'ready') return url;
  // Once ready we bust ONCE — keep cache thereafter. `?_=ready` is a stable
  // sentinel; we don't keep mutating it.
  return url.includes('?') ? `${url}&_=ready` : `${url}?_=ready`;
}
