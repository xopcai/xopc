import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import {
  ChevronDown,
  ClipboardCopy,
  FileText,
  Folder,
  ListFilter,
  RefreshCw,
  Search,
  Terminal,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { SlidingSegmented } from '@/components/ui/sliding-segmented';
import { Button } from '@/components/ui/button';
import { bareInputFocusClass, selectControlBaseClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import {
  getLogDir,
  getLogFiles,
  getLogModules,
  getLogStats,
  queryLogs,
} from '@/features/logs/log-api';
import type { LogEntry, LogFile, LogLevel } from '@/features/logs/log.types';
import { LOG_LEVELS } from '@/features/logs/log.types';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const PAGE_LIMIT = 50;
const REFRESH_MS = 5000;
const LOG_LEVEL_SET = new Set<LogLevel>(LOG_LEVELS);

type LevelPreset = 'all' | 'errors' | 'warnPlus' | 'infoPlus' | 'verbose' | 'custom';
type LevelSegmentValue = Exclude<LevelPreset, 'custom'> | 'other';

const PRESET_ERRORS: LogLevel[] = ['error', 'fatal'];
const PRESET_WARN_PLUS: LogLevel[] = ['warn', 'error', 'fatal'];
const PRESET_INFO_PLUS: LogLevel[] = ['info', 'warn', 'error', 'fatal'];

function parseLogLevelsParam(raw: string | null): Set<LogLevel> {
  if (!raw) return new Set<LogLevel>();
  const out = new Set<LogLevel>();
  for (const part of raw.split(',')) {
    const level = part.trim() as LogLevel;
    if (LOG_LEVEL_SET.has(level)) out.add(level);
  }
  return out;
}

function isSameLogLevelSet(a: Set<LogLevel>, b: Set<LogLevel>): boolean {
  if (a.size !== b.size) return false;
  for (const level of a) {
    if (!b.has(level)) return false;
  }
  return true;
}

function setMatchesLevels(s: Set<LogLevel>, levels: readonly LogLevel[]): boolean {
  if (s.size !== levels.length) return false;
  return levels.every((l) => s.has(l));
}

function derivePreset(levels: Set<LogLevel>): LevelPreset {
  if (levels.size === 0) return 'all';
  if (setMatchesLevels(levels, PRESET_ERRORS)) return 'errors';
  if (setMatchesLevels(levels, PRESET_WARN_PLUS)) return 'warnPlus';
  if (setMatchesLevels(levels, PRESET_INFO_PLUS)) return 'infoPlus';
  if (levels.size === LOG_LEVELS.length && LOG_LEVELS.every((l) => levels.has(l))) return 'verbose';
  return 'custom';
}

function segmentValueFromLevels(levels: Set<LogLevel>): LevelSegmentValue {
  const p = derivePreset(levels);
  return p === 'custom' ? 'other' : p;
}

function levelsForPreset(preset: Exclude<LevelPreset, 'custom'>): Set<LogLevel> {
  switch (preset) {
    case 'all':
      return new Set();
    case 'errors':
      return new Set(PRESET_ERRORS);
    case 'warnPlus':
      return new Set(PRESET_WARN_PLUS);
    case 'infoPlus':
      return new Set(PRESET_INFO_PLUS);
    case 'verbose':
      return new Set(LOG_LEVELS);
  }
}

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

function moduleLabel(log: LogEntry): string {
  return String(log.module || log.prefix || log.service || log.extension || '—');
}

function messagePreview(log: LogEntry): string {
  if (typeof log.message === 'string' && log.message) return log.message;
  try {
    return JSON.stringify(log);
  } catch {
    return '';
  }
}

function formatTimeCompact(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return timestamp;
  }
}

function formatTimestampFull(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return timestamp;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function requestIdPreview(id: string): string {
  const t = id.trim();
  if (t.length <= 10) return t;
  return `${t.slice(0, 8)}…`;
}

function levelLabel(level: string): string {
  return String(level).toLowerCase();
}

function formatStatsLine(
  byLevel: Partial<Record<LogLevel | 'silent', number>>,
  labels: Record<LogLevel, string>,
): string {
  const parts: string[] = [];
  for (const lv of LOG_LEVELS) {
    const n = byLevel[lv] ?? 0;
    if (n > 0) parts.push(`${labels[lv]} ${n}`);
  }
  return parts.join(' · ');
}

export function LogsPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const L = m.logs;
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

  const handleLevelSegment = (value: LevelSegmentValue) => {
    if (value === 'other') {
      setFiltersOpen(true);
      return;
    }
    setSelectedLevels(levelsForPreset(value));
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

  const statsLine = stats ? formatStatsLine(stats.byLevel ?? {}, L.levelNames) : '';

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-10">
        <div className="flex items-start gap-3 rounded-2xl border border-edge-subtle bg-surface-base p-6 dark:border-edge">
          <Terminal className="mt-0.5 size-5 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden />
          <div>
            <h1 className="text-base font-semibold tracking-tight text-fg">{L.title}</h1>
            <p className="mt-1 text-sm leading-relaxed text-fg-muted">{L.needToken}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-edge-subtle bg-surface-base dark:border-edge"
            aria-hidden
          >
            <Terminal className="size-5 text-fg-muted" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-fg">{L.title}</h1>
            <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">{L.subtitle}</p>
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:max-w-md sm:flex-row sm:items-center sm:justify-end">
          <div className="w-full sm:w-48">
            <SlidingSegmented
              aria-label={L.refreshModeAria}
              value={autoRefresh ? 'live' : 'paused'}
              onChange={(v) => setAutoRefresh(v === 'live')}
              options={[
                { value: 'paused', label: L.refreshManual },
                { value: 'live', label: L.refreshLive },
              ]}
              buttonClassName="h-8"
            />
          </div>
          <div className="flex items-center gap-1 self-end sm:self-center">
            <Button
              type="button"
              variant="ghost"
              className="h-9 min-h-[44px] min-w-[44px] px-2 sm:min-h-9 sm:min-w-0"
              title={L.logFiles}
              aria-label={L.logFiles}
              onClick={() => setFilesOpen(true)}
            >
              <Folder className="size-4" strokeWidth={1.75} />
              {files.length > 0 ? (
                <span className="rounded-full bg-surface-hover px-1.5 text-xs text-fg-muted">{files.length}</span>
              ) : null}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-9 min-h-[44px] min-w-[44px] px-2 sm:min-h-9 sm:min-w-0"
              title={L.refresh}
              aria-label={L.refresh}
              onClick={refreshAll}
            >
              <RefreshCw
                className={cn(
                  'size-4 transition-transform duration-150 ease-out motion-reduce:transition-none',
                  loading && 'animate-spin motion-reduce:animate-none',
                )}
                strokeWidth={1.75}
              />
            </Button>
          </div>
        </div>
      </header>

      {error ? (
        <div
          className="rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg dark:border-edge"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {stats && statsLine ? (
        <div className="flex flex-wrap items-center gap-2">
          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                type="button"
                className="max-w-full truncate rounded-lg border border-transparent px-1 py-0.5 text-left text-xs leading-5 text-fg-subtle transition-colors duration-150 ease-out hover:border-edge-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel dark:hover:border-edge"
              >
                <span className="font-medium text-fg-muted">{L.statsRegion}</span>
                <span className="mx-1.5 text-fg-subtle">·</span>
                <span className="tabular-nums">{statsLine}</span>
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="start"
                sideOffset={6}
                className={cn(
                  'z-50 w-[min(calc(100vw-2rem),20rem)] rounded-xl border border-edge bg-surface-panel p-3 shadow-popover outline-none',
                  'dark:border-edge',
                )}
              >
                <p className="text-xs font-medium text-fg">{L.statsDetailTitle}</p>
                <p className="mt-1 text-xs leading-5 text-fg-muted">{L.statsHint}</p>
                <ul className="mt-3 flex flex-col gap-1.5" role="list">
                  {LOG_LEVELS.map((lv) => {
                    const n = stats.byLevel?.[lv] ?? 0;
                    if (n === 0) return null;
                    return (
                      <li
                        key={lv}
                        className="flex items-center justify-between gap-2 rounded-md border border-edge-subtle bg-surface-base px-2 py-1 text-xs dark:border-edge"
                      >
                        <span className="font-medium capitalize text-fg">{L.levelNames[lv]}</span>
                        <span className="tabular-nums text-fg-muted">{n}</span>
                      </li>
                    );
                  })}
                </ul>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      ) : null}

      <section className="flex flex-col gap-3" aria-label={L.filters}>
        <div className="overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="min-w-[min(100%,36rem)]">
            <SlidingSegmented<LevelSegmentValue>
              aria-label={L.levelPresetAria}
              value={levelSegment}
              onChange={handleLevelSegment}
              options={[
                { value: 'all', label: L.presetAll },
                { value: 'errors', label: L.presetErrors },
                { value: 'warnPlus', label: L.presetWarnPlus },
                { value: 'infoPlus', label: L.presetInfoPlus },
                { value: 'verbose', label: L.presetVerbose },
                { value: 'other', label: L.presetOther },
              ]}
              buttonClassName="h-8 px-1.5 text-[11px] sm:px-2 sm:text-xs"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="relative min-w-0 flex-1 sm:min-w-[12rem]">
            <span className="sr-only">{L.searchPlaceholder}</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
              strokeWidth={1.75}
              aria-hidden
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={L.searchPlaceholder}
              autoComplete="off"
              spellCheck={false}
              className={cn(
                'h-10 w-full rounded-md border border-edge bg-surface-panel py-0 pl-10 pr-3 text-sm leading-5 text-fg placeholder:text-fg-subtle dark:border-edge',
                bareInputFocusClass,
              )}
            />
          </label>

          <select
            id="log-module"
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            aria-label={L.module}
            title={L.module}
            className={cn(
              selectControlBaseClass,
              'h-10 w-full min-w-0 rounded-md py-0 sm:w-[min(100%,14rem)] sm:shrink-0',
            )}
          >
            <option value="">{L.allModules}</option>
            {modules.map((mod) => (
              <option key={mod} value={mod}>
                {mod}
              </option>
            ))}
          </select>

          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-10 min-h-[44px] gap-2 rounded-md sm:min-h-10"
              onClick={() => setFiltersOpen(true)}
            >
              <ListFilter className="size-4" strokeWidth={1.75} />
              {L.filtersMore}
              {activeFilterCount > 0 ? (
                <span className="rounded-md bg-surface-hover px-1.5 text-xs tabular-nums text-fg-muted">
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>
            {hasActiveFilters ? (
              <Button type="button" variant="ghost" className="h-10 min-h-[44px] gap-1 sm:min-h-10" onClick={clearFilters}>
                <X className="size-4" strokeWidth={1.75} />
                {L.clear}
              </Button>
            ) : null}
          </div>
        </div>

        {autoRefresh ? <p className="text-xs leading-5 text-fg-subtle">{L.liveHint}</p> : null}
      </section>

      {loading && logs.length === 0 ? (
        <div
          className="divide-y divide-edge-subtle overflow-hidden rounded-xl border border-edge bg-surface-panel dark:divide-edge dark:border-edge"
          aria-busy="true"
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-3 px-3 py-2.5">
              <div className="h-4 w-16 shrink-0 bg-surface-hover motion-reduce:animate-none animate-pulse" />
              <div className="h-4 w-12 shrink-0 bg-surface-hover motion-reduce:animate-none animate-pulse" />
              <div className="h-4 w-20 shrink-0 bg-surface-hover motion-reduce:animate-none animate-pulse" />
              <div className="h-4 min-w-0 flex-1 bg-surface-hover motion-reduce:animate-none animate-pulse" />
            </div>
          ))}
        </div>
      ) : null}

      {!loading && logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-edge-subtle bg-surface-base py-16 text-center dark:border-edge">
          <FileText className="size-12 text-fg-subtle" strokeWidth={1.5} aria-hidden />
          <h2 className="text-base font-semibold tracking-tight text-fg">{L.noLogs}</h2>
          <p className="max-w-sm text-sm leading-relaxed text-fg-muted">{L.noLogsDescription}</p>
          <Button type="button" variant="secondary" className="mt-4 gap-2" onClick={refreshAll}>
            <RefreshCw className="size-4" strokeWidth={1.75} />
            {L.refresh}
          </Button>
        </div>
      ) : null}

      {logs.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs leading-5 text-fg-muted">
            {interpolate(L.showingCount, { count: String(logs.length) })}
            {hasMore ? <span className="text-fg-subtle"> · {L.moreAvailable}</span> : null}
          </p>
          <ul
            className="divide-y divide-edge-subtle overflow-hidden rounded-xl border border-edge bg-surface-panel font-mono text-sm leading-6 dark:divide-edge dark:border-edge"
            role="list"
          >
            {logs.map((log, idx) => {
              const lv = log.level ?? 'info';
              const rid = typeof log.requestId === 'string' ? log.requestId.trim() : '';
              return (
                <li key={`${log.timestamp}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => setSelectedLog(log)}
                    className={cn(
                      'flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 ease-out',
                      'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
                    )}
                  >
                    <span className="w-[5.25rem] shrink-0 tabular-nums text-fg-subtle">
                      {formatTimeCompact(log.timestamp)}
                    </span>
                    <span className="w-[4.5rem] shrink-0 truncate text-fg-muted" title={lv}>
                      {levelLabel(lv)}
                    </span>
                    <span
                      className="w-[4.5rem] shrink-0 truncate text-fg-subtle sm:w-[5.25rem]"
                      title={rid ? `${L.requestId}: ${rid}` : undefined}
                    >
                      {rid ? requestIdPreview(rid) : '—'}
                    </span>
                    <span
                      className="hidden max-w-[7rem] shrink-0 truncate text-fg-muted lg:inline"
                      title={moduleLabel(log)}
                    >
                      {moduleLabel(log)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-fg">{messagePreview(log)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {hasMore ? (
            <div className="flex justify-center pt-1">
              <Button
                type="button"
                variant="secondary"
                className="gap-2"
                disabled={loading}
                onClick={handleLoadMore}
              >
                {loading ? (
                  <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} />
                ) : (
                  <ChevronDown className="size-4" strokeWidth={1.75} />
                )}
                {L.loadMore}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <Dialog.Root open={filtersOpen} onOpenChange={setFiltersOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-50 bg-scrim" />
          <Dialog.Content
            className={cn(
              'xopc-dialog-content fixed left-1/2 top-1/2 z-50 flex max-h-[min(32rem,90vh)] w-[min(100%-2rem,22rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-edge bg-surface-panel shadow-popover outline-none',
              'dark:border-edge',
            )}
            aria-describedby="log-filters-desc"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3 dark:border-edge">
              <Dialog.Title className="text-base font-semibold tracking-tight text-fg">{L.filtersDialogTitle}</Dialog.Title>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="h-9 w-9 shrink-0 p-0" aria-label={L.close}>
                  <X className="size-5" strokeWidth={1.75} />
                </Button>
              </Dialog.Close>
            </div>
            <div id="log-filters-desc" className="sr-only">
              {L.filtersDialogDesc}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <p className="text-xs font-medium text-fg-muted">{L.timeRange}</p>
              <div className="mt-2 flex flex-col gap-3">
                <div>
                  <label htmlFor="log-from-d" className="mb-1 block text-xs text-fg-muted">
                    {L.from}
                  </label>
                  <input
                    id="log-from-d"
                    type="datetime-local"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full rounded-xl border border-edge bg-surface-base px-2 py-2 text-sm text-fg dark:border-edge"
                  />
                </div>
                <div>
                  <label htmlFor="log-to-d" className="mb-1 block text-xs text-fg-muted">
                    {L.to}
                  </label>
                  <input
                    id="log-to-d"
                    type="datetime-local"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full rounded-xl border border-edge bg-surface-base px-2 py-2 text-sm text-fg dark:border-edge"
                  />
                </div>
              </div>
              <p className="mt-6 text-xs font-medium text-fg-muted">{L.levelCustom}</p>
              <p className="mt-1 text-xs leading-5 text-fg-subtle">{L.levelCustomHint}</p>
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={L.level}>
                {LOG_LEVELS.map((level) => {
                  const active = selectedLevels.has(level);
                  return (
                    <button
                      key={level}
                      type="button"
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-[color,background-color,border-color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
                        active
                          ? 'border-edge bg-surface-active text-fg dark:border-edge'
                          : 'border-edge-subtle bg-surface-base text-fg-muted hover:bg-surface-hover dark:border-edge',
                      )}
                      onClick={() => toggleDialogLevel(level)}
                    >
                      {L.levelNames[level]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="shrink-0 border-t border-edge-subtle px-4 py-3 dark:border-edge">
              <Button type="button" className="w-full rounded-xl" onClick={() => setFiltersOpen(false)}>
                {L.filtersDone}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={selectedLog !== null} onOpenChange={(o) => !o && setSelectedLog(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-50 bg-scrim" />
          <Dialog.Content
            className={cn(
              'xopc-drawer-right fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-edge bg-surface-panel shadow-popover outline-none',
              'dark:border-edge',
            )}
            aria-describedby={undefined}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3 dark:border-edge">
              <Dialog.Title className="text-base font-semibold tracking-tight text-fg">{L.details}</Dialog.Title>
              <div className="flex min-w-0 items-center gap-1">
                {selectedLog ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 shrink-0 gap-1 px-2 text-xs"
                      onClick={() => {
                        const text = typeof selectedLog.message === 'string' ? selectedLog.message : '';
                        void navigator.clipboard.writeText(text).then(() => setCopiedDetail('message'));
                      }}
                    >
                      <ClipboardCopy className="size-3.5 shrink-0" strokeWidth={1.75} />
                      <span className="hidden sm:inline">{copiedDetail === 'message' ? L.copied : L.copyMessage}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 shrink-0 gap-1 px-2 text-xs"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(JSON.stringify(selectedLog, null, 2))
                          .then(() => setCopiedDetail('json'));
                      }}
                    >
                      <ClipboardCopy className="size-3.5 shrink-0" strokeWidth={1.75} />
                      <span className="hidden sm:inline">{copiedDetail === 'json' ? L.copied : L.copyJson}</span>
                    </Button>
                  </>
                ) : null}
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" className="h-9 w-9 shrink-0 p-0" aria-label={L.close}>
                    <X className="size-5" strokeWidth={1.75} />
                  </Button>
                </Dialog.Close>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 font-mono text-sm leading-relaxed">
              {selectedLog ? (
                <LogDetailBody
                  log={selectedLog}
                  labels={{
                    time: L.time,
                    level: L.level,
                    module: L.module,
                    message: L.message,
                    metadata: L.metadata,
                    requestId: L.requestId,
                    sessionId: L.sessionId,
                  }}
                />
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={filesOpen} onOpenChange={setFilesOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-50 bg-scrim" />
          <Dialog.Content
            className={cn(
              'xopc-dialog-content fixed left-1/2 top-1/2 z-50 flex max-h-[min(32rem,85vh)] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-edge bg-surface-panel shadow-popover outline-none',
              'dark:border-edge',
            )}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3 dark:border-edge">
              <Dialog.Title className="flex items-center gap-2 text-base font-semibold tracking-tight text-fg">
                <Folder className="size-4 text-fg-muted" strokeWidth={1.75} />
                {L.logFiles}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="h-9 w-9 shrink-0 p-0" aria-label={L.close}>
                  <X className="size-5" strokeWidth={1.75} />
                </Button>
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {files.length === 0 ? (
                <p className="text-sm text-fg-muted">{L.filesEmpty}</p>
              ) : (
                <ul className="flex flex-col gap-2" role="list">
                  {files.map((f) => (
                    <li
                      key={f.name}
                      className="flex flex-col gap-1 rounded-lg border border-edge-subtle bg-surface-base px-3 py-2 dark:border-edge"
                    >
                      <span className="break-all font-mono text-xs text-fg">{f.name}</span>
                      <span className="flex flex-wrap gap-x-2 text-xs text-fg-subtle">
                        <span>{formatFileSize(f.size)}</span>
                        <span>{formatTimestampFull(f.modified)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {logDir ? (
              <div className="shrink-0 border-t border-edge-subtle px-4 py-2 text-xs text-fg-subtle dark:border-edge">
                <span className="font-medium text-fg-muted">{L.logDir}: </span>
                <code className="break-all text-fg-subtle">{logDir}</code>
              </div>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function LogDetailBody({
  log,
  labels,
}: {
  log: LogEntry;
  labels: {
    time: string;
    level: string;
    module: string;
    message: string;
    metadata: string;
    requestId: string;
    sessionId: string;
  };
}) {
  const lv = log.level ?? 'info';
  const rid = typeof log.requestId === 'string' ? log.requestId : '';
  const sid = typeof log.sessionId === 'string' ? log.sessionId : '';
  return (
    <div className="flex flex-col gap-8">
      <div>
        <span className="text-xs font-sans font-medium text-fg-muted">{labels.message}</span>
        <pre className="mt-2 whitespace-pre-wrap break-words border border-edge bg-surface-base p-3 text-xs leading-relaxed text-fg dark:border-edge">
          {log.message || '—'}
        </pre>
      </div>
      <div className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-xs">
        <span className="font-sans text-fg-muted">{labels.time}</span>
        <code className="break-all text-fg">{log.timestamp}</code>
        <span className="font-sans text-fg-muted">{labels.level}</span>
        <span className="text-fg">{levelLabel(lv)}</span>
        <span className="font-sans text-fg-muted">{labels.module}</span>
        <code className="break-all text-fg">{moduleLabel(log)}</code>
        {rid ? (
          <>
            <span className="font-sans text-fg-muted">{labels.requestId}</span>
            <code className="break-all text-fg">{rid}</code>
          </>
        ) : null}
        {sid ? (
          <>
            <span className="font-sans text-fg-muted">{labels.sessionId}</span>
            <code className="break-all text-fg">{sid}</code>
          </>
        ) : null}
      </div>
      {log.meta && Object.keys(log.meta).length > 0 ? (
        <div>
          <span className="text-xs font-sans font-medium text-fg-muted">{labels.metadata}</span>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words border border-edge bg-surface-base p-3 text-xs leading-relaxed text-fg dark:border-edge">
            {JSON.stringify(log.meta, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
