import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

import type { LogErrorSummaryItem } from '@/features/logs/log.types';
import { formatTimeCompact } from '@/features/logs/logs-page-lib';
import type { LogsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

type Props = {
  L: LogsMessages;
  items: LogErrorSummaryItem[];
  loading?: boolean;
  onSelectItem?: (item: LogErrorSummaryItem) => void;
};

export function LogsErrorSummarySection({ L, items, loading, onSelectItem }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!loading && items.length === 0) return null;

  const totalCount = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <section className="overflow-hidden rounded-xl bg-surface-panel shadow-surface">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      >
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-fg">{L.errorSummaryTitle}</h2>
          <p className="mt-0.5 text-xs leading-5 text-fg-muted">{L.errorSummaryHint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {loading ? (
            <span className="text-xs text-fg-muted">{L.loading}</span>
          ) : (
            <>
              <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-xs tabular-nums text-red-600 dark:text-red-400">
                {items.length}
              </span>
              <span className="rounded-md bg-surface-hover px-2 py-0.5 text-xs tabular-nums text-fg-muted">
                ×{totalCount}
              </span>
            </>
          )}
          <ChevronDown
            className={cn(
              'size-4 text-fg-muted transition-transform duration-150 ease-out motion-reduce:transition-none',
              expanded && 'rotate-180',
            )}
            strokeWidth={1.75}
            aria-hidden
          />
        </div>
      </button>

      {expanded && !loading && items.length > 0 ? (
        <ul className="divide-y divide-edge-subtle border-t border-edge-subtle dark:divide-edge dark:border-edge">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onSelectItem?.(item)}
                className={cn(
                  'flex w-full flex-col gap-1 px-4 py-2.5 text-left transition-colors hover:bg-surface-hover',
                  onSelectItem && 'cursor-pointer',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-fg">{item.errName}</span>
                  <span className="shrink-0 rounded-md bg-red-500/10 px-2 py-0.5 text-xs tabular-nums text-red-600 dark:text-red-400">
                    ×{item.count}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                  {item.phase ? (
                    <span>
                      {L.phase}: {item.phase}
                    </span>
                  ) : null}
                  {item.module ? (
                    <span>
                      {L.module}: {item.module}
                    </span>
                  ) : null}
                  <span>
                    {L.time}: {formatTimeCompact(item.lastSeen)}
                  </span>
                </div>
                <p className="truncate text-xs text-fg-subtle">{item.sampleMessage}</p>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
