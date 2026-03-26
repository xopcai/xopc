import * as Dialog from '@radix-ui/react-dialog';
import {
  ChevronDown,
  FileText,
  Folder,
  Pause,
  Play,
  RefreshCw,
  Search,
  Terminal,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { nativeSelectMaxWidthClass, selectControlBaseClass } from '@/lib/form-field-width';
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

function levelChipClasses(level: LogLevel, active: boolean): string {
  const base =
    'rounded-md border px-2 py-1 text-xs font-medium capitalize transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel';
  if (!active) {
    return cn(
      base,
      'border-edge bg-surface-panel text-fg-muted hover:bg-surface-hover dark:border-edge',
    );
  }
  switch (level) {
    case 'error':
    case 'fatal':
      return cn(
        base,
        'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400',
      );
    case 'warn':
      return cn(
        base,
        'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-400',
      );
    default:
      return cn(base, 'border-edge bg-surface-active text-fg dark:border-edge');
  }
}

function lineLevelBadgeClass(level: LogLevel | string): string {
  const l = String(level).toLowerCase();
  const base =
    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide';
  if (l === 'error' || l === 'fatal') {
    return cn(base, 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400');
  }
  if (l === 'warn') {
    return cn(base, 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-400');
  }
  if (l === 'debug' || l === 'trace') {
    return cn(base, 'bg-surface-hover text-fg-subtle');
  }
  return cn(base, 'bg-surface-hover text-fg-muted');
}

export function LogsPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const L = m.logs;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedLevels, setSelectedLevels] = useState<Set<LogLevel>>(new Set());
  const [moduleFilter, setModuleFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [modules, setModules] = useState<string[]>([]);
  const [files, setFiles] = useState<LogFile[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getLogStats>> | null>(null);

  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [logDir, setLogDir] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

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

  // Initial + filter/search changes: reload from start
  useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setLogs([]);
      try {
        const result = await queryLogs({
          ...queryParams,
          offset: 0,
        });
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

  const toggleLevel = (level: LogLevel) => {
    setSelectedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  const clearFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setSelectedLevels(new Set());
    setModuleFilter('');
    setDateFrom('');
    setDateTo('');
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

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-10">
        <div className="flex items-start gap-3 rounded-2xl bg-surface-base p-6">
          <Terminal className="mt-0.5 size-5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <div>
            <h1 className="text-base font-semibold text-fg">{L.title}</h1>
            <p className="mt-1 text-sm text-fg-muted">{L.needToken}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-5 px-4 py-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover/80 dark:bg-surface-hover/50"
            aria-hidden
          >
            <Terminal className="size-5 text-fg-muted" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-fg">{L.title}</h1>
            <p className="mt-0.5 text-sm text-fg-muted">{L.subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
          <Button
            type="button"
            variant="ghost"
            className="h-9 px-2"
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
            variant={autoRefresh ? 'secondary' : 'ghost'}
            className="h-9 px-2"
            title={autoRefresh ? L.pause : L.autoRefresh}
            aria-label={autoRefresh ? L.pause : L.autoRefresh}
            onClick={() => setAutoRefresh((v) => !v)}
          >
            {autoRefresh ? (
              <Pause className="size-4" strokeWidth={1.75} />
            ) : (
              <Play className="size-4" strokeWidth={1.75} />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-9 px-2"
            title={L.refresh}
            aria-label={L.refresh}
            onClick={() => {
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
            }}
          >
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} strokeWidth={1.75} />
          </Button>
        </div>
      </header>

      {error ? (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {/* Sample stats */}
      {stats ? (
        <section
          className="rounded-lg border border-edge-subtle bg-surface-base px-3 py-2.5 dark:border-edge"
          aria-label={L.statsRegion}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{L.statsRegion}</p>
          <p className="mt-1 text-xs text-fg-subtle">{L.statsHint}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {LOG_LEVELS.map((lv) => {
              const byLevel = stats.byLevel ?? {};
              const n = byLevel[lv] ?? 0;
              if (n === 0) return null;
              return (
                <span
                  key={lv}
                  className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-panel px-2 py-0.5 text-xs text-fg-muted dark:border-edge"
                >
                  <span className="font-medium capitalize text-fg">{lv}</span>
                  <span className="tabular-nums">{n}</span>
                </span>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Filters */}
      <section className="flex flex-col gap-4" aria-label={L.filters}>
        <label className="relative block">
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
              'w-full rounded-lg bg-surface-base py-2 pl-10 pr-3 text-sm text-fg placeholder:text-fg-subtle',
              'focus:outline-none focus:ring-2 focus:ring-accent/35 dark:bg-surface-hover/35',
            )}
          />
        </label>

        <div className="flex flex-wrap gap-2" role="group" aria-label={L.level}>
          {LOG_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={levelChipClasses(level, selectedLevels.has(level))}
              onClick={() => toggleLevel(level)}
            >
              {level}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="log-module" className="mb-1 block text-xs font-medium text-fg-muted">
              {L.module}
            </label>
            <select
              id="log-module"
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className={cn(selectControlBaseClass, nativeSelectMaxWidthClass)}
            >
              <option value="">{L.allModules}</option>
              {modules.map((mod) => (
                <option key={mod} value={mod}>
                  {mod}
                </option>
              ))}
            </select>
          </div>

          <details className="min-w-[14rem] flex-1 rounded-lg bg-surface-base open:pb-3 dark:bg-surface-hover/30">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-fg hover:bg-surface-hover/70">
              {L.timeRange}
            </summary>
            <div className="flex flex-col gap-3 border-t border-edge-subtle px-3 pt-3 dark:border-edge-subtle sm:flex-row">
              <div className="min-w-0 flex-1">
                <label htmlFor="log-from" className="mb-1 block text-xs text-fg-muted">
                  {L.from}
                </label>
                <input
                  id="log-from"
                  type="datetime-local"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded-md border border-edge bg-surface-panel px-2 py-1.5 text-sm text-fg dark:border-edge"
                />
              </div>
              <div className="min-w-0 flex-1">
                <label htmlFor="log-to" className="mb-1 block text-xs text-fg-muted">
                  {L.to}
                </label>
                <input
                  id="log-to"
                  type="datetime-local"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded-md border border-edge bg-surface-panel px-2 py-1.5 text-sm text-fg dark:border-edge"
                />
              </div>
            </div>
          </details>

          <Button type="button" variant="ghost" className="shrink-0 gap-1 self-end sm:self-end" onClick={clearFilters}>
            <X className="size-4" strokeWidth={1.75} />
            {L.clear}
          </Button>
        </div>

        {autoRefresh ? <p className="text-xs text-fg-subtle">{L.liveHint}</p> : null}
      </section>

      {/* Feed */}
      {loading && logs.length === 0 ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="flex gap-3 rounded-md bg-surface-base p-3 dark:bg-surface-hover/25"
            >
              <div className="h-4 w-16 animate-pulse rounded bg-surface-hover" />
              <div className="h-4 w-12 animate-pulse rounded bg-surface-hover" />
              <div className="h-4 w-24 animate-pulse rounded bg-surface-hover" />
              <div className="h-4 min-w-0 flex-1 animate-pulse rounded bg-surface-hover" />
            </div>
          ))}
        </div>
      ) : null}

      {!loading && logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-surface-base py-16 text-center dark:bg-surface-hover/25">
          <FileText className="size-8 text-fg-subtle" strokeWidth={1.5} aria-hidden />
          <h2 className="text-base font-medium text-fg">{L.noLogs}</h2>
          <p className="max-w-sm text-sm text-fg-muted">{L.noLogsDescription}</p>
          <Button
            type="button"
            variant="secondary"
            className="mt-6 gap-1"
            onClick={() => {
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
            }}
          >
            <RefreshCw className="size-4" />
            {L.refresh}
          </Button>
        </div>
      ) : null}

      {logs.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-fg-muted">
            <span>{interpolate(L.showingCount, { count: String(logs.length) })}</span>
            {hasMore ? <span>{L.moreAvailable}</span> : null}
          </div>
          <ul className="flex flex-col gap-1" role="list">
            {logs.map((log, idx) => {
              const lv = log.level ?? 'info';
              return (
                <li key={`${log.timestamp}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => setSelectedLog(log)}
                    className={cn(
                      'flex w-full min-w-0 gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors duration-150 ease-out active:scale-[0.99]',
                      'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
                    )}
                  >
                    <span className="shrink-0 font-mono text-xs tabular-nums text-fg-subtle">
                      {formatTimeCompact(log.timestamp)}
                    </span>
                    <span className={lineLevelBadgeClass(lv)}>{lv}</span>
                    <span
                      className="hidden max-w-[8rem] shrink-0 truncate font-mono text-xs text-fg-muted sm:inline"
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
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="secondary"
                className="gap-2"
                disabled={loading}
                onClick={handleLoadMore}
              >
                {loading ? (
                  <RefreshCw className="size-4 animate-spin" strokeWidth={1.75} />
                ) : (
                  <ChevronDown className="size-4" strokeWidth={1.75} />
                )}
                {L.loadMore}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Detail drawer */}
      <Dialog.Root open={selectedLog !== null} onOpenChange={(o) => !o && setSelectedLog(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-50 bg-scrim" />
          <Dialog.Content
            className={cn(
              'xopcbot-drawer-right fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-edge bg-surface-panel shadow-xl outline-none',
              'dark:border-edge',
            )}
            aria-describedby={undefined}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3 dark:border-edge">
              <Dialog.Title className="text-base font-semibold text-fg">{L.details}</Dialog.Title>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="h-9 w-9 shrink-0 p-0" aria-label={L.close}>
                  <X className="size-5" strokeWidth={1.75} />
                </Button>
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-sm">
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

      {/* Files dialog */}
      <Dialog.Root open={filesOpen} onOpenChange={setFilesOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-50 bg-scrim" />
          <Dialog.Content
            className={cn(
              'xopcbot-dialog-content fixed left-1/2 top-1/2 z-50 flex max-h-[min(32rem,85vh)] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-edge bg-surface-panel shadow-xl outline-none',
              'dark:border-edge',
            )}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3 dark:border-edge">
              <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-fg">
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
                      className="flex flex-col gap-1 rounded-md bg-surface-hover/50 px-3 py-2 dark:bg-surface-hover/35"
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
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
        <span className="text-fg-muted">{labels.time}</span>
        <code className="break-all font-mono text-xs text-fg">{log.timestamp}</code>
        <span className="text-fg-muted">{labels.level}</span>
        <span className={lineLevelBadgeClass(lv)}>{lv}</span>
        <span className="text-fg-muted">{labels.module}</span>
        <code className="break-all font-mono text-xs text-fg">{moduleLabel(log)}</code>
        {rid ? (
          <>
            <span className="text-fg-muted">{labels.requestId}</span>
            <code className="break-all font-mono text-xs text-fg">{rid}</code>
          </>
        ) : null}
        {sid ? (
          <>
            <span className="text-fg-muted">{labels.sessionId}</span>
            <code className="break-all font-mono text-xs text-fg">{sid}</code>
          </>
        ) : null}
      </div>
      <div>
        <span className="text-xs font-medium text-fg-muted">{labels.message}</span>
        <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-surface-hover/60 p-3 font-mono text-xs text-fg dark:bg-surface-hover/40">
          {log.message || '—'}
        </pre>
      </div>
      {log.meta && Object.keys(log.meta).length > 0 ? (
        <div>
          <span className="text-xs font-medium text-fg-muted">{labels.metadata}</span>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-surface-hover/60 p-3 font-mono text-xs text-fg dark:bg-surface-hover/40">
            {JSON.stringify(log.meta, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
