import { Folder } from 'lucide-react';

import { SlidingSegmented } from '@/components/ui/sliding-segmented';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { LogsExportMenu } from '@/features/logs/logs-export-menu';
import { LogsLevelPopover } from '@/features/logs/logs-level-popover';
import type { LogEntry } from '@/features/logs/log.types';
import type { LogsMessages } from '@/i18n/messages';

type Props = {
  L: LogsMessages;
  autoRefresh: boolean;
  onAutoRefreshChange: (live: boolean) => void;
  fileCount: number;
  onOpenFiles: () => void;
  loading: boolean;
  onRefreshAll: () => void;
  logs: LogEntry[];
};

export function LogsPageHeader({
  L,
  autoRefresh,
  onAutoRefreshChange,
  fileCount,
  onOpenFiles,
  loading,
  onRefreshAll,
  logs,
}: Props) {
  return (
    <header className="flex flex-col gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-lg">{L.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted sm:mt-1">{L.subtitle}</p>
      </div>
      <div className="flex w-full shrink-0 flex-col gap-2 rounded-xl bg-surface-hover/20 p-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:w-52">
          <SlidingSegmented
            aria-label={L.refreshModeAria}
            value={autoRefresh ? 'live' : 'paused'}
            onChange={(v) => onAutoRefreshChange(v === 'live')}
            options={[
              { value: 'paused', label: L.refreshManual },
              { value: 'live', label: L.refreshLive },
            ]}
            buttonClassName="h-8"
          />
        </div>
        <div className="flex min-w-0 items-center justify-end gap-1 sm:self-center">
          <LogsLevelPopover L={L} />
          <LogsExportMenu L={L} logs={logs} disabled={loading} />
          <Button
            type="button"
            variant="ghost"
            className="h-9 min-h-[44px] min-w-[44px] px-2 sm:min-h-9 sm:min-w-0"
            title={L.logFiles}
            aria-label={L.logFiles}
            onClick={onOpenFiles}
          >
            <Folder className="size-4" strokeWidth={1.75} />
            {fileCount > 0 ? (
              <span className="rounded-full bg-surface-hover px-1.5 text-xs text-fg-muted">{fileCount}</span>
            ) : null}
          </Button>
          <RefreshButton
            className="h-9 min-h-[44px] min-w-[44px] px-2 sm:min-h-9 sm:min-w-0"
            loading={loading}
            label={L.refresh}
            onClick={onRefreshAll}
          />
        </div>
      </div>
    </header>
  );
}
