import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  getLogDir,
  getLogFiles,
  getLogModules,
  getLogStats,
  queryLogs,
} from '@/features/logs/log-api';
import type { LogEntry, LogFile, LogLevel } from '@/features/logs/log.types';
import type { LevelSegmentValue } from '@/features/logs/logs-page-lib';
import {
  isSameLogLevelSet,
  levelsForPreset,
  PAGE_LIMIT,
  parseLogLevelsParam,
  REFRESH_MS,
  segmentValueFromLevels,
} from '@/features/logs/logs-page-lib';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';
import { useGatewayStore } from '@/stores/gateway-store';

export function useLogsPage(language: StoredLanguage) {
  const L = messages(language).logs;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);
  const [searchParams, setSearchParams] = useSearchParams();

  const initialSearch = searchParams.get('q') ?? '';
  const initialLevels = parseLogLevelsParam(searchParams.get('level'));
  const initialModule = searchParams.get('module') ?? '';
  const initialFrom = searchParams.get('from') ?? '';
  const initialTo = searchParams.get('to') ?? '';
  const initialAutoRefresh = searchParams.get('live') === '1';

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const [searchInput, setSearchInput] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch.trim());
  const [selectedLevels, setSelectedLevels] = useState<Set<LogLevel>>(initialLevels);
  const [moduleFilter, setModuleFilter] = useState(initialModule);
  const [dateFrom, setDateFrom] = useState(initialFrom);
  const [dateTo, setDateTo] = useState(initialTo);

  const [modules, setModules] = useState<string[]>([]);
  const [files, setFiles] = useState<LogFile[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getLogStats>> | null>(null);

  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [logDir, setLogDir] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(initialAutoRefresh);
  const [copiedDetail, setCopiedDetail] = useState<'json' | 'message' | null>(null);

  const levelSegment = useMemo(() => segmentValueFromLevels(selectedLevels), [selectedLevels]);

  const handleLevelSegment = (value: LevelSegmentValue) => {
    if (value === 'other') {
      setFiltersOpen(true);
      return;
    }
    setSelectedLevels(levelsForPreset(value));
  };

  const hasActiveFilters =
    debouncedSearch.length > 0 ||
    selectedLevels.size > 0 ||
    Boolean(moduleFilter) ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const activeFilterCount =
    (debouncedSearch.length > 0 ? 1 : 0) +
    (selectedLevels.size > 0 ? 1 : 0) +
    (moduleFilter ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const nextQ = searchParams.get('q') ?? '';
    const nextModule = searchParams.get('module') ?? '';
    const nextFrom = searchParams.get('from') ?? '';
    const nextTo = searchParams.get('to') ?? '';
    const nextAutoRefresh = searchParams.get('live') === '1';
    const nextLevels = parseLogLevelsParam(searchParams.get('level'));
    const nextDebouncedQ = nextQ.trim();

    setSearchInput((prev) => (prev === nextQ ? prev : nextQ));
    setDebouncedSearch((prev) => (prev === nextDebouncedQ ? prev : nextDebouncedQ));
    setSelectedLevels((prev) => (isSameLogLevelSet(nextLevels, prev) ? prev : nextLevels));
    setModuleFilter((prev) => (prev === nextModule ? prev : nextModule));
    setDateFrom((prev) => (prev === nextFrom ? prev : nextFrom));
    setDateTo((prev) => (prev === nextTo ? prev : nextTo));
    setAutoRefresh((prev) => (prev === nextAutoRefresh ? prev : nextAutoRefresh));
  }, [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    const nextQ = debouncedSearch.trim();
    if (nextQ) params.set('q', nextQ);
    else params.delete('q');

    if (selectedLevels.size > 0) {
      params.set('level', Array.from(selectedLevels).sort().join(','));
    } else {
      params.delete('level');
    }

    if (moduleFilter) params.set('module', moduleFilter);
    else params.delete('module');
    if (dateFrom) params.set('from', dateFrom);
    else params.delete('from');
    if (dateTo) params.set('to', dateTo);
    else params.delete('to');
    if (autoRefresh) params.set('live', '1');
    else params.delete('live');

    const next = params.toString();
    if (next !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
  }, [
    autoRefresh,
    dateFrom,
    dateTo,
    debouncedSearch,
    moduleFilter,
    searchParams,
    selectedLevels,
    setSearchParams,
  ]);

  const queryParams = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      level: selectedLevels.size > 0 ? Array.from(selectedLevels) : undefined,
      module: moduleFilter || undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
      limit: PAGE_LIMIT,
    }),
    [debouncedSearch, selectedLevels, moduleFilter, dateFrom, dateTo],
  );

  useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setLogs([]);
      try {
        const result = await queryLogs({ ...queryParams, offset: 0 });
        if (cancelled) return;
        setLogs(result.logs);
        setHasMore(result.logs.length === PAGE_LIMIT);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : L.loadError);
          setLogs([]);
          setHasMore(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasToken, queryParams, L.loadError]);

  useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;
    (async () => {
      try {
        const [mods, st, fileList] = await Promise.all([getLogModules(), getLogStats(), getLogFiles()]);
        if (!cancelled) {
          setModules(mods);
          setStats(st);
          setFiles(fileList);
        }
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasToken]);

  useEffect(() => {
    if (!hasToken || !filesOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const [list, dir] = await Promise.all([getLogFiles(), getLogDir()]);
        if (!cancelled) {
          setFiles(list);
          setLogDir(dir);
        }
      } catch {
        if (!cancelled) setFiles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasToken, filesOpen]);

  useEffect(() => {
    if (!autoRefresh || !hasToken) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const result = await queryLogs({ ...queryParams, offset: 0 });
          setLogs(result.logs);
          setHasMore(result.logs.length === PAGE_LIMIT);
          const st = await getLogStats();
          setStats(st);
        } catch {
          /* ignore */
        }
      })();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, hasToken, queryParams]);

  useEffect(() => {
    if (!copiedDetail) return;
    const t = window.setTimeout(() => setCopiedDetail(null), 2000);
    return () => clearTimeout(t);
  }, [copiedDetail]);

  const clearFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setSelectedLevels(new Set());
    setModuleFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const toggleDialogLevel = (level: LogLevel) => {
    setSelectedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  const handleLoadMore = () => {
    if (loading || !hasMore) return;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await queryLogs({ ...queryParams, offset: logs.length });
        setLogs((prev) => [...prev, ...result.logs]);
        setHasMore(result.logs.length === PAGE_LIMIT);
      } catch (e) {
        setError(e instanceof Error ? e.message : L.loadError);
      } finally {
        setLoading(false);
      }
    })();
  };

  const refreshAll = () => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await queryLogs({ ...queryParams, offset: 0 });
        setLogs(result.logs);
        setHasMore(result.logs.length === PAGE_LIMIT);
        const [st, fileList] = await Promise.all([getLogStats(), getLogFiles()]);
        setStats(st);
        setFiles(fileList);
      } catch (e) {
        setError(e instanceof Error ? e.message : L.loadError);
      } finally {
        setLoading(false);
      }
    })();
  };

  return {
    L,
    hasToken,
    logs,
    loading,
    error,
    hasMore,
    searchInput,
    setSearchInput,
    selectedLevels,
    setSelectedLevels,
    moduleFilter,
    setModuleFilter,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    modules,
    files,
    stats,
    selectedLog,
    setSelectedLog,
    filesOpen,
    setFilesOpen,
    filtersOpen,
    setFiltersOpen,
    logDir,
    autoRefresh,
    setAutoRefresh,
    copiedDetail,
    setCopiedDetail,
    hasActiveFilters,
    activeFilterCount,
    clearFilters,
    toggleDialogLevel,
    handleLoadMore,
    refreshAll,
    levelSegment,
    handleLevelSegment,
  };
}
