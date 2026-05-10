import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LOG_LEVELS, type LogLevel } from '@/features/logs/log.types';
import type { LogsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';

type Props = {
  L: LogsMessages;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dateFrom: string;
  onDateFromChange: (v: string) => void;
  dateTo: string;
  onDateToChange: (v: string) => void;
  selectedLevels: Set<LogLevel>;
  onToggleLevel: (level: LogLevel) => void;
};

export function LogsFiltersDialog({
  L,
  open,
  onOpenChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  selectedLevels,
  onToggleLevel,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)}
        />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 flex max-h-[min(32rem,90vh)] w-[min(100%-2rem,22rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-edge bg-surface-panel shadow-popover outline-none',
            SETTINGS_SHELL_CONTENT_Z,
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
                  onChange={(e) => onDateFromChange(e.target.value)}
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
                  onChange={(e) => onDateToChange(e.target.value)}
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
                    onClick={() => onToggleLevel(level)}
                  >
                    {L.levelNames[level]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="shrink-0 border-t border-edge-subtle px-4 py-3 dark:border-edge">
            <Button type="button" className="w-full rounded-xl" onClick={() => onOpenChange(false)}>
              {L.filtersDone}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
