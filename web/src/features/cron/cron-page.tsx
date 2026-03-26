import * as Dialog from '@radix-ui/react-dialog';
import {
  Clock,
  Edit,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ModelSelector } from '@/features/chat/model-selector';
import type { CronDelivery, CronJob, CronJobExecution, CronMetrics, CronRunHistoryRow } from '@/features/cron/cron-api';
import {
  addJob,
  cronJobBodyText,
  getAllRunsHistory,
  getChannels,
  getConfig,
  getHistory,
  getJob,
  getMetrics,
  getModels,
  getSessionChatIds,
  listJobs,
  removeJob,
  runJob,
  toggleJob,
  updateJob,
  type ChannelStatus,
  type CronPayload,
  type SessionChatId,
} from '@/features/cron/cron-api';
import {
  execStatusLabel,
  formatDeliveryToSummary,
  formatDuration,
  formatNextRun,
  formatRecipientOptionLabel,
  formatTime,
  truncate,
} from '@/features/cron/cron-utils';
import { nativeSelectMaxWidthClass, selectControlBaseClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const DEFAULT_SCHEDULE = '*/5 * * * *';

const CRON_PRESET_VALUES = new Set([
  '*/1 * * * *',
  DEFAULT_SCHEDULE,
  '*/10 * * * *',
  '*/15 * * * *',
  '*/30 * * * *',
  '0 * * * *',
  '0 */2 * * *',
  '0 */4 * * *',
  '0 */6 * * *',
  '0 */12 * * *',
  '0 0 * * *',
  '0 9 * * *',
  '0 21 * * *',
]);

function inputClassName(disabled?: boolean): string {
  return cn(
    'w-full rounded-md border border-edge bg-surface-base px-3 py-2 text-sm text-fg placeholder:text-fg-disabled',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
    disabled && 'cursor-not-allowed opacity-60',
  );
}

function selectClassName(): string {
  return cn(selectControlBaseClass, nativeSelectMaxWidthClass);
}

export function CronPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const c = m.cron;
  const chatM = m.chat;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [metrics, setMetrics] = useState<CronMetrics | null>(null);
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [sessionChatIds, setSessionChatIds] = useState<SessionChatId[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<CronRunHistoryRow[]>([]);
  const [runHistoryLoading, setRunHistoryLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [formJobId, setFormJobId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formSchedule, setFormSchedule] = useState(DEFAULT_SCHEDULE);
  const [formChannel, setFormChannel] = useState('local');
  const [formChatId, setFormChatId] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [formSessionTarget, setFormSessionTarget] = useState<'main' | 'isolated'>('main');
  const [formAgentLocalOnly, setFormAgentLocalOnly] = useState(false);
  const [formModel, setFormModel] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const formModelUserTouched = useRef(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailJob, setDetailJob] = useState<CronJob | null>(null);
  const [detailHistory, setDetailHistory] = useState<CronJobExecution[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'delete' | 'run' | null>(null);
  const [confirmJobId, setConfirmJobId] = useState<string | null>(null);

  const defaultModelForForm = useCallback(() => {
    return defaultModel || (availableModels.length > 0 ? availableModels[0].id : '');
  }, [defaultModel, availableModels]);

  const needsDeliveryChat =
    formChannel !== 'local' && (formSessionTarget === 'main' || (formSessionTarget === 'isolated' && !formAgentLocalOnly));

  const showChannelPicker =
    formSessionTarget === 'main' || (formSessionTarget === 'isolated' && !formAgentLocalOnly);

  const canSubmit =
    Boolean(formName.trim()) &&
    Boolean(formSchedule.trim()) &&
    Boolean(formMessage.trim()) &&
    (!needsDeliveryChat || Boolean(formChatId.trim()));

  const loadRunHistoryOnly = useCallback(async () => {
    setRunHistoryLoading(true);
    try {
      const rows = await getAllRunsHistory(30);
      setRunHistory(rows);
    } catch {
      /* ignore */
    } finally {
      setRunHistoryLoading(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, hist] = await Promise.all([listJobs(), getAllRunsHistory(30)]);
      setJobs(list);
      setRunHistory(hist);
    } catch (e) {
      setError(e instanceof Error ? e.message : c.failedToLoadJobs);
    } finally {
      setLoading(false);
    }
  }, [c.failedToLoadJobs]);

  const loadAux = useCallback(async () => {
    try {
      const [mres, ch, mods, cfg] = await Promise.all([
        getMetrics(),
        getChannels(),
        getModels(),
        getConfig(),
      ]);
      setMetrics(mres);
      setChannels(ch);
      setAvailableModels(mods);
      setDefaultModel(cfg.model || '');
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    if (!hasToken) return;
    void loadJobs();
    void loadAux();
  }, [hasToken, loadJobs, loadAux]);

  useEffect(() => {
    if (!formOpen || formMode !== 'add' || formModelUserTouched.current) return;
    const next = defaultModelForForm();
    if (next) setFormModel(next);
  }, [formOpen, formMode, defaultModelForForm]);

  useEffect(() => {
    if (!formOpen || formMode !== 'add') return;
    const valid = new Set(['local', ...channels.map((x) => x.name)]);
    if (!valid.has(formChannel)) setFormChannel('local');
  }, [channels, formChannel, formMode, formOpen]);

  useEffect(() => {
    if (formChannel === 'local') {
      setSessionChatIds([]);
      return;
    }
    let cancelled = false;
    void getSessionChatIds(formChannel).then((ids) => {
      if (!cancelled) setSessionChatIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [formChannel, formOpen]);

  const openForm = useCallback(
    (job?: CronJob) => {
      formModelUserTouched.current = false;
      setFormOpen(true);
      setFormMode(job ? 'edit' : 'add');
      setFormJobId(job?.id ?? null);

      if (job) {
        setFormName(job.name || '');
        setFormSchedule((job.schedule && String(job.schedule).trim()) || DEFAULT_SCHEDULE);
        const bodyText = cronJobBodyText(job);
        setFormMessage(bodyText ?? '');
        setFormSessionTarget(job.sessionTarget || 'main');
        const fromPayload =
          job.payload?.kind === 'agentTurn' && job.payload.model?.trim() ? job.payload.model.trim() : '';
        const stored = job.model?.trim() || fromPayload;
        setFormModel(stored || defaultModelForForm());
        const hasLocalChannel = job.delivery?.channel === 'local';
        const agentLocalOnly =
          (job.sessionTarget || 'main') === 'isolated' &&
          !hasLocalChannel &&
          (!job.delivery?.to || job.delivery.mode === 'none');
        setFormAgentLocalOnly(agentLocalOnly);

        if (hasLocalChannel) {
          setFormChannel('local');
          setFormChatId('');
        } else if (job.delivery && job.delivery.mode !== 'none' && job.delivery.to) {
          setFormChannel(job.delivery.channel || 'telegram');
          setFormChatId(job.delivery.to || '');
        } else if (!agentLocalOnly) {
          const parts = bodyText.split(':');
          const knownChannels = ['telegram', 'cli', 'gateway', 'local'];
          if (parts.length >= 3 && knownChannels.includes(parts[0])) {
            setFormChannel(parts[0]);
            setFormChatId(parts[1]);
            setFormMessage(parts.slice(2).join(':'));
          } else {
            setFormChannel('telegram');
            setFormChatId('');
          }
        } else {
          setFormChannel('telegram');
          setFormChatId('');
        }
      } else {
        setFormName('');
        setFormSchedule(DEFAULT_SCHEDULE);
        setFormChannel('local');
        setFormChatId('');
        setFormMessage('');
        setFormSessionTarget('main');
        setFormAgentLocalOnly(false);
        setFormModel(defaultModelForForm());
      }
    },
    [defaultModelForForm],
  );

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setFormMode('add');
    setFormJobId(null);
    setFormName('');
    setFormSchedule(DEFAULT_SCHEDULE);
    setFormChannel('local');
    setFormChatId('');
    setFormMessage('');
    setFormSessionTarget('main');
    setFormAgentLocalOnly(false);
    setFormModel('');
    formModelUserTouched.current = false;
  }, []);

  const submitForm = async () => {
    if (!formName.trim()) {
      setError(c.nameRequired);
      return;
    }
    if (!formSchedule.trim() || !formMessage.trim()) {
      setError(c.scheduleRequired);
      return;
    }
    if (needsDeliveryChat && !formChatId.trim()) {
      setError(c.chatIdRequired);
      return;
    }

    setFormSubmitting(true);
    setError(null);
    try {
      const message = formMessage.trim();
      let delivery: CronDelivery;
      if (formSessionTarget === 'isolated' && formAgentLocalOnly) {
        delivery = { mode: 'none' };
      } else if (formChannel === 'local') {
        delivery = { mode: 'direct', channel: 'local' };
      } else {
        delivery = { mode: 'direct', channel: formChannel, to: formChatId.trim() };
      }

      const payload: CronPayload =
        formSessionTarget === 'isolated'
          ? {
              kind: 'agentTurn',
              message,
              ...(formModel.trim() ? { model: formModel.trim() } : {}),
            }
          : { kind: 'systemEvent', text: message };

      const modelTrimmed = formModel.trim();
      const jobData = {
        name: formName.trim(),
        schedule: formSchedule.trim(),
        sessionTarget: formSessionTarget,
        model: formSessionTarget === 'isolated' && modelTrimmed ? modelTrimmed : undefined,
        delivery,
        payload,
      };

      if (formMode === 'edit' && formJobId) {
        await updateJob(formJobId, jobData);
      } else {
        const { schedule: sched, ...rest } = jobData;
        await addJob(sched, rest);
      }
      closeForm();
      await loadJobs();
      await loadAux();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : formMode === 'edit'
            ? c.failedToUpdateJob
            : c.failedToCreateJob,
      );
    } finally {
      setFormSubmitting(false);
    }
  };

  const openDetail = async (job: CronJob) => {
    setDetailOpen(true);
    setDetailJob(job);
    setDetailLoading(true);
    setDetailHistory([]);
    try {
      const full = await getJob(job.id);
      if (full) {
        setDetailJob(full);
        setDetailHistory(await getHistory(job.id, 20));
      }
    } catch {
      /* keep partial */
    } finally {
      setDetailLoading(false);
    }
  };

  const onToggle = async (job: CronJob, enabled: boolean) => {
    try {
      await toggleJob(job.id, enabled);
      await loadJobs();
      await loadAux();
    } catch (e) {
      setError(e instanceof Error ? e.message : c.failedToToggleJob);
    }
  };

  const runConfirm = async () => {
    if (!confirmJobId || !confirmAction) return;
    const id = confirmJobId;
    const action = confirmAction;
    setConfirmOpen(false);
    setConfirmJobId(null);
    setConfirmAction(null);
    try {
      if (action === 'run') {
        await runJob(id);
      } else {
        await removeJob(id);
        if (detailJob?.id === id) {
          setDetailOpen(false);
          setDetailJob(null);
        }
      }
      await loadJobs();
      await loadAux();
      await loadRunHistoryOnly();
    } catch (e) {
      setError(e instanceof Error ? e.message : c.actionFailed);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (formOpen) closeForm();
      else if (detailOpen) {
        setDetailOpen(false);
        setDetailJob(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [formOpen, detailOpen, closeForm]);

  if (!hasToken) {
    return (
      <div className="mx-auto w-full max-w-app-main px-4 py-16 text-center text-sm text-fg-muted sm:px-8">{c.needToken}</div>
    );
  }

  const schedulePresetSelectValue = useMemo(
    () => (CRON_PRESET_VALUES.has(formSchedule) ? formSchedule : ''),
    [formSchedule],
  );

  const nextMetricRun = metrics?.nextScheduledJob?.runAt
    ? formatNextRun(metrics.nextScheduledJob.runAt, c.timeLabels)
    : '—';

  const statusLabels = {
    running: c.execStatusRunning,
    success: c.execStatusSuccess,
    failed: c.execStatusFailed,
    cancelled: c.execStatusCancelled,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-panel">
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6 sm:px-8">
        {error ? (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-base text-fg-muted dark:bg-surface-hover/40"
              aria-hidden
            >
              <Clock className="size-5" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-fg">{c.title}</h1>
              <p className="mt-1 text-sm text-fg-muted">{c.subtitle}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-9 shrink-0 p-0"
              disabled={loading}
              title={c.refresh}
              aria-label={c.refresh}
              onClick={() => void loadJobs()}
            >
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} strokeWidth={1.75} />
            </Button>
            <Button type="button" variant="primary" className="gap-2" onClick={() => openForm()}>
              <Plus className="size-4" strokeWidth={1.75} />
              {c.addJob}
            </Button>
          </div>
        </header>

        {metrics ? (
          <section
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            role="region"
            aria-label={c.statsRegion}
          >
            <div className="rounded-xl bg-surface-base px-4 py-3 dark:bg-surface-hover/30">
              <div className="text-2xl font-semibold tabular-nums text-fg">{metrics.totalJobs}</div>
              <div className="text-xs font-medium text-fg-muted">{c.totalJobs}</div>
            </div>
            <div className="rounded-xl bg-surface-base px-4 py-3 dark:bg-surface-hover/30">
              <div className="text-2xl font-semibold tabular-nums text-fg">{metrics.enabledJobs}</div>
              <div className="text-xs font-medium text-fg-muted">{c.enabled}</div>
            </div>
            <div className="rounded-xl bg-surface-base px-4 py-3 dark:bg-surface-hover/30">
              <div className="text-2xl font-semibold tabular-nums text-fg">{metrics.runningJobs}</div>
              <div className="text-xs font-medium text-fg-muted">{c.running}</div>
            </div>
            <div className="col-span-2 rounded-xl bg-surface-base px-4 py-3 sm:col-span-1 dark:bg-surface-hover/30">
              <div className="truncate text-sm font-medium text-fg-muted">{nextMetricRun}</div>
              <div className="text-xs font-medium text-fg-muted">{c.nextRun}</div>
            </div>
          </section>
        ) : null}

        <section aria-labelledby="cron-jobs-heading">
          <div className="mb-3 flex items-center gap-2">
            <h2 id="cron-jobs-heading" className="text-base font-semibold text-fg">
              {c.jobsHeading}
            </h2>
            {jobs.length > 0 ? (
              <span className="rounded-md bg-surface-hover px-2 py-0.5 text-xs font-medium text-fg-muted">
                {jobs.length}
              </span>
            ) : null}
          </div>

          {loading && jobs.length === 0 ? (
            <div className="flex justify-center py-16" aria-busy="true">
              <Loader2 className="size-8 animate-spin text-accent" strokeWidth={1.75} />
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl bg-surface-base px-6 py-14 text-center dark:bg-surface-hover/25">
              <Clock className="mb-3 size-10 text-fg-disabled" strokeWidth={1.25} aria-hidden />
              <h3 className="text-base font-semibold text-fg">{c.emptyStateTitle}</h3>
              <p className="mt-2 max-w-md text-sm text-fg-muted">{c.emptyStateHint}</p>
              <Button type="button" variant="primary" className="mt-6" onClick={() => openForm()}>
                {c.emptyStateCta}
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {jobs.map((job) => (
                <article
                  key={job.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'flex cursor-pointer flex-col rounded-xl bg-surface-base text-left transition-colors duration-150 ease-out',
                    'hover:bg-surface-hover',
                    interaction.press,
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
                  )}
                  onClick={() => void openDetail(job)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void openDetail(job);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2 border-b border-edge-subtle/90 bg-surface-hover/30 px-4 py-3 dark:border-edge-subtle">
                    <h3 className="min-w-0 truncate font-semibold text-fg">{job.name || job.id}</h3>
                    <span
                      className={cn(
                        'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium',
                        job.enabled
                          ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                          : 'bg-surface-hover text-fg-muted',
                      )}
                    >
                      {job.enabled ? c.enabled : c.disabled}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-2 px-4 py-3 text-sm">
                    {job.name ? (
                      <p className="font-mono text-xs text-fg-muted">
                        <code>{job.id}</code>
                      </p>
                    ) : null}
                    <div>
                      <span className="text-xs text-fg-muted">{c.scheduleLabel}</span>
                      <code className="mt-0.5 block truncate rounded bg-surface-hover px-2 py-1 font-mono text-xs text-fg">
                        {job.schedule}
                      </code>
                    </div>
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-fg-muted">{c.nextRun}</span>
                      <span className="text-fg">
                        {job.next_run ? formatNextRun(job.next_run, c.timeLabels) : '—'}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-xs text-fg-muted" title={cronJobBodyText(job)}>
                      {truncate(cronJobBodyText(job), 120)}
                    </p>
                  </div>
                  <div
                    className="flex items-center justify-between gap-2 border-t border-edge-subtle/90 bg-surface-hover/20 px-4 py-2 dark:border-edge-subtle"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
                      <input
                        type="checkbox"
                        className="ui-checkbox"
                        checked={job.enabled}
                        onChange={(e) => void onToggle(job, e.target.checked)}
                        aria-label={c.enabled}
                      />
                    </label>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        title={c.edit}
                        aria-label={c.edit}
                        onClick={() => openForm(job)}
                      >
                        <Edit className="size-4" strokeWidth={1.75} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        title={c.runNow}
                        aria-label={c.runNow}
                        onClick={() => {
                          setConfirmAction('run');
                          setConfirmJobId(job.id);
                          setConfirmOpen(true);
                        }}
                      >
                        <Play className="size-4" strokeWidth={1.75} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
                        title={c.delete}
                        aria-label={c.delete}
                        onClick={() => {
                          setConfirmAction('delete');
                          setConfirmJobId(job.id);
                          setConfirmOpen(true);
                        }}
                      >
                        <Trash2 className="size-4" strokeWidth={1.75} />
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-surface-base dark:bg-surface-hover/20">
          <div className="flex items-start justify-between gap-2 border-b border-edge-subtle px-4 py-3 dark:border-edge-subtle">
            <div>
              <h2 className="text-base font-semibold text-fg">{c.runHistoryTitle}</h2>
              <p className="mt-1 text-xs text-fg-muted">{c.runHistoryHint}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-9 shrink-0 p-0"
              disabled={runHistoryLoading}
              title={c.refresh}
              aria-label={c.refresh}
              onClick={() => void loadRunHistoryOnly()}
            >
              <RefreshCw className={cn('size-4', runHistoryLoading && 'animate-spin')} strokeWidth={1.75} />
            </Button>
          </div>
          <div className="overflow-x-auto p-2">
            {runHistoryLoading && runHistory.length === 0 ? (
              <div className="flex justify-center py-12">
                <Loader2 className="size-6 animate-spin text-accent" strokeWidth={1.75} />
              </div>
            ) : runHistory.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-fg-muted">{c.noRunsYet}</p>
            ) : (
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-edge text-xs font-medium text-fg-muted">
                    <th className="px-2 py-2 font-medium">{c.colStarted}</th>
                    <th className="px-2 py-2 font-medium">{c.colJob}</th>
                    <th className="px-2 py-2 font-medium">{c.status}</th>
                    <th className="px-2 py-2 font-medium">{c.colDuration}</th>
                    <th className="px-2 py-2 font-medium">{c.colDetail}</th>
                  </tr>
                </thead>
                <tbody>
                  {runHistory.map((row) => (
                    <tr key={row.id} className="border-b border-edge/60 last:border-0">
                      <td className="whitespace-nowrap px-2 py-2 text-fg">
                        <time dateTime={row.startedAt}>{formatTime(row.startedAt)}</time>
                      </td>
                      <td className="max-w-[10rem] truncate px-2 py-2">
                        {jobs.some((j) => j.id === row.jobId) ? (
                          <button
                            type="button"
                            className="text-left text-accent hover:underline"
                            onClick={() => {
                              const j = jobs.find((x) => x.id === row.jobId);
                              if (j) void openDetail(j);
                            }}
                          >
                            {row.jobName || row.jobId}
                          </button>
                        ) : (
                          <span className="text-fg-muted">{row.jobName || row.jobId}</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
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
                      <td className="whitespace-nowrap px-2 py-2 text-fg-muted">
                        {formatDuration(row.duration)}
                      </td>
                      <td
                        className="max-w-xs truncate px-2 py-2 text-fg-muted"
                        title={row.summary || row.error || ''}
                      >
                        {truncate(row.summary || row.error, 96)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {/* Form dialog */}
      <Dialog.Root open={formOpen} onOpenChange={(o) => !o && closeForm()}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
            <Dialog.Content
              className="xopcbot-dialog-content-pane pointer-events-auto relative flex max-h-[min(90vh,800px)] w-full max-w-md flex-col rounded-xl border border-edge bg-surface-panel shadow-xl outline-none dark:border-edge"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3">
              <Dialog.Title className="text-base font-semibold text-fg">
                {formMode === 'edit' ? c.editJob : c.addJob}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="h-9 w-9 shrink-0 p-0" aria-label={c.close}>
                  <X className="size-5" strokeWidth={1.75} />
                </Button>
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-fg-muted">{c.name}</span>
                  <input
                    type="text"
                    className={inputClassName()}
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder={c.namePlaceholder}
                  />
                </label>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-fg-muted">{c.schedule}</span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                      value={formSchedule}
                      onChange={(e) => setFormSchedule(e.target.value)}
                      placeholder="*/5 * * * *"
                    />
                    <select
                      className={cn(selectClassName(), 'max-w-[11rem] shrink-0 text-xs')}
                      value={schedulePresetSelectValue}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) setFormSchedule(v);
                      }}
                    >
                      <option value="">{c.schedulePresets.custom}</option>
                      <option value="*/1 * * * *">{c.schedulePresets.everyMinute}</option>
                      <option value="*/5 * * * *">{c.schedulePresets.every5Minutes}</option>
                      <option value="*/10 * * * *">{c.schedulePresets.every10Minutes}</option>
                      <option value="*/15 * * * *">{c.schedulePresets.every15Minutes}</option>
                      <option value="*/30 * * * *">{c.schedulePresets.every30Minutes}</option>
                      <option value="0 * * * *">{c.schedulePresets.everyHour}</option>
                      <option value="0 */2 * * *">{c.schedulePresets.every2Hours}</option>
                      <option value="0 */4 * * *">{c.schedulePresets.every4Hours}</option>
                      <option value="0 */6 * * *">{c.schedulePresets.every6Hours}</option>
                      <option value="0 */12 * * *">{c.schedulePresets.every12Hours}</option>
                      <option value="0 0 * * *">{c.schedulePresets.everyDayMidnight}</option>
                      <option value="0 9 * * *">{c.schedulePresets.everyDay9AM}</option>
                      <option value="0 21 * * *">{c.schedulePresets.everyDay9PM}</option>
                    </select>
                  </div>
                  <p className="text-xs text-fg-muted">{c.scheduleHintPreset}</p>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-fg-muted">{c.mode}</span>
                  <select
                    className={selectClassName()}
                    value={formSessionTarget}
                    onChange={(e) => {
                      const v = e.target.value as 'main' | 'isolated';
                      setFormSessionTarget(v);
                      if (v === 'main') setFormAgentLocalOnly(false);
                      else if (v === 'isolated' && !formModel.trim()) setFormModel(defaultModelForForm());
                    }}
                  >
                    <option value="main">{c.modeDirectOption}</option>
                    <option value="isolated">{c.modeAgentOption}</option>
                  </select>
                  <p className="text-xs text-fg-muted">
                    {formSessionTarget === 'main' ? c.modeDirect : c.modeAgent}
                  </p>
                </label>
                {formSessionTarget === 'isolated' ? (
                  <>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-fg-muted">{c.model}</span>
                      <ModelSelector
                        value={formModel}
                        placeholder={chatM.modelPlaceholder}
                        searchPlaceholder={chatM.modelSearchPlaceholder}
                        noMatches={chatM.modelNoMatches}
                        onChange={(id) => {
                          formModelUserTouched.current = true;
                          setFormModel(id);
                        }}
                      />
                    </div>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md bg-surface-hover/45 px-3 py-2 dark:bg-surface-hover/30">
                      <input
                        type="checkbox"
                        className={cn('ui-checkbox', 'mt-0.5')}
                        checked={formAgentLocalOnly}
                        onChange={(e) => setFormAgentLocalOnly(e.target.checked)}
                      />
                      <span>
                        <span className="text-sm font-medium text-fg">{c.agentLocalOnly}</span>
                        <p className="mt-1 text-xs text-fg-muted">{c.agentLocalOnlyHint}</p>
                      </span>
                    </label>
                  </>
                ) : null}
                {showChannelPicker ? (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-fg-muted">{c.channel}</span>
                      <select
                        className={selectClassName()}
                        value={formChannel}
                        onChange={(e) => {
                          const v = e.target.value;
                          setFormChannel(v);
                          if (v === 'local') setFormAgentLocalOnly(false);
                          setFormChatId('');
                        }}
                      >
                        <option value="local">{c.channelLocal}</option>
                        {channels.map((ch) => (
                          <option key={ch.name} value={ch.name} disabled={!ch.enabled}>
                            {ch.name} {!ch.enabled ? '(disabled)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    {needsDeliveryChat ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-fg-muted">{c.recipient}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-7 gap-1 px-2 text-xs"
                            title={c.refreshRecipientHint}
                            onClick={() => void getSessionChatIds(formChannel).then(setSessionChatIds)}
                          >
                            <RefreshCw className="size-3.5" strokeWidth={1.75} />
                            {c.refreshList}
                          </Button>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            className={cn(inputClassName(), 'min-w-0 flex-1')}
                            value={formChatId}
                            onChange={(e) => setFormChatId(e.target.value)}
                            placeholder={c.recipientPlaceholder}
                          />
                          <select
                            className={cn(selectClassName(), 'max-w-[10rem] shrink-0 text-xs')}
                            value={formChatId}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v) setFormChatId(v);
                            }}
                          >
                            <option value="">{c.selectRecipient}</option>
                            {sessionChatIds.length > 0 ? (
                              sessionChatIds.map((item) => (
                                <option key={`${item.channel}-${item.chatId}`} value={item.chatId}>
                                  {formatRecipientOptionLabel(item, c.lastActiveLabels)}
                                </option>
                              ))
                            ) : (
                              <option value="" disabled>
                                {c.noRecentChatsOption}
                              </option>
                            )}
                          </select>
                        </div>
                        <p className="text-xs text-fg-muted">
                          {sessionChatIds.length > 0 ? c.enterManuallyOrSelect : c.noRecentChats}
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-fg-muted">{c.message}</span>
                  <textarea
                    className={cn(inputClassName(), 'min-h-[5rem] resize-y')}
                    value={formMessage}
                    onChange={(e) => setFormMessage(e.target.value)}
                    placeholder={c.messagePlaceholder}
                    rows={4}
                  />
                </label>
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-4 py-3">
              <Button type="button" variant="secondary" onClick={closeForm}>
                {c.cancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={formSubmitting || !canSubmit}
                onClick={() => void submitForm()}
              >
                {formSubmitting ? c.loading : formMode === 'edit' ? c.save : c.create}
              </Button>
            </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Detail drawer */}
      <Dialog.Root
        open={detailOpen}
        onOpenChange={(o) => {
          if (!o) {
            setDetailOpen(false);
            setDetailJob(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content
            className={cn(
              'xopcbot-drawer-right fixed right-0 top-0 z-[60] flex h-full w-full max-w-lg flex-col border-l border-edge bg-surface-panel shadow-xl outline-none',
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
                      <dd className="mt-1 break-words text-fg">{cronJobBodyText(detailJob)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-fg-muted">{c.mode}</dt>
                      <dd className="mt-1 text-fg">
                        {detailJob.sessionTarget === 'isolated' ? c.modeAgentOption : c.modeDirectOption}
                      </dd>
                    </div>
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
                            <th className="py-1.5 font-medium">{c.colDetail}</th>
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
                                className="max-w-[8rem] truncate py-1.5 text-fg-muted"
                                title={row.summary || row.error || ''}
                              >
                                {truncate(row.summary || row.error, 120)}
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

      {/* Confirm run/delete */}
      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-[70] bg-scrim" />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
            <Dialog.Content className="xopcbot-dialog-content-pane pointer-events-auto relative w-full max-w-md rounded-xl border border-edge bg-surface-panel p-4 shadow-xl dark:border-edge">
            <Dialog.Title className="text-base font-semibold text-fg">
              {confirmAction === 'delete' ? c.delete : c.runNow}
            </Dialog.Title>
            <p className="mt-2 text-sm text-fg-muted">
              {confirmAction === 'delete' ? c.confirmDelete : c.confirmRun}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmJobId(null);
                  setConfirmAction(null);
                }}
              >
                {c.cancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                className={confirmAction === 'delete' ? 'bg-red-600 hover:bg-red-700' : undefined}
                onClick={() => void runConfirm()}
              >
                {confirmAction === 'delete' ? c.delete : c.runNow}
              </Button>
            </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
