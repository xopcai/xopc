import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import * as Popover from '@radix-ui/react-popover';
import type { LogEntry } from '@/features/logs/log.types';
import { downloadLogsExport } from '@/features/logs/logs-export';
import type { LogsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_POPOVER_Z } from '@/lib/settings-shell-dialog-layer';

type Props = {
  L: LogsMessages;
  logs: LogEntry[];
  disabled?: boolean;
};

export function LogsExportMenu({ L, logs, disabled }: Props) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="secondary"
          className="h-9 gap-2 px-3 text-xs"
          disabled={disabled || logs.length === 0}
          title={L.exportLogs}
        >
          <Download className="size-4" strokeWidth={1.75} />
          <span className="hidden sm:inline">{L.exportLogs}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className={cn(
            'w-52 rounded-xl border border-edge bg-surface-panel p-2 shadow-popover outline-none',
            SETTINGS_SHELL_POPOVER_Z,
            'dark:border-edge',
          )}
        >
          <p className="px-2 py-1 text-xs font-medium text-fg">{L.exportLogs}</p>
          <p className="px-2 pb-2 text-xs leading-5 text-fg-muted">{L.exportHint}</p>
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              variant="ghost"
              className="h-8 justify-start px-2 text-xs"
              onClick={() => downloadLogsExport(logs, 'json')}
            >
              {L.exportJson}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 justify-start px-2 text-xs"
              onClick={() => downloadLogsExport(logs, 'csv')}
            >
              {L.exportCsv}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
