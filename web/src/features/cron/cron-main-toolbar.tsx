import {
  segmentedThumbActiveClassName,
  segmentedThumbBaseClassName,
  segmentedTrackClassName,
} from '@/components/ui/segmented-styles';
import type { CronJob } from '@/features/cron/cron-api';
import { cronToolbarSelectClass } from '@/features/cron/cron-page-lib';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';

type CronCopy = MessageBundle['cron'];

export type CronMainToolbarProps = {
  c: CronCopy;
  mainTab: 'tasks' | 'history';
  onMainTabChange: (tab: 'tasks' | 'history') => void;
  jobSort: 'created_desc' | 'created_asc';
  onJobSortChange: (sort: 'created_desc' | 'created_asc') => void;
  historyRange: 'day' | 'week' | 'month';
  onHistoryRangeChange: (range: 'day' | 'week' | 'month') => void;
  historyJobFilter: string;
  onHistoryJobFilterChange: (jobId: string) => void;
  historyStatusFilter: string;
  onHistoryStatusFilterChange: (status: string) => void;
  jobs: CronJob[];
};

export function CronMainToolbar({
  c,
  mainTab,
  onMainTabChange,
  jobSort,
  onJobSortChange,
  historyRange,
  onHistoryRangeChange,
  historyJobFilter,
  onHistoryJobFilterChange,
  historyStatusFilter,
  onHistoryStatusFilterChange,
  jobs,
}: CronMainToolbarProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-edge-subtle pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-edge-subtle">
      <div className="flex gap-1" role="tablist" aria-label={c.title}>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === 'tasks'}
          className={cn(
            'rounded-md px-3 py-2 text-sm font-medium transition-colors',
            mainTab === 'tasks' ? 'text-fg' : 'text-fg-muted hover:text-fg',
          )}
          onClick={() => onMainTabChange('tasks')}
        >
          {c.tabMyTasks}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === 'history'}
          className={cn(
            'rounded-md px-3 py-2 text-sm font-medium transition-colors',
            mainTab === 'history' ? 'text-fg' : 'text-fg-muted hover:text-fg',
          )}
          onClick={() => onMainTabChange('history')}
        >
          {c.tabRunHistory}
        </button>
      </div>
      <div
        className={cn(
          'flex min-w-0 items-center gap-2',
          mainTab === 'history'
            ? 'flex-nowrap overflow-x-auto pb-0.5 sm:justify-end'
            : 'flex-wrap sm:justify-end',
        )}
      >
        {mainTab === 'tasks' ? (
          <select
            className={cronToolbarSelectClass}
            value={jobSort}
            onChange={(e) => onJobSortChange(e.target.value as 'created_desc' | 'created_asc')}
            aria-label={c.sortCreatedDesc}
          >
            <option value="created_desc">{c.sortCreatedDesc}</option>
            <option value="created_asc">{c.sortCreatedAsc}</option>
          </select>
        ) : (
          <>
            <div className={cn(segmentedTrackClassName, 'shrink-0')} role="group" aria-label={c.runHistoryTitle}>
              {(['day', 'week', 'month'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={cn(
                    segmentedThumbBaseClassName,
                    'px-2.5 py-1',
                    historyRange === r && segmentedThumbActiveClassName,
                    historyRange === r && 'text-fg',
                  )}
                  onClick={() => onHistoryRangeChange(r)}
                >
                  {r === 'day' ? c.historyRangeDay : r === 'week' ? c.historyRangeWeek : c.historyRangeMonth}
                </button>
              ))}
            </div>
            <select
              className={cronToolbarSelectClass}
              value={historyJobFilter}
              onChange={(e) => onHistoryJobFilterChange(e.target.value)}
              aria-label={c.filterAllTasks}
            >
              <option value="">{c.filterAllTasks}</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name || j.id}
                </option>
              ))}
            </select>
            <select
              className={cronToolbarSelectClass}
              value={historyStatusFilter}
              onChange={(e) => onHistoryStatusFilterChange(e.target.value)}
              aria-label={c.filterAllStatuses}
            >
              <option value="">{c.filterAllStatuses}</option>
              <option value="success">{c.execStatusSuccess}</option>
              <option value="failed">{c.execStatusFailed}</option>
              <option value="cancelled">{c.execStatusCancelled}</option>
              <option value="running">{c.execStatusRunning}</option>
            </select>
          </>
        )}
      </div>
    </div>
  );
}
