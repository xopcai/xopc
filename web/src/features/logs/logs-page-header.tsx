import { Folder, RefreshCw } from 'lucide-react';

import { SlidingSegmented } from '@/components/ui/sliding-segmented';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { LogsMessages } from '@/i18n/messages';

type Props = {
  L: LogsMessages;
  autoRefresh: boolean;
  onAutoRefreshChange: (live: boolean) => void;
  fileCount: number;
  onOpenFiles: () => void;
  loading: boolean;
  onRefreshAll: () => void;
};

export function LogsPageHeader({
  L,
  autoRefresh,
  onAutoRefreshChange,
  fileCount,
  onOpenFiles,
  loading,
  onRefreshAll,
}: Props) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{L.title}</h1>
        <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">{L.subtitle}</p>
      </div>
      <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:max-w-md sm:flex-row sm:items-center sm:justify-end">
        <div className="w-full sm:w-48">
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
        <div className="flex items-center gap-1 self-end sm:self-center">
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
          <Button
            type="button"
            variant="ghost"
            className="h-9 min-h-[44px] min-w-[44px] px-2 sm:min-h-9 sm:min-w-0"
            title={L.refresh}
            aria-label={L.refresh}
            onClick={onRefreshAll}
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
  );
}
