import * as Popover from '@radix-ui/react-popover';
import { Gauge } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { LOG_LEVELS, type LogLevel } from '@/features/logs/log.types';
import { getLogLevel, setLogLevel } from '@/features/logs/log-api';
import type { LogsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_POPOVER_Z } from '@/lib/settings-shell-dialog-layer';

type Props = {
  L: LogsMessages;
};

export function LogsLevelPopover({ L }: Props) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<LogLevel>('info');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getLogLevel()
      .then((level) => {
        if (!cancelled) setCurrent(level);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : L.logLevelLoadError);
      });
    return () => {
      cancelled = true;
    };
  }, [open, L.logLevelLoadError]);

  const applyLevel = (level: LogLevel) => {
    setSaving(true);
    setError(null);
    void setLogLevel(level)
      .then((result) => {
        setCurrent(result.current as LogLevel);
        setOpen(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : L.logLevelSaveError);
      })
      .finally(() => setSaving(false));
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button type="button" variant="secondary" className="h-9 gap-2 px-3 text-xs" title={L.logLevelTitle}>
          <Gauge className="size-4" strokeWidth={1.75} />
          <span className="hidden sm:inline">{L.logLevelTitle}</span>
          <span className="tabular-nums text-fg-muted">{current}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className={cn(
            'w-56 rounded-xl border border-edge bg-surface-panel p-3 shadow-popover outline-none',
            SETTINGS_SHELL_POPOVER_Z,
            'dark:border-edge',
          )}
        >
          <p className="text-xs font-medium text-fg">{L.logLevelTitle}</p>
          <p className="mt-1 text-xs leading-5 text-fg-muted">{L.logLevelHint}</p>
          <ul className="mt-3 flex flex-col gap-1">
            {LOG_LEVELS.map((level) => (
              <li key={level}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => applyLevel(level)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                    current === level
                      ? 'bg-accent/10 font-medium text-accent'
                      : 'text-fg hover:bg-surface-hover',
                  )}
                >
                  <span>{L.levelNames[level]}</span>
                  <span className="font-mono text-[10px] uppercase text-fg-subtle">{level}</span>
                </button>
              </li>
            ))}
          </ul>
          {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
