import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitBranch,
  MessageSquare,
  PauseCircle,
  RotateCw,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { showToast } from '@/lib/toast';
import { useLocaleStore } from '@/stores/locale-store';

import {
  automationApi,
  type AutomationProductEventRun,
  type AutomationRepairDraft,
  type AutomationRun,
} from './automation-api';
import { buildRunExplanation } from './automation-explanations';

type Props = {
  eventType: string;
  source?: string;
  payloadKey?: string;
  payloadValue?: string;
  limit?: number;
  className?: string;
  onSaveInsight?: (run: AutomationRun) => Promise<void> | void;
  isInsightSaved?: (run: AutomationRun) => boolean;
};

type FeedbackHealth = {
  total: number;
  succeeded: number;
  active: number;
  attention: number;
  recovered: number;
  latestAttentionRun?: AutomationRun;
};

function statusClass(status: AutomationRun['status']): string {
  if (status === 'succeeded') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed' || status === 'timeout') return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300';
  if (status === 'cancelled') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300';
}

function formatDate(ms: number, locale: string): string {
  return new Date(ms).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function hasActiveRun(items: AutomationProductEventRun[]): boolean {
  return items.some((item) => item.run.status === 'queued' || item.run.status === 'running');
}

function canSuggestRepair(status: AutomationRun['status']): boolean {
  return status === 'failed' || status === 'timeout' || status === 'cancelled';
}

function buildHealth(items: AutomationProductEventRun[]): FeedbackHealth {
  const grouped = new Map<string, { latest: AutomationRun; hadAttention: boolean }>();
  for (const { run } of items) {
    const current = grouped.get(run.automationId);
    const latest = !current || run.createdAtMs > current.latest.createdAtMs ? run : current.latest;
    grouped.set(run.automationId, {
      latest,
      hadAttention: Boolean(current?.hadAttention) || canSuggestRepair(run.status),
    });
  }
  const health: FeedbackHealth = {
    total: grouped.size,
    succeeded: 0,
    active: 0,
    attention: 0,
    recovered: 0,
  };
  for (const { latest: run, hadAttention } of grouped.values()) {
    if (run.status === 'succeeded') health.succeeded += 1;
    if (run.status === 'succeeded' && hadAttention) health.recovered += 1;
    if (run.status === 'queued' || run.status === 'running') health.active += 1;
    if (canSuggestRepair(run.status)) {
      health.attention += 1;
      health.latestAttentionRun ??= run;
    }
  }
  return health;
}

function buildLatestRunByAutomation(items: AutomationProductEventRun[]): Map<string, AutomationRun> {
  const latest = new Map<string, AutomationRun>();
  for (const { run } of items) {
    const current = latest.get(run.automationId);
    if (!current || run.createdAtMs > current.createdAtMs) latest.set(run.automationId, run);
  }
  return latest;
}

function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function AutomationHealthSummary({
  health,
  labels,
  primaryRepairBusy,
  onPrimaryRepair,
}: {
  health: FeedbackHealth;
  labels: ReturnType<typeof messages>['automations'];
  primaryRepairBusy: boolean;
  onPrimaryRepair?: () => void;
}) {
  const needsAttention = health.attention > 0;
  const hasActive = health.active > 0;
  const hasRecovered = health.recovered > 0;
  const summary = needsAttention
    ? formatMessage(labels.feedback.summaryNeedsAttention, {
      total: health.total,
      attention: health.attention,
      name: health.latestAttentionRun?.automationName ?? labels.feedback.thisAutomation,
    })
    : hasActive
      ? formatMessage(labels.feedback.summaryRunning, {
        total: health.total,
        active: health.active,
      })
      : hasRecovered
        ? formatMessage(labels.feedback.summaryRecovered, {
          total: health.total,
          recovered: health.recovered,
          succeeded: health.succeeded,
        })
      : formatMessage(labels.feedback.summaryHealthy, {
        total: health.total,
        succeeded: health.succeeded,
      });

  return (
    <div className="mb-3 border-l-2 border-accent/50 pl-3">
      <p className={cn(
        'break-words text-xs leading-5',
        needsAttention ? 'text-amber-800 dark:text-amber-200' : 'text-fg-muted',
      )}>
        {summary}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {health.succeeded ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3" aria-hidden />
            {formatMessage(labels.feedback.succeededCount, { count: health.succeeded })}
          </span>
        ) : null}
        {health.active ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300">
            <Clock3 className="size-3" aria-hidden />
            {formatMessage(labels.feedback.activeCount, { count: health.active })}
          </span>
        ) : null}
        {health.attention ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3" aria-hidden />
            {formatMessage(labels.feedback.attentionCount, { count: health.attention })}
          </span>
        ) : null}
        {health.recovered ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3" aria-hidden />
            {formatMessage(labels.feedback.recoveredCount, { count: health.recovered })}
          </span>
        ) : null}
      </div>
      {needsAttention && onPrimaryRepair ? (
        <div className="mt-2">
          <Button
            variant="secondary"
            className="h-7 rounded-md px-2 text-xs"
            disabled={primaryRepairBusy}
            onClick={onPrimaryRepair}
          >
            <Sparkles className="size-3.5" aria-hidden />
            {primaryRepairBusy ? labels.feedback.primaryRepairing : labels.feedback.primaryRepair}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ProductAutomationFeedback({
  eventType,
  source,
  payloadKey,
  payloadValue,
  limit = 3,
  className,
  onSaveInsight,
  isInsightSaved,
}: Props) {
  const language = useLocaleStore((s) => s.language);
  const labels = messages(language).automations;
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const swrKey = [
    'product-automation-feedback',
    eventType,
    source ?? '',
    payloadKey ?? '',
    payloadValue ?? '',
    limit,
  ];
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const { data, mutate } = useSWR(
    eventType && (!payloadKey || payloadValue !== undefined) ? swrKey : null,
    () => automationApi.productEventRuns({ eventType, source, payloadKey, payloadValue, limit }),
    {
      revalidateOnFocus: false,
      refreshInterval: (latest) => (latest?.items && hasActiveRun(latest.items) ? 3000 : 15000),
    },
  );
  const [repairDrafts, setRepairDrafts] = useState<Record<string, AutomationRepairDraft>>({});
  const [repairApprovals, setRepairApprovals] = useState<Record<string, boolean>>({});
  const items = data?.items ?? [];
  const health = buildHealth(items);
  const latestRunByAutomation = buildLatestRunByAutomation(items);

  if (!items.length) return null;

  const runAction = async (
    actionKey: string,
    action: () => Promise<unknown>,
  ) => {
    setBusyAction(actionKey);
    try {
      await action();
      await mutate();
    } catch (error) {
      showToast({
        type: 'error',
        title: labels.feedback.actionFailed,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const suggestRepair = async (run: AutomationRun) => {
    setBusyAction(`${run.id}:repair`);
    try {
      const result = await automationApi.repairDraft(run.id, { language });
      setRepairDrafts((current) => ({ ...current, [run.id]: result.repair }));
      setRepairApprovals((current) => ({ ...current, [run.id]: false }));
    } catch (error) {
      showToast({
        type: 'error',
        title: labels.feedback.actionFailed,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const applyRepair = async (run: AutomationRun, repair: AutomationRepairDraft, rerunAfterApply = false) => {
    setBusyAction(rerunAfterApply ? `${run.id}:applyAndRerun` : `${run.id}:applyRepair`);
    try {
      await automationApi.update(run.automationId, repair.patch);
      if (rerunAfterApply) {
        await automationApi.rerun(run.id);
      }
      await mutate();
      setRepairDrafts((current) => {
        const next = { ...current };
        delete next[run.id];
        return next;
      });
      setRepairApprovals((current) => {
        const next = { ...current };
        delete next[run.id];
        return next;
      });
    } catch (error) {
      showToast({
        type: 'error',
        title: labels.feedback.actionFailed,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const primaryRepairRun = health.latestAttentionRun && !repairDrafts[health.latestAttentionRun.id]
    ? health.latestAttentionRun
    : undefined;
  const primaryRepairBusy = primaryRepairRun ? busyAction === `${primaryRepairRun.id}:repair` : false;

  return (
    <section className={cn('rounded-lg border border-edge bg-surface-panel p-3', className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
          <Zap className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="truncate">{labels.feedback.title}</span>
        </h3>
        <span className="shrink-0 text-xs text-fg-muted">{items.length}</span>
      </div>
      <AutomationHealthSummary
        health={health}
        labels={labels}
        primaryRepairBusy={primaryRepairBusy}
        onPrimaryRepair={primaryRepairRun ? () => void suggestRepair(primaryRepairRun) : undefined}
      />
      <ul className="grid gap-2">
        {items.map(({ run, triggerEvent }) => {
          const latestRun = latestRunByAutomation.get(run.automationId);
          const isLatestForAutomation = latestRun?.id === run.id;
          const isHistoricalAttention = canSuggestRepair(run.status) && !isLatestForAutomation;
          const isRecoveredHistoricalAttention = isHistoricalAttention && latestRun?.status === 'succeeded';
          const repair = repairDrafts[run.id];
          const repairApproved = repairApprovals[run.id] ?? false;
          const repairBusy = busyAction === `${run.id}:repair`;
          const applyRepairBusy = busyAction === `${run.id}:applyRepair`;
          const applyAndRerunBusy = busyAction === `${run.id}:applyAndRerun`;
          const runExplanation = buildRunExplanation(run, triggerEvent, labels);
          const insightSaved = isInsightSaved?.(run) ?? false;
          const canSaveInsight = run.status === 'succeeded' && Boolean(run.summary) && Boolean(onSaveInsight) && !insightSaved;
          const saveInsightBusy = busyAction === `${run.id}:saveInsight`;
          return (
            <li key={run.id} className="rounded-md border border-edge/70 bg-surface-muted/35 px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Bot className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
                    <p className="truncate text-sm font-medium text-fg">{run.automationName}</p>
                  </div>
                  <p className="mt-1 line-clamp-2 break-words text-xs text-fg-muted">
                    {run.error || run.summary || triggerEvent.message}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={cn('rounded-full border px-2 py-0.5 text-xs', statusClass(run.status))}>
                    {labels.status[run.status]}
                  </span>
                  {isHistoricalAttention ? (
                    <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                      {isRecoveredHistoricalAttention ? labels.feedback.recovered : labels.feedback.historical}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-fg-muted">
                <span className="inline-flex min-w-0 items-center gap-1">
                  <Activity className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{formatDate(triggerEvent.createdAtMs, locale)}</span>
                </span>
              </div>
              <div className="mt-2 rounded-md border border-edge/60 bg-surface-base/45 px-2.5 py-2">
                <div className="text-xs font-medium text-fg">{labels.explain.whyRan}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {runExplanation.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-edge/70 bg-surface-panel px-2 py-0.5 text-xs text-fg-muted"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
              {repair ? (
                <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200">
                    <Sparkles className="size-3.5" aria-hidden />
                    {labels.repair.title}
                  </div>
                  <p className="mt-1 break-words text-xs text-fg">{repair.explanation}</p>
                  {repair.expectedEffect ? (
                    <p className="mt-1 break-words text-xs text-fg-muted">{repair.expectedEffect}</p>
                  ) : null}
                  {repair.risks.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-fg-muted">
                      {repair.risks.slice(0, 3).map((risk) => <li key={risk}>{risk}</li>)}
                    </ul>
                  ) : null}
                  {repair.requiresApproval ? (
                    <label className="mt-2 flex items-start gap-2 text-xs text-fg">
                      <input
                        className="mt-0.5"
                        type="checkbox"
                        checked={repairApproved}
                        onChange={(event) => {
                          setRepairApprovals((current) => ({
                            ...current,
                            [run.id]: event.target.checked,
                          }));
                        }}
                      />
                      <span>{labels.repair.approval}</span>
                    </label>
                  ) : null}
                  <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                    <Button
                      variant="ghost"
                      className="h-7 rounded-md px-2 text-xs"
                      onClick={() => {
                        setRepairDrafts((current) => {
                          const next = { ...current };
                          delete next[run.id];
                          return next;
                        });
                      }}
                    >
                      {labels.draft.discard}
                    </Button>
                    <Button
                      variant="secondary"
                      className="h-7 rounded-md px-2 text-xs"
                      disabled={(repair.requiresApproval && !repairApproved) || busyAction !== null}
                      onClick={() => void applyRepair(run, repair)}
                    >
                      {applyRepairBusy ? labels.feedback.working : labels.repair.apply}
                    </Button>
                    <Button
                      variant="primary"
                      className="h-7 rounded-md px-2 text-xs"
                      disabled={(repair.requiresApproval && !repairApproved) || busyAction !== null}
                      onClick={() => void applyRepair(run, repair, true)}
                    >
                      <RotateCw className="size-3.5" aria-hidden />
                      {applyAndRerunBusy ? labels.feedback.working : labels.feedback.applyAndRerun}
                    </Button>
                  </div>
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {insightSaved ? (
                  <span className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 text-xs text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    {labels.feedback.savedInsight}
                  </span>
                ) : null}
                {canSaveInsight ? (
                  <Button
                    variant="secondary"
                    className="h-7 rounded-md px-2 text-xs"
                    disabled={busyAction !== null}
                    onClick={() => void runAction(
                      `${run.id}:saveInsight`,
                      () => Promise.resolve(onSaveInsight!(run)),
                    )}
                  >
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    {saveInsightBusy ? labels.feedback.savingInsight : labels.feedback.saveInsight}
                  </Button>
                ) : null}
                {run.sessionKey ? (
                  <Button asChild variant="ghost" className="h-7 rounded-md px-2 text-xs">
                    <Link to={`/chat/${encodeURIComponent(run.sessionKey)}`}>
                      <MessageSquare className="size-3.5" aria-hidden />
                      {labels.feedback.chat}
                    </Link>
                  </Button>
                ) : null}
                {run.workflowRunId ? (
                  <Button asChild variant="ghost" className="h-7 rounded-md px-2 text-xs">
                    <Link to={`/workflows?run=${encodeURIComponent(run.workflowRunId)}`}>
                      <GitBranch className="size-3.5" aria-hidden />
                      {labels.feedback.workflow}
                    </Link>
                  </Button>
                ) : null}
                {isLatestForAutomation && canSuggestRepair(run.status) && !repair ? (
                  <Button
                    variant="ghost"
                    className="h-7 rounded-md px-2 text-xs"
                    disabled={busyAction !== null}
                    onClick={() => void suggestRepair(run)}
                  >
                    <Sparkles className="size-3.5" aria-hidden />
                    {repairBusy ? labels.repair.generating : labels.repair.suggest}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  className="h-7 rounded-md px-2 text-xs"
                  disabled={busyAction !== null}
                  onClick={() => void runAction(
                    `${run.id}:rerun`,
                    () => automationApi.rerun(run.id),
                  )}
                >
                  <RotateCw className="size-3.5" aria-hidden />
                  {busyAction === `${run.id}:rerun` ? labels.feedback.working : labels.feedback.rerun}
                </Button>
                <Button
                  variant="ghost"
                  className="h-7 rounded-md px-2 text-xs"
                  disabled={busyAction !== null}
                  onClick={() => void runAction(
                    `${run.id}:pause`,
                    () => automationApi.pause(run.automationId),
                  )}
                >
                  <PauseCircle className="size-3.5" aria-hidden />
                  {busyAction === `${run.id}:pause` ? labels.feedback.working : labels.feedback.pause}
                </Button>
                <Button asChild variant="ghost" className="h-7 rounded-md px-2 text-xs">
                  <Link to={`/automations?run=${encodeURIComponent(run.id)}`}>
                    <ExternalLink className="size-3.5" aria-hidden />
                    {labels.feedback.open}
                  </Link>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
