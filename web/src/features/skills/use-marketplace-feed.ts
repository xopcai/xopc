import { useRef } from 'react';
import useSWRInfinite from 'swr/infinite';

import { getMarketplaceSkills } from '@/features/skills/skill-api';
import { useGatewayStore } from '@/stores/gateway-store';

type Page = Awaited<ReturnType<typeof getMarketplaceSkills>>;

export function useMarketplaceFeed(options: {
  enabled: boolean;
  provider: string | null;
  category: string;
  sort: 'downloads' | 'newest';
}) {
  const baseUrl = useGatewayStore((state) => state.baseUrl);
  const token = useGatewayStore((state) => state.conversationId);
  const getKey = (index: number, previous: Page | null) => {
    if (!options.enabled || !options.provider) return null;
    if (previous && (!previous.items.length || previous.meta.page >= previous.meta.totalPages)) return null;
    return ['skills-feed', baseUrl, token, options.provider, options.category, options.sort, index + 1] as const;
  };
  const { data, error, size, setSize, isValidating, mutate } = useSWRInfinite(
    getKey,
    ([, , , provider, category, sort, page]: NonNullable<ReturnType<typeof getKey>>) => getMarketplaceSkills({ provider, category, sort, page, pageSize: 20 }),
    { revalidateFirstPage: false, revalidateOnFocus: false, shouldRetryOnError: false, persistSize: false },
  );
  const pendingRef = useRef<{ scope: string; request: Promise<unknown> } | null>(null);
  const scope = JSON.stringify(getKey(0, null));
  const last = data?.at(-1);
  const items = [...new Map((data ?? []).flatMap((page) => page.items).map((item) => [item.id, item])).values()];
  const loading = options.enabled && !error && (isValidating || !data || size > data.length);
  const hasMore = Boolean(last?.items.length && last.meta.page < last.meta.totalPages);
  return {
    payload: last ? { ...last, items } : null,
    loading,
    error,
    hasMore,
    loadMore: () => {
      if (loading || error || !hasMore || pendingRef.current?.scope === scope) return;
      const request = setSize(size + 1);
      pendingRef.current = { scope, request };
      void request.finally(() => {
        if (pendingRef.current?.request === request) pendingRef.current = null;
      });
    },
    retry: () => { void mutate(); },
  };
}
