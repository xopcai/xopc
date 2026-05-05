import { ChevronDown, FileText, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { LogEntry } from '@/features/logs/log.types';
import {
  interpolate,
  levelLabel,
  messagePreview,
  moduleLabel,
  requestIdPreview,
  formatTimeCompact,
} from '@/features/logs/logs-page-lib';
import type { LogsMessages } from '@/i18n/messages';

type Props = {
  L: LogsMessages;
  logs: LogEntry[];
  loading: boolean;
  hasMore: boolean;
  onSelectLog: (log: LogEntry) => void;
  onLoadMore: () => void;
  onRefreshAll: () => void;
};

export function LogsListSection({ L, logs, loading, hasMore, onSelectLog, onLoadMore, onRefreshAll }: Props) {
  return (
    <>
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
          <Button type="button" variant="secondary" className="mt-4 gap-2" onClick={onRefreshAll}>
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
                    onClick={() => onSelectLog(log)}
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
              <Button type="button" variant="secondary" className="gap-2" disabled={loading} onClick={onLoadMore}>
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
    </>
  );
}
