import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  getLogDir,
  getLogErrorSummary,
  getLogFiles,
  getLogModules,
  getLogStats,
  queryLogs,
} from '@/features/logs/log-api';
import { LogStreamConnection, prependLiveLog } from '@/features/logs/log-stream-connection';
import type { LogEntry, LogFile, LogLevel, LogErrorSummaryItem } from '@/features/logs/log.types';
import { resolveSession } from '@/features/sessions/session-api';
import type { LevelSegmentValue } from '@/features/logs/logs-page-lib';
import {
  isSameLogLevelSet,
  levelsForPreset,
  logMatchesClientFilters,
  PAGE_LIMIT,
  parseLogLevelsParam,
  segmentValueFromLevels,
  sortLogsByTimeDesc,
} from '@/features/logs/logs-page-lib';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';
import { useGatewayStore } from '@/stores/gateway-store';

type Stats = Awaited<ReturnType<typeof getLogStats>>;

type Filters = {
  searchInput: string;
  debouncedSearch: string;
  selectedLevels: Set<LogLevel>;
  moduleFilter: string;
  requestIdFilter: string;
  sessionIdFilter: string;
  dateFrom: string;
  dateTo: string;
  autoRefresh: boolean;
};

type FiltersAction =
  | { type: 'setSearchInput'; value: string }
  | { type: 'setDebouncedSearch'; value: string }
  | { type: 'setLevels'; value: Set<LogLevel> }
  | { type: 'toggleLevel'; level: LogLevel }
  | { type: 'setModule'; value: string }
  | { type: 'setRequestIdFilter'; value: string }
  | { type: 'setSessionIdFilter'; value: string }
  | { type: 'setDateFrom'; value: string }
  | { type: 'setDateTo'; value: string }
  | { type: 'setAutoRefresh'; value: boolean }
  | { type: 'syncFromUrl'; payload: Omit<Filters, 'debouncedSearch'> & { debouncedSearch: string } }
  | { type: 'clearAll' };

function filtersReducer(state: Filters, action: FiltersAction): Filters {
  switch (action.type) {
    case 'setSearchInput':
      return state.searchInput === action.value ? state : { ...state, searchInput: action.value };
    case 'setDebouncedSearch':
      return state.debouncedSearch === action.value ? state : { ...state, debouncedSearch: action.value };
    case 'setLevels':
      return isSameLogLevelSet(state.selectedLevels, action.value) ? state : { ...state, selectedLevels: action.value };
    case 'toggleLevel': {
      const next = new Set(state.selectedLevels);
      if (next.has(action.level)) next.delete(action.level);
      else next.add(action.level);
      return { ...state, selectedLevels: next };
    }
    case 'setModule':
      return state.moduleFilter === action.value ? state : { ...state, moduleFilter: action.value };
    case 'setRequestIdFilter':
      return state.requestIdFilter === action.value ? state : { ...state, requestIdFilter: action.value };
    case 'setSessionIdFilter':
      return state.sessionIdFilter === action.value ? state : { ...state, sessionIdFilter: action.value };
    case 'setDateFrom':
      return state.dateFrom === action.value ? state : { ...state, dateFrom: action.value };
    case 'setDateTo':
      return state.dateTo === action.value ? state : { ...state, dateTo: action.value };
    case 'setAutoRefresh':
      return state.autoRefresh === action.value ? state : { ...state, autoRefresh: action.value };
    case 'syncFromUrl': {
      const p = action.payload;
      const same =
        state.searchInput === p.searchInput &&
        state.debouncedSearch === p.debouncedSearch &&
        isSameLogLevelSet(state.selectedLevels, p.selectedLevels) &&
        state.moduleFilter === p.moduleFilter &&
        state.requestIdFilter === p.requestIdFilter &&
        state.sessionIdFilter === p.sessionIdFilter &&
        state.dateFrom === p.dateFrom &&
        state.dateTo === p.dateTo &&
        state.autoRefresh === p.autoRefresh;
      return same ? state : { ...state, ...p };
    }
    case 'clearAll':
      return {
        searchInput: '',
        debouncedSearch: '',
        selectedLevels: new Set(),
        moduleFilter: '',
        requestIdFilter: '',
        sessionIdFilter: '',
        dateFrom: '',
        dateTo: '',
        autoRefresh: state.autoRefresh,
      };
  }
}

type Data = {
  logs: LogEntry[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  modules: string[];
  files: LogFile[];
  stats: Stats | null;
  logDir: string | null;
};

type DataAction =
  | { type: 'queryStart' }
  | { type: 'querySuccess'; logs: LogEntry[]; hasMore: boolean }
  | { type: 'queryError'; message: string; resetLogs?: boolean }
  | { type: 'appendSuccess'; logs: LogEntry[]; hasMore: boolean }
  | { type: 'metaSuccess'; modules: string[]; stats: Stats; files: LogFile[] }
  | { type: 'filesSuccess'; files: LogFile[]; logDir: string | null }
  | { type: 'filesClear' }
  | { type: 'liveTick'; logs: LogEntry[]; hasMore: boolean; stats: Stats }
  | { type: 'appendLiveEntry'; entry: LogEntry }
  | { type: 'updateStats'; stats: Stats }
  | { type: 'refreshAllSuccess'; logs: LogEntry[]; hasMore: boolean; stats: Stats; files: LogFile[] };

const initialData: Data = {
  logs: [],
  loading: false,
  error: null,
  hasMore: false,
  modules: [],
  files: [],
  stats: null,
  logDir: null,
};

function dataReducer(state: Data, action: DataAction): Data {
  switch (action.type) {
    case 'queryStart':
      return { ...state, loading: true, error: null, logs: [] };
    case 'querySuccess':
      return { ...state, loading: false, logs: sortLogsByTimeDesc(action.logs), hasMore: action.hasMore };
    case 'queryError':
      return action.resetLogs
        ? { ...state, loading: false, error: action.message, logs: [], hasMore: false }
        : { ...state, loading: false, error: action.message };
    case 'appendSuccess':
      return {
        ...state,
        loading: false,
        logs: sortLogsByTimeDesc([...state.logs, ...action.logs]),
        hasMore: action.hasMore,
      };
    case 'metaSuccess':
      return { ...state, modules: action.modules, stats: action.stats, files: action.files };
    case 'filesSuccess':
      return { ...state, files: action.files, logDir: action.logDir };
    case 'filesClear':
      return { ...state, files: [] };
    case 'liveTick':
      return {
        ...state,
        logs: sortLogsByTimeDesc(action.logs),
        hasMore: action.hasMore,
        stats: action.stats,
      };
    case 'appendLiveEntry':
      return {
        ...state,
        logs: sortLogsByTimeDesc(prependLiveLog(state.logs, action.entry)),
      };
    case 'updateStats':
      return { ...state, stats: action.stats };
    case 'refreshAllSuccess':
      return {
        ...state,
        loading: false,
        logs: sortLogsByTimeDesc(action.logs),
        hasMore: action.hasMore,
        stats: action.stats,
        files: action.files,
      };
  }
}

export function useLogsPage(language: StoredLanguage) {
  const L = messages(language).logs;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);
  const [searchParams, setSearchParams] = useSearchParams();

  const searchParamsInitRef = useRef(searchParams);
  const [filters, dispatchFilters] = useReducer(filtersReducer, undefined as never, (): Filters => {
    const sp = searchParamsInitRef.current;
    const initialSearch = sp.get('q') ?? '';
    return {
      searchInput: initialSearch,
      debouncedSearch: initialSearch.trim(),
      selectedLevels: parseLogLevelsParam(sp.get('level')),
      moduleFilter: sp.get('module') ?? '',
      requestIdFilter: sp.get('requestId') ?? '',
      sessionIdFilter: sp.get('sessionId') ?? '',
      dateFrom: sp.get('from') ?? '',
      dateTo: sp.get('to') ?? '',
      autoRefresh: sp.get('live') === '1',
    };
  });
  const [data, dispatchData] = useReducer(dataReducer, initialData);

  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [copiedDetail, setCopiedDetail] = useState<'json' | 'message' | null>(null);
  const [errorSummary, setErrorSummary] = useState<LogErrorSummaryItem[]>([]);
  const [errorSummaryLoading, setErrorSummaryLoading] = useState(false);

  const { searchInput, debouncedSearch, selectedLevels, moduleFilter, requestIdFilter, sessionIdFilter, dateFrom, dateTo, autoRefresh } = filters;
  const { logs, loading, error, hasMore, modules, files, stats, logDir } = data;

  const setSearchInput = useCallback((value: string) => dispatchFilters({ type: 'setSearchInput', value }), []);
  const setSelectedLevels = useCallback(
    (value: Set<LogLevel>) => dispatchFilters({ type: 'setLevels', value }),
    [],
  );
  const setModuleFilter = useCallback((value: string) => dispatchFilters({ type: 'setModule', value }), []);
  const setRequestIdFilter = useCallback(
    (value: string) => dispatchFilters({ type: 'setRequestIdFilter', value }),
    [],
  );
  const setSessionIdFilter = useCallback(
    (value: string) => dispatchFilters({ type: 'setSessionIdFilter', value }),
    [],
  );
  const setDateFrom = useCallback((value: string) => dispatchFilters({ type: 'setDateFrom', value }), []);
  const setDateTo = useCallback((value: string) => dispatchFilters({ type: 'setDateTo', value }), []);
  const setAutoRefresh = useCallback((value: boolean) => dispatchFilters({ type: 'setAutoRefresh', value }), []);

  const levelSegment = useMemo(() => segmentValueFromLevels(selectedLevels), [selectedLevels]);

  const handleLevelSegment = (value: LevelSegmentValue) => {
    if (value === 'other') {
      setFiltersOpen(true);
      return;
    }
    dispatchFilters({ type: 'setLevels', value: levelsForPreset(value) });
  };

  const hasActiveFilters =
    debouncedSearch.length > 0 ||
    selectedLevels.size > 0 ||
    Boolean(moduleFilter) ||
    Boolean(requestIdFilter) ||
    Boolean(sessionIdFilter) ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const activeFilterCount =
    (debouncedSearch.length > 0 ? 1 : 0) +
    (selectedLevels.size > 0 ? 1 : 0) +
    (moduleFilter ? 1 : 0) +
    (requestIdFilter ? 1 : 0) +
    (sessionIdFilter ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0);

  useEffect(() => {
    const t = setTimeout(() => dispatchFilters({ type: 'setDebouncedSearch', value: searchInput.trim() }), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const nextQ = searchParams.get('q') ?? '';
    dispatchFilters({
      type: 'syncFromUrl',
      payload: {
        searchInput: nextQ,
        debouncedSearch: nextQ.trim(),
        selectedLevels: parseLogLevelsParam(searchParams.get('level')),
        moduleFilter: searchParams.get('module') ?? '',
        requestIdFilter: searchParams.get('requestId') ?? '',
        sessionIdFilter: searchParams.get('sessionId') ?? '',
        dateFrom: searchParams.get('from') ?? '',
        dateTo: searchParams.get('to') ?? '',
        autoRefresh: searchParams.get('live') === '1',
      },
    });
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
    if (requestIdFilter) params.set('requestId', requestIdFilter);
    else params.delete('requestId');
    if (sessionIdFilter) params.set('sessionId', sessionIdFilter);
    else params.delete('sessionId');
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
    requestIdFilter,
    sessionIdFilter,
    searchParams,
    selectedLevels,
    setSearchParams,
  ]);

  const queryParams = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      level: selectedLevels.size > 0 ? Array.from(selectedLevels) : undefined,
      module: moduleFilter || undefined,
      requestId: requestIdFilter || undefined,
      sessionId: sessionIdFilter || undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
      limit: PAGE_LIMIT,
    }),
    [debouncedSearch, selectedLevels, moduleFilter, requestIdFilter, sessionIdFilter, dateFrom, dateTo],
  );

  const clientFilterSnapshot = useMemo(
    () => ({
      debouncedSearch,
      selectedLevels,
      moduleFilter,
      requestIdFilter,
      sessionIdFilter,
      dateFrom,
      dateTo,
    }),
    [debouncedSearch, selectedLevels, moduleFilter, requestIdFilter, sessionIdFilter, dateFrom, dateTo],
  );
  const clientFilterRef = useRef(clientFilterSnapshot);
  clientFilterRef.current = clientFilterSnapshot;

  useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;
    setErrorSummaryLoading(true);
    void getLogErrorSummary({
      from: dateFrom || undefined,
      to: dateTo || undefined,
      limit: 12,
    })
      .then((items) => {
        if (!cancelled) setErrorSummary(items);
      })
      .catch(() => {
        if (!cancelled) setErrorSummary([]);
      })
      .finally(() => {
        if (!cancelled) setErrorSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasToken, dateFrom, dateTo]);

  useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;
    dispatchData({ type: 'queryStart' });
    void (async () => {
      try {
        const result = await queryLogs({ ...queryParams, offset: 0 });
        if (cancelled) return;
        dispatchData({ type: 'querySuccess', logs: result.logs, hasMore: result.logs.length === PAGE_LIMIT });
      } catch (e) {
        if (!cancelled) {
          dispatchData({
            type: 'queryError',
            message: e instanceof Error ? e.message : L.loadError,
            resetLogs: true,
          });
        }
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
        if (!cancelled) dispatchData({ type: 'metaSuccess', modules: mods, stats: st, files: fileList });
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
        if (!cancelled) dispatchData({ type: 'filesSuccess', files: list, logDir: dir });
      } catch {
        if (!cancelled) dispatchData({ type: 'filesClear' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasToken, filesOpen]);

  useEffect(() => {
    if (!autoRefresh || !hasToken) return;

    const connection = new LogStreamConnection(token ?? undefined, {
      onConnected: () => {},
      onEntry: (entry) => {
        if (!logMatchesClientFilters(entry, clientFilterRef.current)) return;
        dispatchData({ type: 'appendLiveEntry', entry });
      },
      onError: () => {},
    });

    connection.connect(
      selectedLevels.size > 0 ? Array.from(selectedLevels) : undefined,
      moduleFilter || undefined,
    );

    const statsInterval = window.setInterval(() => {
      void getLogStats()
        .then((st) => {
          dispatchData({ type: 'updateStats', stats: st });
        })
        .catch(() => {});
    }, 30_000);

    return () => {
      connection.disconnect();
      clearInterval(statsInterval);
    };
  }, [autoRefresh, hasToken, token, selectedLevels, moduleFilter]);

  useEffect(() => {
    if (!copiedDetail) return;
    const t = window.setTimeout(() => setCopiedDetail(null), 2000);
    return () => clearTimeout(t);
  }, [copiedDetail]);

  const clearFilters = () => dispatchFilters({ type: 'clearAll' });
  const toggleDialogLevel = (level: LogLevel) => dispatchFilters({ type: 'toggleLevel', level });

  const handleLoadMore = () => {
    if (loading || !hasMore) return;
    void (async () => {
      dispatchData({ type: 'queryStart' });
      try {
        const result = await queryLogs({ ...queryParams, offset: logs.length });
        dispatchData({ type: 'appendSuccess', logs: result.logs, hasMore: result.logs.length === PAGE_LIMIT });
      } catch (e) {
        dispatchData({ type: 'queryError', message: e instanceof Error ? e.message : L.loadError });
      }
    })();
  };

  const refreshAll = () => {
    void (async () => {
      dispatchData({ type: 'queryStart' });
      try {
        const result = await queryLogs({ ...queryParams, offset: 0 });
        const [st, fileList] = await Promise.all([getLogStats(), getLogFiles()]);
        dispatchData({
          type: 'refreshAllSuccess',
          logs: result.logs,
          hasMore: result.logs.length === PAGE_LIMIT,
          stats: st,
          files: fileList,
        });
      } catch (e) {
        dispatchData({ type: 'queryError', message: e instanceof Error ? e.message : L.loadError });
      }
    })();
  };

  const filterByRequestId = useCallback(
    (requestId: string) => {
      setSelectedLog(null);
      setRequestIdFilter(requestId);
    },
    [setRequestIdFilter],
  );

  const filterBySessionId = useCallback(
    (sessionId: string) => {
      setSelectedLog(null);
      setSessionIdFilter(sessionId);
    },
    [setSessionIdFilter],
  );

  const filterByErrorSummary = useCallback((item: LogErrorSummaryItem) => {
    dispatchFilters({ type: 'setSearchInput', value: item.errName });
    dispatchFilters({ type: 'setDebouncedSearch', value: item.errName });
    if (item.module) dispatchFilters({ type: 'setModule', value: item.module });
    dispatchFilters({ type: 'setLevels', value: levelsForPreset('errors') });
  }, []);

  const openChatForSession = useCallback((target: { sessionKey?: string; sessionId?: string }) => {
    const directKey = target.sessionKey?.trim();
    if (directKey) {
      window.dispatchEvent(new CustomEvent('navigate-to-chat', { detail: { sessionKey: directKey } }));
      return;
    }
    const sessionId = target.sessionId?.trim();
    if (!sessionId) return;
    void resolveSession({ sessionId })
      .then((resolved) => {
        window.dispatchEvent(
          new CustomEvent('navigate-to-chat', { detail: { sessionKey: resolved.sessionKey } }),
        );
      })
      .catch(() => {});
  }, []);

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
    requestIdFilter,
    sessionIdFilter,
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
    filterByRequestId,
    filterBySessionId,
    filterByErrorSummary,
    openChatForSession,
    errorSummary,
    errorSummaryLoading,
  };
}
