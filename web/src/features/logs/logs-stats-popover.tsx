import * as Popover from '@radix-ui/react-popover';

import { cn } from '@/lib/cn';
import { formatStatsLine } from '@/features/logs/logs-page-lib';
import { LOG_LEVELS, type LogStats } from '@/features/logs/log.types';
import type { LogsMessages } from '@/i18n/messages';

type Props = {
  L: LogsMessages;
  stats: LogStats;
};

export function LogsStatsPopover({ L, stats }: Props) {
  const statsLine = formatStatsLine(stats.byLevel ?? {}, L.levelNames);
  if (!statsLine) return null;

  return (
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
  );
}
