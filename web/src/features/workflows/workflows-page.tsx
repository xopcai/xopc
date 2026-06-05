import * as Dialog from '@radix-ui/react-dialog';
import { Activity, Bot, Boxes, ChevronDown, CircleStop, Eye, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import {
  cancelWorkflowRun,
  getWorkflowRun,
  listWorkflowDefinitions,
  listWorkflowRuns,
  rebuildWorkflowRun,
  startWorkflowRun,
  type WorkflowAgentView,
  type WorkflowDefinition,
  type WorkflowRunStatus,
  type WorkflowRunSummary,
  type WorkflowRunView,
} from './workflow-api';

const RUN_FETCH_LIMIT = 50;
const RESULT_PREVIEW_MAX_LENGTH = 900;
const ACTIVE_STATUSES = new Set<WorkflowRunStatus>(['queued', 'running']);

type WorkflowsMessages = ReturnType<typeof messages>['workflows'];

function formatTime(ms: number | undefined, localeTag: string): string {
  if (!ms) return '—';
  return new Intl.DateTimeFormat(localeTag, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function formatDuration(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes < 60) return remainSeconds ? `${minutes}m ${remainSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes ? `${hours}h ${remainMinutes}m` : `${hours}h`;
}

function statusTone(status: WorkflowRunStatus): string {
  if (status === 'succeeded') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed' || status === 'timeout') return 'bg-red-500/15 text-red-700 dark:text-red-300';
  if (status === 'cancelled') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
  return 'bg-accent-soft text-accent-fg';
}

function agentStatusClass(agent: WorkflowAgentView): string {
  if (agent.status === 'done') return 'border-emerald-500/30 bg-emerald-500/5';
  if (agent.status === 'error') return 'border-red-500/30 bg-red-500/5';
  if (agent.status === 'running') return 'border-accent/40 bg-accent-soft/35';
  if (agent.status === 'skipped') return 'border-amber-500/30 bg-amber-500/5';
  return 'border-edge bg-surface-panel';
}

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

function statusLabel(status: WorkflowRunStatus, m: WorkflowsMessages): string {
  return m.status[status] ?? status;
}

function stringifyWorkflowResult(result: unknown): string {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function previewWorkflowResult(resultText: string): string {
  if (resultText.length <= RESULT_PREVIEW_MAX_LENGTH) return resultText;
  return `${resultText.slice(0, RESULT_PREVIEW_MAX_LENGTH)}\n…`;
}

function agentProgressLabel(labels: WorkflowsMessages, done: number, total: number): string {
  return interpolate(labels.agentProgress, { done, total });
}

function agentCountLabel(labels: WorkflowsMessages, count: number): string {
  return interpolate(labels.agentCount, { count });
}

function WorkflowDefinitionCard({
  definition,
  selected,
  onSelect,
}: {
  definition: WorkflowDefinition;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group w-full rounded-2xl border p-4 text-left transition-colors',
        selected
          ? 'border-accent bg-accent-soft/40 text-fg'
          : 'border-edge bg-surface-panel hover:border-accent/40 hover:bg-surface-hover/60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">{definition.title}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{definition.description}</p>
        </div>
        <Boxes className="mt-0.5 size-4 shrink-0 text-accent-fg opacity-80" aria-hidden />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {definition.metadata.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[11px] text-fg-muted">
            {tag}
          </span>
        ))}
      </div>
    </button>
  );
}

function RunRow({
  run,
  selected,
  localeTag,
  labels,
  onSelect,
}: {
  run: WorkflowRunSummary;
  selected: boolean;
  localeTag: string;
  labels: WorkflowsMessages;
  onSelect: () => void;
}) {
  const progress = run.metrics.agentCount > 0
    ? Math.round((run.metrics.doneAgentCount / run.metrics.agentCount) * 100)
    : 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-xl border p-3 text-left transition-colors',
        selected ? 'border-accent bg-accent-soft/35' : 'border-edge bg-surface-panel hover:bg-surface-hover/60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">{run.title}</div>
          <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">{run.id}</div>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', statusTone(run.status))}>
          {statusLabel(run.status, labels)}
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-hover">
        <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-fg-subtle">
        <span>{agentProgressLabel(labels, run.metrics.doneAgentCount, run.metrics.agentCount)}</span>
        <span>{formatTime(run.createdAtMs, localeTag)}</span>
      </div>
    </button>
  );
}

function RunDetailPanel({
  view,
  loading,
  labels,
  localeTag,
  onCancel,
  onRebuild,
}: {
  view: WorkflowRunView | undefined;
  loading: boolean;
  labels: WorkflowsMessages;
  localeTag: string;
  onCancel: () => void;
  onRebuild: () => void;
}) {
  const selectedRunId = view?.run.id;
  const selectedRunStatus = view?.run.status;
  const [processExpanded, setProcessExpanded] = useState(true);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);

  useEffect(() => {
    if (!selectedRunId) return;
    setProcessExpanded(selectedRunStatus ? ACTIVE_STATUSES.has(selectedRunStatus) : true);
    setResultDialogOpen(false);
  }, [selectedRunId, selectedRunStatus]);

  if (loading) {
    return <div className="rounded-2xl border border-edge bg-surface-panel p-6 text-sm text-fg-muted">{labels.loading}</div>;
  }
  if (!view) {
    return <div className="rounded-2xl border border-dashed border-edge p-6 text-sm text-fg-muted">{labels.selectRunHint}</div>;
  }

  const { run } = view;
  const canCancel = view.controls.canCancel && ACTIVE_STATUSES.has(run.status);
  const resultText = stringifyWorkflowResult(run.result);
  const hasResult = resultText.trim().length > 0;

  return (
    <section className="rounded-2xl border border-edge bg-surface-panel p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-fg">{run.title}</h2>
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusTone(run.status))}>
              {statusLabel(run.status, labels)}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-fg-subtle">{run.id}</p>
          {run.goal ? <p className="mt-3 text-sm leading-6 text-fg-muted">{run.goal}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canCancel ? (
            <Button variant="secondary" onClick={onCancel} className="text-red-600 dark:text-red-300">
              <CircleStop className="size-4" aria-hidden />
              {labels.cancel}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onRebuild}>
            <RotateCcw className="size-4" aria-hidden />
            {labels.rebuild}
          </Button>
        </div>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label={labels.metrics.startedAt} value={formatTime(run.startedAtMs ?? run.createdAtMs, localeTag)} />
        <Metric label={labels.metrics.duration} value={formatDuration(run.metrics.durationMs)} />
        <Metric label={labels.metrics.agents} value={`${run.metrics.doneAgentCount}/${run.metrics.agentCount}`} />
        <Metric label={labels.metrics.artifacts} value={String(run.metrics.artifactCount)} />
      </dl>

      <div className="mt-6 rounded-2xl border border-edge bg-surface-base/35">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
          onClick={() => setProcessExpanded((expanded) => !expanded)}
          aria-expanded={processExpanded}
        >
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-fg">{labels.process}</h3>
            <p className="mt-1 text-xs text-fg-subtle">
              {agentProgressLabel(labels, run.metrics.doneAgentCount, run.metrics.agentCount)} · {formatDuration(run.metrics.durationMs)}
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
            {processExpanded ? labels.collapse : labels.expand}
            <ChevronDown className={cn('size-4 transition-transform', processExpanded && 'rotate-180')} aria-hidden />
          </span>
        </button>

        {processExpanded ? (
          <div className="border-t border-edge px-4 pb-4 pt-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
              <div>
                <h4 className="text-sm font-semibold text-fg">{labels.phases}</h4>
                <div className="mt-3 space-y-2">
                  {view.phases.length ? view.phases.map((phase) => (
                    <div key={phase.id} className="rounded-xl border border-edge bg-surface-panel p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-fg">{phase.title}</span>
                        <span className="text-xs text-fg-subtle">{phase.status}</span>
                      </div>
                      <div className="mt-1 text-xs text-fg-muted">{agentCountLabel(labels, phase.agentIds.length)}</div>
                    </div>
                  )) : <EmptyLine>{labels.noPhases}</EmptyLine>}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-fg">{labels.subagents}</h4>
                <div className="mt-3 max-h-104 space-y-2 overflow-auto pr-1">
                  {view.agents.length ? view.agents.map((agent) => (
                    <div key={agent.id} className={cn('rounded-xl border p-3', agentStatusClass(agent))}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-fg">{agent.label}</div>
                          {agent.currentStep ? <div className="mt-1 truncate text-xs text-fg-muted">{agent.currentStep}</div> : null}
                        </div>
                        <span className="shrink-0 text-xs text-fg-subtle">{agent.status}</span>
                      </div>
                      {agent.resultPreview ? <p className="mt-2 line-clamp-3 text-xs leading-5 text-fg-muted">{agent.resultPreview}</p> : null}
                      {agent.error ? <p className="mt-2 text-xs leading-5 text-red-600 dark:text-red-300">{agent.error}</p> : null}
                    </div>
                  )) : <EmptyLine>{labels.noSubagents}</EmptyLine>}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <h4 className="text-sm font-semibold text-fg">{labels.logs}</h4>
              <div className="mt-3 max-h-48 overflow-auto rounded-xl border border-edge bg-surface-panel p-3 font-mono text-xs text-fg-muted">
                {view.logs.length ? view.logs.slice(-30).map((log) => (
                  <div key={log.sequence} className="py-0.5">{log.message}</div>
                )) : labels.noLogs}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-fg">{labels.resultTitle}</h3>
          {hasResult ? (
            <Button variant="secondary" onClick={() => setResultDialogOpen(true)}>
              <Eye className="size-4" aria-hidden />
              {labels.viewFullResult}
            </Button>
          ) : null}
        </div>
        {hasResult ? (
          <button
            type="button"
            className="mt-3 block w-full rounded-xl border border-edge bg-surface-base/50 p-3 text-left transition-colors hover:bg-surface-hover/60"
            onClick={() => setResultDialogOpen(true)}
          >
            <pre className="max-h-48 overflow-hidden whitespace-pre-wrap wrap-break-word font-mono text-xs leading-5 text-fg-muted">
              {previewWorkflowResult(resultText)}
            </pre>
          </button>
        ) : (
          <EmptyLine>{labels.noResult}</EmptyLine>
        )}
      </div>

      <WorkflowResultDialog
        open={resultDialogOpen}
        title={labels.resultDialogTitle}
        resultText={resultText}
        closeLabel={labels.closeResult}
        onClose={() => setResultDialogOpen(false)}
      />
    </section>
  );
}

function WorkflowResultDialog({
  open,
  title,
  resultText,
  closeLabel,
  onClose,
}: {
  open: boolean;
  title: string;
  resultText: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-66 flex max-h-[min(80vh,44rem)] w-[min(100%-2rem,56rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between gap-3 border-b border-edge px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-fg">{title}</Dialog.Title>
            <Button type="button" variant="secondary" onClick={onClose}>
              {closeLabel}
            </Button>
          </div>
          <pre className="min-h-0 overflow-auto whitespace-pre-wrap wrap-break-word p-5 font-mono text-xs leading-5 text-fg-muted">
            {resultText}
          </pre>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-edge bg-surface-base/40 p-3">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-fg">{value}</dd>
    </div>
  );
}

function EmptyLine({ children }: { children: string }) {
  return <div className="rounded-xl border border-dashed border-edge p-4 text-sm text-fg-muted">{children}</div>;
}

export function WorkflowsPage() {
  const language = useLocaleStore((s) => s.language);
  const labels = messages(language).workflows;
  const localeTag = language === 'zh' ? 'zh-CN' : 'en-US';
  const token = useGatewayStore((s) => s.token);
  const hasToken = Boolean(token);

  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string>('');
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [goal, setGoal] = useState('');
  const [concurrency, setConcurrency] = useState('');
  const [maxSubagents, setMaxSubagents] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const definitionsSwr = useSWR(hasToken ? ['workflow-definitions', token] : null, listWorkflowDefinitions, {
    revalidateOnFocus: false,
  });
  const runsSwr = useSWR(hasToken ? ['workflow-runs', token] : null, () => listWorkflowRuns(RUN_FETCH_LIMIT), {
    revalidateOnFocus: false,
  });
  const detailSwr = useSWR(
    hasToken && selectedRunId ? ['workflow-run', selectedRunId, token] : null,
    () => getWorkflowRun(selectedRunId),
    { revalidateOnFocus: false },
  );

  const definitions = definitionsSwr.data ?? [];
  const runs = runsSwr.data ?? [];
  const selectedDefinition = useMemo(
    () => definitions.find((definition) => definition.id === selectedDefinitionId) ?? definitions[0],
    [definitions, selectedDefinitionId],
  );

  useEffect(() => {
    if (!selectedDefinitionId && definitions[0]) {
      setSelectedDefinitionId(definitions[0].id);
    }
  }, [definitions, selectedDefinitionId]);

  useEffect(() => {
    if (!selectedRunId && runs[0]) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    const refreshRuns = () => void runsSwr.mutate();
    const refreshDetail = (event: Event) => {
      const detail = (event as CustomEvent<{ runId?: string; view?: WorkflowRunView }>).detail;
      void runsSwr.mutate();
      if (detail?.runId && detail.runId === selectedRunId) {
        void detailSwr.mutate(detail.view, { revalidate: false });
      }
    };
    window.addEventListener('workflow-event-appended', refreshRuns);
    window.addEventListener('workflow-run-updated', refreshDetail);
    window.addEventListener('workflow-run-error', refreshRuns);
    return () => {
      window.removeEventListener('workflow-event-appended', refreshRuns);
      window.removeEventListener('workflow-run-updated', refreshDetail);
      window.removeEventListener('workflow-run-error', refreshRuns);
    };
  }, [detailSwr, runsSwr, selectedRunId]);

  const refreshAll = useCallback(() => {
    void definitionsSwr.mutate();
    void runsSwr.mutate();
    void detailSwr.mutate();
  }, [definitionsSwr, detailSwr, runsSwr]);

  const submitStart = useCallback(async () => {
    if (!selectedDefinition) return;
    setStarting(true);
    setActionError(null);
    try {
      const result = await startWorkflowRun({
        definitionId: selectedDefinition.id,
        goal: goal.trim() || selectedDefinition.description,
        concurrency: concurrency.trim() ? Number(concurrency) : undefined,
        maxSubagents: maxSubagents.trim() ? Number(maxSubagents) : undefined,
      });
      setSelectedRunId(result.runId);
      setGoal('');
      await runsSwr.mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : labels.startFailed);
    } finally {
      setStarting(false);
    }
  }, [concurrency, goal, labels.startFailed, maxSubagents, runsSwr, selectedDefinition]);

  const cancelSelectedRun = useCallback(async () => {
    if (!selectedRunId) return;
    try {
      await cancelWorkflowRun(selectedRunId);
      await runsSwr.mutate();
      await detailSwr.mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : labels.cancelFailed);
    }
  }, [detailSwr, labels.cancelFailed, runsSwr, selectedRunId]);

  const rebuildSelectedRun = useCallback(async () => {
    if (!selectedRunId) return;
    try {
      const view = await rebuildWorkflowRun(selectedRunId);
      await detailSwr.mutate(view, { revalidate: false });
      await runsSwr.mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : labels.rebuildFailed);
    }
  }, [detailSwr, labels.rebuildFailed, runsSwr, selectedRunId]);

  const loading = definitionsSwr.isLoading || runsSwr.isLoading;
  const error = actionError ?? definitionsSwr.error?.message ?? runsSwr.error?.message ?? null;

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-surface-base">
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6 lg:px-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-edge bg-surface-panel px-3 py-1 text-xs text-fg-muted">
              <Activity className="size-3.5 text-accent-fg" aria-hidden />
              {labels.kicker}
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg">{labels.title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted">{labels.subtitle}</p>
          </div>
          <Button variant="secondary" onClick={refreshAll} disabled={!hasToken || loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden />
            {labels.refresh}
          </Button>
        </header>

        {error ? (
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
          <section className="space-y-4">
            <div className="rounded-2xl border border-edge bg-surface-panel p-5">
              <h2 className="text-sm font-semibold text-fg">{labels.library}</h2>
              <div className="mt-4 grid gap-3">
                {definitions.map((definition) => (
                  <WorkflowDefinitionCard
                    key={definition.id}
                    definition={definition}
                    selected={selectedDefinition?.id === definition.id}
                    onSelect={() => setSelectedDefinitionId(definition.id)}
                  />
                ))}
                {!definitions.length ? <EmptyLine>{labels.noDefinitions}</EmptyLine> : null}
              </div>
            </div>

            <div className="rounded-2xl border border-edge bg-surface-panel p-5">
              <div className="flex items-center gap-2">
                <Play className="size-4 text-accent-fg" aria-hidden />
                <h2 className="text-sm font-semibold text-fg">{labels.startTitle}</h2>
              </div>
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder={labels.goalPlaceholder}
                className="mt-4 min-h-28 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <input
                  value={concurrency}
                  onChange={(event) => setConcurrency(event.target.value)}
                  placeholder={labels.concurrencyPlaceholder}
                  inputMode="numeric"
                  className="rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
                <input
                  value={maxSubagents}
                  onChange={(event) => setMaxSubagents(event.target.value)}
                  placeholder={labels.maxSubagentsPlaceholder}
                  inputMode="numeric"
                  className="rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </div>
              <Button className="mt-4 w-full" variant="primary" onClick={submitStart} disabled={!selectedDefinition || starting}>
                <Play className="size-4" aria-hidden />
                {starting ? labels.starting : labels.start}
              </Button>
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-2xl border border-edge bg-surface-panel p-5">
              <div className="flex items-center gap-2">
                <Bot className="size-4 text-accent-fg" aria-hidden />
                <h2 className="text-sm font-semibold text-fg">{labels.runs}</h2>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {runs.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    selected={selectedRunId === run.id}
                    localeTag={localeTag}
                    labels={labels}
                    onSelect={() => setSelectedRunId(run.id)}
                  />
                ))}
                {!runs.length ? <EmptyLine>{labels.noRuns}</EmptyLine> : null}
              </div>
            </div>

            <RunDetailPanel
              view={detailSwr.data}
              loading={detailSwr.isLoading}
              labels={labels}
              localeTag={localeTag}
              onCancel={cancelSelectedRun}
              onRebuild={rebuildSelectedRun}
            />
          </section>
        </div>
      </div>
    </main>
  );
}
