import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import useSWR from 'swr';
import { allProjectOptions } from './session-filter-projects';
import { useDebounce } from 'use-debounce';

import { listSessions } from './session-api';
import { buildDiscoveryQuery, hasSessionFilters, readSessionFilters, writeSessionFilters, type SessionFilters } from './session-discovery-state';

const PAGE_SIZE = 30;

export function useSessionDiscovery(gateway: string, token: string | undefined) {
  const [filters, setFilters] = useState(() => readSessionFilters(gateway));
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search, 250);
  const [pendingUpdate, setPendingUpdate] = useState(false);
  const active = hasSessionFilters(filters) || Boolean(search.trim());
  const { data: projects } = useSWR(active && token ? ['session-filter-projects', gateway] : null, allProjectOptions);
  const query = useMemo(() => buildDiscoveryQuery(filters, debouncedSearch), [filters, debouncedSearch]);
  const { data, error, isValidating, size, setSize, mutate } = useSWRInfinite(
    (page, previous) => !token || !active || (previous && !previous.hasMore) ? null
      : ['session-discovery', gateway, token, query, page] as const,
    ([, , , currentQuery, page]) => listSessions({ ...currentQuery, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    { revalidateOnFocus: false, revalidateOnReconnect: false, keepPreviousData: false },
  );
  const updateFilters = useCallback((next: SessionFilters) => {
    setFilters(next);
    writeSessionFilters(gateway, next);
  }, [gateway]);
  const refresh = useCallback(() => { setPendingUpdate(false); void mutate(); }, [mutate]);
  useEffect(() => {
    if (!active) return;
    const changed = () => setPendingUpdate(true);
    const events = ['session-list-refresh', 'session-created', 'session-updated', 'session-transcript-updated', 'project-updated'];
    events.forEach((name) => window.addEventListener(name, changed));
    return () => events.forEach((name) => window.removeEventListener(name, changed));
  }, [active]);
  const items = useMemo(() => [...new Map(data?.flatMap((page) => page.items).map((row) => [row.key, row]) ?? []).values()], [data]);
  return { projects, filters, updateFilters, search, setSearch, active, items, total: data?.[0]?.total ?? 0,
    loading: !error && (!data || search !== debouncedSearch), error,
    hasMore: data?.at(-1)?.hasMore ?? false, loadingMore: isValidating && Boolean(data),
    loadMore: () => void setSize(size + 1), refresh, pendingUpdate,
  };
}
