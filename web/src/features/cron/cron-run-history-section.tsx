import { Clock, Loader2 } from 'lucide-react';

import { RefreshButton } from '@/components/ui/refresh-button';
import type { CronJob, CronRunHistoryRow } from '@/features/cron/cron-api';
import { navigateToSessionChat, navigateToWorkflowRun } from '@/features/cron/cron-page-lib';
import {
  execStatusLabel,
  formatDuration,
  formatTime,
  truncate,
} from '@/features/cron/cron-utils';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';

type CronCopy = MessageBundle['cron'];

export type CronRunHistorySectionProps = {
  c: CronCopy;
  runHistoryLoading: boolean;
  runHistory: CronRunHistoryRow[];
  filteredRunHistory: CronRunHistoryRow[];
  jobs: CronJob[];
  onRefreshHistory: () => void;
  onOpenJobDetail: (job: CronJob) => void;
  statusLabels: {
    running: string;
    success: string;
    failed: string;
    cancelled: string;
  };
};

export function CronRunHistorySection({
  c,
  runHistoryLoading,
  runHistory,
  filteredRunHistory,
  jobs,
  onRefreshHistory,
  onOpenJobDetail,
  statusLabels,
}: CronRunHistorySectionProps) {
  return (
    <section aria-labelledby="cron-history-panel" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="cron-history-panel" className="sr-only">
            {c.tabRunHistory}
          </h2>
          <p className="text-xs text-fg-muted">{c.runHistoryHint}</p>
        </div>
        <RefreshButton
          className="size-9 shrink-0 p-0"
          loading={runHistoryLoading}
          label={c.refresh}
          onClick={onRefreshHistory}
        />
      </div>
      {runHistoryLoading && runHistory.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-8 animate-spin text-accent" strokeWidth={1.75} />
        </div>
      ) : filteredRunHistory.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-edge-subtle px-6 py-16 text-center dark:border-edge-subtle">
          <Clock className="mb-4 size-14 text-fg-disabled" strokeWidth={1.1} aria-hidden />
          <h3 className="text-base font-semibold text-fg">
            {runHistory.length === 0 ? c.emptyHistoryTitle : c.noRunsYet}
          </h3>
          <p className="mt-2 max-w-sm text-sm text-fg-muted">
            {runHistory.length === 0 ? c.emptyHistoryHint : c.runHistoryHint}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-edge-subtle bg-surface-base dark:border-edge-subtle">
          <table className="w-full min-w-[700px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-edge text-xs font-medium text-fg-muted">
                <th className="px-3 py-2.5 font-medium">{c.colStarted}</th>
                <th className="px-3 py-2.5 font-medium">{c.colJob}</th>
                <th className="px-3 py-2.5 font-medium">{c.status}</th>
                <th className="px-3 py-2.5 font-medium">{c.colDuration}</th>
                <th className="px-3 py-2.5 font-medium">{c.colDetail}</th>
                <th className="px-3 py-2.5 font-medium">{c.colWorkflow}</th>
                <th className="px-3 py-2.5 font-medium">{c.colChat}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRunHistory.map((row) => (
                <tr key={row.id} className="border-b border-edge/60 last:border-0">
                  <td className="whitespace-nowrap px-3 py-2.5 text-fg">
                    <time dateTime={row.startedAt}>{formatTime(row.startedAt)}</time>
                  </td>
                  <td className="max-w-[10rem] truncate px-3 py-2.5">
                    {jobs.some((j) => j.id === row.jobId) ? (
                      <button
                        type="button"
                        className="text-left text-accent hover:underline"
                        onClick={() => {
                          const j = jobs.find((x) => x.id === row.jobId);
                          if (j) void onOpenJobDetail(j);
                        }}
                      >
                        {row.jobName || row.jobId}
                      </button>
                    ) : (
                      <span className="text-fg-muted">{row.jobName || row.jobId}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                        row.status === 'success' && 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
                        row.status === 'failed' && 'bg-red-500/15 text-red-800 dark:text-red-300',
                        row.status === 'running' && 'bg-accent/15 text-accent',
                        row.status === 'cancelled' && 'bg-surface-hover text-fg-muted',
                      )}
                    >
                      {execStatusLabel(row.status, statusLabels)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">
                    {formatDuration(row.duration)}
                  </td>
                  <td
                    className="max-w-xs truncate px-3 py-2.5 text-fg-muted"
                    title={row.summary || row.error || ''}
                  >
                    {truncate(row.summary || row.error, 96)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    {row.workflowRunId?.trim() ? (
                      <button
                        type="button"
                        className="text-xs font-medium text-accent hover:underline"
                        title={c.openWorkflowTitle}
                        aria-label={c.openWorkflowTitle}
                        onClick={() => navigateToWorkflowRun(row.workflowRunId)}
                      >
                        {c.openWorkflow}
                      </button>
                    ) : (
                      <span className="text-fg-disabled">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    {row.sessionKey?.trim() ? (
                      <button
                        type="button"
                        className="text-xs font-medium text-accent hover:underline"
                        title={c.openChatTitle}
                        aria-label={c.openChatTitle}
                        onClick={() => navigateToSessionChat(row.sessionKey)}
                      >
                        {c.openChat}
                      </button>
                    ) : (
                      <span className="text-fg-disabled">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
