import * as Dialog from '@radix-ui/react-dialog';
import {
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  Copy,
  GitBranch,
  Loader2,
  MessageSquare,
  Play,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import type { CronJob, CronJobExecution } from '@/features/cron/cron-api';
import { cronJobBodyText } from '@/features/cron/cron-api';
import { navigateToSessionChat, navigateToWorkflowRun } from '@/features/cron/cron-page-lib';
import {
  execStatusLabel,
  formatDeliveryToSummary,
  formatDuration,
  formatNextRun,
  formatScheduleBadge,
  formatTime,
  scheduleTechnicalText,
} from '@/features/cron/cron-utils';
import type { ScheduleBadgeLabels } from '@/features/cron/cron-utils';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

type CronCopy = MessageBundle['cron'];

const DETAIL_SPLIT_MIN_PERCENT = 34;
const DETAIL_SPLIT_MAX_PERCENT = 62;
const DETAIL_SPLIT_DEFAULT_PERCENT = 46;

function clampDetailSplitPercent(value: number): number {
  return Math.max(DETAIL_SPLIT_MIN_PERCENT, Math.min(DETAIL_SPLIT_MAX_PERCENT, value));
}

export type CronJobDetailDrawerProps = {
  open: boolean;
  onDismiss: () => void;
  detailJob: CronJob | null;
  detailLoading: boolean;
  actionNotice: { kind: 'error' | 'info'; message: string; sessionKey?: string } | null;
  detailHistory: CronJobExecution[];
  c: CronCopy;
  localeTag: string;
  scheduleBadgeLabels: ScheduleBadgeLabels;
  chatWorkingDirNotSet: string;
  statusLabels: {
    running: string;
    success: string;
    failed: string;
    cancelled: string;
  };
  onEdit: (job: CronJob) => void;
  onRunNow: (job: CronJob) => void;
  onToggle: (job: CronJob, enabled: boolean) => void;
  onDelete: (job: CronJob) => void;
};

function execStatusTone(status: CronJobExecution['status']): string {
  switch (status) {
    case 'success':
      return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300';
    case 'failed':
      return 'bg-red-500/15 text-red-800 dark:text-red-300';
    case 'running':
      return 'bg-accent/15 text-accent';
    case 'cancelled':
      return 'bg-surface-hover text-fg-muted';
    default:
      return 'bg-surface-hover text-fg-muted';
  }
}

function taskKindLabel(job: CronJob, c: CronCopy): string {
  if (job.payload.kind === 'workflowRun') return c.taskKindWorkflowRun;
  if (job.payload.kind === 'agentTurn') return c.taskKindMessage;
  return c.modeDirectOption;
}

function resolveDefaultExpandedRunId(history: CronJobExecution[]): string | null {
  if (history.length === 0) return null;
  const failed = history.find((row) => row.status === 'failed');
  return failed?.id ?? history[0]?.id ?? null;
}

function CronRunHistoryCard({
  row,
  expanded,
  onToggle,
  c,
  statusLabels,
}: {
  row: CronJobExecution;
  expanded: boolean;
  onToggle: () => void;
  c: CronCopy;
  statusLabels: CronJobDetailDrawerProps['statusLabels'];
}) {
  const detailText = (row.error || row.summary || row.output || '').trim();
  const hasDetail = detailText.length > 0;

  return (
    <article className="rounded-xl border border-edge-subtle bg-surface-base dark:border-edge-subtle">
      <div className="flex items-start gap-3 px-3 py-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover">
          <Clock className="size-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <time className="text-sm font-medium text-fg" dateTime={row.startedAt}>
              {formatTime(row.startedAt)}
            </time>
            <span
              className={cn(
                'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                execStatusTone(row.status),
              )}
            >
              {execStatusLabel(row.status, statusLabels)}
            </span>
            <span className="text-xs text-fg-muted">{formatDuration(row.duration)}</span>
          </div>
          {!expanded && hasDetail ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-muted">{detailText}</p>
          ) : null}
          {expanded && hasDetail ? (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-edge-subtle bg-surface-panel/80 p-2.5 font-mono text-xs leading-relaxed text-fg-muted">
              {detailText}
            </pre>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-edge-subtle px-3 py-2 dark:border-edge-subtle">
        {hasDetail ? (
          <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={onToggle}>
            <ChevronDown
              className={cn('size-3.5 transition-transform', expanded && 'rotate-180')}
              strokeWidth={1.75}
              aria-hidden
            />
            {expanded ? c.detailCollapseRun : c.detailExpandRun}
          </Button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {row.workflowRunId?.trim() ? (
            <Button
              type="button"
              variant="secondary"
              className="h-8 gap-1.5 px-2.5 text-xs"
              title={c.openWorkflowTitle}
              onClick={() => navigateToWorkflowRun(row.workflowRunId)}
            >
              <GitBranch className="size-3.5" strokeWidth={1.75} aria-hidden />
              {c.openWorkflow}
            </Button>
          ) : null}
          {row.sessionKey?.trim() ? (
            <Button
              type="button"
              variant="secondary"
              className="h-8 gap-1.5 px-2.5 text-xs"
              title={c.openChatTitle}
              onClick={() => navigateToSessionChat(row.sessionKey)}
            >
              <MessageSquare className="size-3.5" strokeWidth={1.75} aria-hidden />
              {c.openChat}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
  valueClassName,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-edge-subtle bg-surface-base/80 px-3 py-2.5 dark:border-edge-subtle">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        {label}
      </div>
      <p className={cn('mt-1 truncate text-sm font-medium text-fg', valueClassName)}>{value}</p>
    </div>
  );
}

export function CronJobDetailDrawer({
  open,
  onDismiss,
  detailJob,
  detailLoading,
  actionNotice,
  detailHistory,
  c,
  localeTag,
  scheduleBadgeLabels,
  chatWorkingDirNotSet,
  statusLabels,
  onEdit,
  onRunNow,
  onToggle,
  onDelete,
}: CronJobDetailDrawerProps) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [copiedSchedule, setCopiedSchedule] = useState(false);
  const [splitPercent, setSplitPercent] = useState(DETAIL_SPLIT_DEFAULT_PERCENT);
  const [splitResizing, setSplitResizing] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  const historyStats = useMemo(() => {
    let success = 0;
    let failed = 0;
    for (const row of detailHistory) {
      if (row.status === 'success') success += 1;
      if (row.status === 'failed') failed += 1;
    }
    return { success, failed };
  }, [detailHistory]);

  const lastRun = detailHistory[0] ?? null;

  useEffect(() => {
    if (!open) {
      setExpandedRunId(null);
      setCopiedSchedule(false);
      return;
    }
    setExpandedRunId(resolveDefaultExpandedRunId(detailHistory));
  }, [open, detailJob?.id, detailHistory]);

  const handleCopySchedule = useCallback(async () => {
    if (!detailJob?.schedule) return;
    const ok = await copyTextToClipboard(scheduleTechnicalText(detailJob.schedule));
    if (!ok) return;
    setCopiedSchedule(true);
    window.setTimeout(() => setCopiedSchedule(false), 1500);
  }, [detailJob?.schedule]);

  const scheduleSummary = detailJob
    ? formatScheduleBadge(detailJob, localeTag, scheduleBadgeLabels)
    : '—';

  const onSplitResizePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const el = e.currentTarget;
    const pid = e.pointerId;
    el.setPointerCapture(pid);
    setSplitResizing(true);

    const updateFromClientX = (clientX: number) => {
      const rawPercent = ((clientX - rect.left) / rect.width) * 100;
      setSplitPercent(clampDetailSplitPercent(rawPercent));
    };

    updateFromClientX(e.clientX);

    const onMove = (ev: PointerEvent) => {
      updateFromClientX(ev.clientX);
    };
    const onDone = () => {
      try {
        el.releasePointerCapture(pid);
      } catch {
        /* ignore */
      }
      setSplitResizing(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onDone);
      window.removeEventListener('pointercancel', onDone);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onDone);
    window.addEventListener('pointercancel', onDone);
  }, []);

  const onSplitResizeKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSplitPercent((value) => clampDetailSplitPercent(value - 4));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSplitPercent((value) => clampDetailSplitPercent(value + 4));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setSplitPercent(DETAIL_SPLIT_MIN_PERCENT);
    } else if (e.key === 'End') {
      e.preventDefault();
      setSplitPercent(DETAIL_SPLIT_MAX_PERCENT);
    }
  }, []);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim backdrop-blur-[1px]" />
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
          <Dialog.Content
            className={cn(
              'xopc-dialog-content-pane pointer-events-auto relative flex h-[min(86vh,46rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none',
              'dark:border-edge',
            )}
            aria-describedby={undefined}
          >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-4 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-base font-semibold tracking-tight text-fg">
                {detailJob?.name?.trim() || detailJob?.id || '—'}
              </Dialog.Title>
              {detailJob ? (
                <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{scheduleSummary}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {detailJob ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={detailJob.enabled}
                  aria-label={detailJob.enabled ? c.enabled : c.disabled}
                  className={cn(
                    'inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-edge p-0.5 transition-colors',
                    detailJob.enabled ? 'justify-end bg-accent' : 'justify-start bg-surface-hover',
                  )}
                  onClick={() => onToggle(detailJob, !detailJob.enabled)}
                >
                  <span className="size-4 rounded-full bg-surface-panel shadow-surface ring-1 ring-edge/40 dark:ring-edge/55" />
                </button>
              ) : null}
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={c.close}>
                  <X className="size-5" strokeWidth={1.75} />
                </Button>
              </Dialog.Close>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:overflow-hidden">
            {detailLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="size-8 animate-spin text-accent" strokeWidth={1.75} />
              </div>
            ) : detailJob ? (
              <div className="flex min-h-full flex-col gap-4 lg:h-full lg:min-h-0">
                {actionNotice ? (
                  <div
                    className={cn(
                      'rounded-xl border px-3 py-2 text-sm',
                      actionNotice.kind === 'error'
                        ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100'
                        : 'border-accent/25 bg-accent/5 text-fg dark:border-accent/30 dark:bg-accent/10',
                    )}
                    role="alert"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p>{actionNotice.message}</p>
                      {actionNotice.sessionKey ? (
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
                          onClick={() => navigateToSessionChat(actionNotice.sessionKey)}
                        >
                          <MessageSquare className="size-3.5" strokeWidth={1.75} aria-hidden />
                          {c.openChat}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div
                  ref={splitContainerRef}
                  className="grid min-h-0 grid-cols-1 gap-4 lg:flex-1 lg:[grid-template-columns:minmax(0,var(--cron-detail-config-pane))_0.75rem_minmax(23rem,1fr)] lg:gap-0"
                  style={
                    {
                      '--cron-detail-config-pane': `${splitPercent}%`,
                    } as CSSProperties
                  }
                >
                  <div className="rounded-2xl border border-edge bg-surface-base/35 p-4 lg:min-h-0 lg:overflow-y-auto">
                    <div className="flex flex-col gap-5">
                      <section>
                        <h3 className="text-sm font-semibold text-fg">{c.scheduleLabel}</h3>
                        <div className="mt-2 rounded-xl border border-edge-subtle bg-surface-base/80 px-3 py-3 dark:border-edge-subtle">
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 flex-1 text-sm font-medium leading-relaxed text-fg">
                              {scheduleSummary}
                            </p>
                            <Button
                              type="button"
                              variant="secondary"
                              className="size-8 shrink-0 p-0"
                              title={c.detailCopySchedule}
                              aria-label={c.detailCopySchedule}
                              onClick={() => void handleCopySchedule()}
                            >
                              {copiedSchedule ? (
                                <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={1.75} />
                              ) : (
                                <Copy className="size-3.5" strokeWidth={1.75} />
                              )}
                            </Button>
                          </div>
                          <p className="mt-2 text-xs text-fg-muted">
                            <span className="font-medium text-fg-subtle">{c.detailCronTechnical}: </span>
                            <code className="font-mono">{scheduleTechnicalText(detailJob.schedule)}</code>
                          </p>
                        </div>
                      </section>

                      <section aria-label={c.statsRegion}>
                        <div className="grid grid-cols-2 gap-2">
                          <SummaryMetric
                            icon={CalendarClock}
                            label={c.nextRun}
                            value={
                              detailJob.nextRunAtMs
                                ? formatNextRun(new Date(detailJob.nextRunAtMs).toISOString(), c.timeLabels)
                                : '—'
                            }
                          />
                          <SummaryMetric
                            icon={Clock}
                            label={c.detailLastRun}
                            value={
                              lastRun
                                ? execStatusLabel(lastRun.status, statusLabels)
                                : c.detailNoRecentRuns
                            }
                            valueClassName={
                              lastRun?.status === 'failed'
                                ? 'text-red-700 dark:text-red-300'
                                : lastRun?.status === 'success'
                                  ? 'text-emerald-800 dark:text-emerald-300'
                                  : undefined
                            }
                          />
                        </div>
                        {detailHistory.length > 0 ? (
                          <p className="mt-2 text-xs text-fg-muted">
                            {c.detailRunCount
                              .replace('{{success}}', String(historyStats.success))
                              .replace('{{failed}}', String(historyStats.failed))}
                          </p>
                        ) : null}
                      </section>

                      <section>
                        <h3 className="text-sm font-semibold text-fg">{c.detailWhatItDoes}</h3>
                        <div className="mt-2 rounded-xl border border-edge-subtle bg-surface-base/80 p-3 dark:border-edge-subtle">
                          <div className="mb-2 inline-flex rounded-md bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                            {taskKindLabel(detailJob, c)}
                          </div>
                          <div className="min-w-0 break-words text-fg [&_.markdown-body]:text-sm [&_.markdown-body]:leading-relaxed">
                            <MarkdownView content={cronJobBodyText(detailJob)} compact className="text-sm" />
                          </div>
                        </div>
                      </section>

                      <section>
                        <div className="flex items-center gap-2">
                          <Settings2 className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden />
                          <h3 className="text-sm font-semibold text-fg">{c.detailRunSettings}</h3>
                        </div>
                        <p className="mt-1 text-xs text-fg-subtle">{c.detailRunSettingsHint}</p>
                        <dl className="mt-3 grid gap-3 rounded-xl border border-edge-subtle bg-surface-base/80 px-3 py-3 text-sm dark:border-edge-subtle">
                          <div>
                            <dt className="text-xs font-medium text-fg-muted">{c.mode}</dt>
                            <dd className="mt-1 text-fg">
                              {detailJob.sessionTarget === 'isolated' ? c.modeAgentOption : c.modeDirectOption}
                            </dd>
                          </div>
                          {detailJob.sessionTarget === 'isolated' ? (
                            <>
                              <div>
                                <dt className="text-xs font-medium text-fg-muted">{c.agentProfile}</dt>
                                <dd className="mt-1 font-mono text-sm text-fg">
                                  {detailJob.agentId?.trim() ? detailJob.agentId.trim() : c.agentProfileDefault}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs font-medium text-fg-muted">{c.workingDirectoryLabel}</dt>
                                <dd className="mt-1 break-all font-mono text-xs text-fg">
                                  {detailJob.workingDirectory?.trim()
                                    ? detailJob.workingDirectory.trim()
                                    : chatWorkingDirNotSet}
                                </dd>
                              </div>
                            </>
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
                          {detailJob.model?.trim() ? (
                            <div>
                              <dt className="text-xs font-medium text-fg-muted">{c.model}</dt>
                              <dd className="mt-1 font-mono text-sm text-fg">{detailJob.model.trim()}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </section>
                    </div>
                  </div>

                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={c.detailResizeColumns}
                    aria-valuemin={DETAIL_SPLIT_MIN_PERCENT}
                    aria-valuemax={DETAIL_SPLIT_MAX_PERCENT}
                    aria-valuenow={Math.round(splitPercent)}
                    tabIndex={0}
                    onPointerDown={onSplitResizePointerDown}
                    onKeyDown={onSplitResizeKeyDown}
                    className={cn(
                      'group hidden h-full cursor-col-resize touch-none select-none items-stretch justify-center rounded-lg outline-none lg:flex',
                      'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
                    )}
                  >
                    <span
                      className={cn(
                        'h-full w-px bg-edge-subtle transition-colors duration-150',
                        'group-hover:bg-edge',
                        splitResizing && 'bg-edge',
                      )}
                    />
                  </div>

                  <section className="rounded-2xl border border-edge bg-surface-base/35 p-4 lg:min-h-0 lg:overflow-y-auto">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-fg">{c.detailRunHistory}</h3>
                      {detailHistory.length > 0 ? (
                        <span className="text-xs text-fg-muted">{detailHistory.length}</span>
                      ) : null}
                    </div>
                    {detailHistory.length === 0 ? (
                      <div className="mt-2 rounded-xl border border-dashed border-edge-subtle px-4 py-8 text-center dark:border-edge-subtle">
                        <Clock className="mx-auto size-8 text-fg-disabled" strokeWidth={1.25} aria-hidden />
                        <p className="mt-2 text-sm text-fg-muted">{c.noRunsYet}</p>
                      </div>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {detailHistory.map((row) => (
                          <li key={row.id}>
                            <CronRunHistoryCard
                              row={row}
                              expanded={expandedRunId === row.id}
                              onToggle={() =>
                                setExpandedRunId((current) => (current === row.id ? null : row.id))
                              }
                              c={c}
                              statusLabels={statusLabels}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </div>
            ) : null}
          </div>

          {detailJob && !detailLoading ? (
            <div className="shrink-0 border-t border-edge px-4 py-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="gap-1.5"
                  onClick={() => onRunNow(detailJob)}
                >
                  <Play className="size-4" strokeWidth={1.75} aria-hidden />
                  {c.runNow}
                </Button>
                <Button type="button" variant="secondary" onClick={() => onEdit(detailJob)}>
                  {c.edit}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="ml-auto text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                  onClick={() => onDelete(detailJob)}
                >
                  <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                  {c.delete}
                </Button>
              </div>
            </div>
          ) : null}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
