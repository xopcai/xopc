import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import type { CronJob, CronJobExecution } from '@/features/cron/cron-api';
import { cronJobBodyText } from '@/features/cron/cron-api';
import { navigateToSessionChat } from '@/features/cron/cron-page-lib';
import {
  execStatusLabel,
  formatDeliveryToSummary,
  formatDuration,
  formatNextRun,
  formatTime,
  truncate,
} from '@/features/cron/cron-utils';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';

type CronCopy = MessageBundle['cron'];

export type CronJobDetailDrawerProps = {
  open: boolean;
  onDismiss: () => void;
  detailJob: CronJob | null;
  detailLoading: boolean;
  detailHistory: CronJobExecution[];
  c: CronCopy;
  chatWorkingDirNotSet: string;
  statusLabels: {
    running: string;
    success: string;
    failed: string;
    cancelled: string;
  };
};

export function CronJobDetailDrawer({
  open,
  onDismiss,
  detailJob,
  detailLoading,
  detailHistory,
  c,
  chatWorkingDirNotSet,
  statusLabels,
}: CronJobDetailDrawerProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-drawer-right fixed right-0 top-0 z-[60] flex h-full w-full max-w-lg flex-col border-l border-edge bg-surface-panel shadow-popover outline-none',
            'dark:border-edge',
          )}
          aria-describedby={undefined}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3">
            <Dialog.Title className="min-w-0 truncate text-base font-semibold text-fg">
              {detailJob?.name?.trim() || detailJob?.id || '—'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" className="h-9 w-9 shrink-0 p-0" aria-label={c.close}>
                <X className="size-5" strokeWidth={1.75} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {detailLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="size-8 animate-spin text-accent" strokeWidth={1.75} />
              </div>
            ) : detailJob ? (
              <>
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-xs font-medium text-fg-muted">{c.scheduleLabel}</dt>
                    <dd className="mt-1 font-mono text-fg">
                      <code>{detailJob.schedule}</code>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-fg-muted">{c.messageLabel}</dt>
                    <dd className="mt-1 min-w-0 break-words text-fg">
                      <MarkdownView content={cronJobBodyText(detailJob)} compact className="text-sm" />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-fg-muted">{c.mode}</dt>
                    <dd className="mt-1 text-fg">
                      {detailJob.sessionTarget === 'isolated' ? c.modeAgentOption : c.modeDirectOption}
                    </dd>
                  </div>
                  {detailJob.sessionTarget === 'isolated' ? (
                    <div>
                      <dt className="text-xs font-medium text-fg-muted">{c.agentProfile}</dt>
                      <dd className="mt-1 font-mono text-sm text-fg">
                        {detailJob.agentId?.trim() ? detailJob.agentId.trim() : c.agentProfileDefault}
                      </dd>
                    </div>
                  ) : null}
                  {detailJob.sessionTarget === 'isolated' ? (
                    <div>
                      <dt className="text-xs font-medium text-fg-muted">{c.workingDirectoryLabel}</dt>
                      <dd className="mt-1 break-all font-mono text-xs text-fg">
                        {detailJob.workingDirectory?.trim()
                          ? detailJob.workingDirectory.trim()
                          : chatWorkingDirNotSet}
                      </dd>
                    </div>
                  ) : null}
                  {detailJob.delivery?.channel === 'local' ||
                  (detailJob.sessionTarget === 'isolated' && !detailJob.delivery?.to) ? (
                    <div>
                      <dt className="text-xs font-medium text-fg-muted">{c.deliveryTarget}</dt>
                      <dd className="mt-1 text-fg">
                        {detailJob.delivery?.channel === 'local'
                          ? c.deliveryTargetLocalChannel
                          : c.deliveryLocalOnly}
                      </dd>
                    </div>
                  ) : detailJob.delivery?.to ? (
                    <div>
                      <dt className="text-xs font-medium text-fg-muted">{c.deliveryTarget}</dt>
                      <dd className="mt-1 break-words text-fg">
                        <code className="text-xs">{detailJob.delivery?.channel ?? ''}</code>
                        {' → '}
                        {formatDeliveryToSummary(detailJob, c.channelLocal)}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-xs font-medium text-fg-muted">{c.status}</dt>
                    <dd className="mt-1 text-fg">{detailJob.enabled ? c.enabled : c.disabled}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-fg-muted">{c.nextRun}</dt>
                    <dd className="mt-1 text-fg">
                      {detailJob.next_run ? formatNextRun(detailJob.next_run, c.timeLabels) : '—'}
                    </dd>
                  </div>
                </dl>
                <h3 className="mt-6 text-sm font-semibold text-fg">{c.detailRunHistory}</h3>
                {detailHistory.length === 0 ? (
                  <p className="mt-2 text-sm text-fg-muted">{c.noRunsYet}</p>
                ) : (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-edge text-fg-muted">
                          <th className="py-1.5 pr-2 font-medium">{c.colStarted}</th>
                          <th className="py-1.5 pr-2 font-medium">{c.status}</th>
                          <th className="py-1.5 pr-2 font-medium">{c.colDuration}</th>
                          <th className="py-1.5 pr-2 font-medium">{c.colDetail}</th>
                          <th className="py-1.5 font-medium">{c.colChat}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailHistory.map((row) => (
                          <tr key={row.id} className="border-b border-edge/60">
                            <td className="whitespace-nowrap py-1.5 pr-2 text-fg">
                              <time dateTime={row.startedAt}>{formatTime(row.startedAt)}</time>
                            </td>
                            <td className="py-1.5 pr-2">
                              <span
                                className={cn(
                                  'inline-flex rounded px-1.5 py-0.5 font-medium',
                                  row.status === 'success' &&
                                    'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
                                  row.status === 'failed' && 'bg-red-500/15 text-red-800 dark:text-red-300',
                                )}
                              >
                                {execStatusLabel(row.status, statusLabels)}
                              </span>
                            </td>
                            <td className="py-1.5 pr-2 text-fg-muted">{formatDuration(row.duration)}</td>
                            <td
                              className="max-w-[8rem] truncate py-1.5 pr-2 text-fg-muted"
                              title={row.summary || row.error || ''}
                            >
                              {truncate(row.summary || row.error, 120)}
                            </td>
                            <td className="whitespace-nowrap py-1.5">
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
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
