import * as Dialog from '@radix-ui/react-dialog';

import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleStop,
  Copy,
  Download,
  MessageSquare,
  PackageCheck,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { workflowCardLabels } from '@/features/chat/workflow/workflow-card-labels';
import { WorkflowAgentDetailDrawer } from '@/features/chat/workflow/workflow-agent-detail-drawer';
import { ProgressTree, RunningProgressPanel } from '@/features/chat/workflow/workflow-progress-display';
import { WorkflowResultSummary } from '@/features/chat/workflow/workflow-result-summary';
import type { WorkflowAgentSnapshot } from '@/features/chat/workflow/workflow.types';
import { rollupPhases } from '@/features/chat/workflow/workflow.utils';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import { runViewToSnapshot } from './run-view-to-snapshot';
import {
  downloadWorkflowArtifact,
  type WorkflowArtifactRef,
  type WorkflowDefinition,
  type WorkflowFollowUp,
  type WorkflowResultEnvelope,
  type WorkflowRunComparison,
  type WorkflowRunDefinitionSnapshot,
  type WorkflowRunReplayScope,
  type WorkflowRunView,
} from './workflow-api';
import { ACTIVE_RUN_STATUSES } from './workflow-page.constants';
import {
  collectWorkflowRunDiagnostics,
  formatDuration,
  formatTime,
  interpolate,
  resolveWorkflowResultForDisplay,
  resolveWorkflowSessionKey,
  statusTone,
  stringifyWorkflowResult,
  type WorkflowRunDiagnosticItem,
  workflowChatHref,
} from './workflow-page.utils';

type WorkflowsMessages = ReturnType<typeof messages>['workflows'];

function statusLabel(status: WorkflowRunView['run']['status'], labels: WorkflowsMessages): string {
  return labels.status[status] ?? status;
}

function phaseStatusLabel(status: string, labels: WorkflowsMessages): string {
  return labels.phaseStatus[status as keyof WorkflowsMessages['phaseStatus']] ?? status;
}

function buildRunSummary(view: WorkflowRunView, labels: WorkflowsMessages): string {
  const { run } = view;
  if (run.status === 'succeeded') {
    return interpolate(labels.runSummarySucceeded, {
      agents: run.metrics.doneAgentCount,
      artifacts: run.metrics.artifactCount,
    });
  }
  if (run.status === 'failed' || run.status === 'timeout') {
    return run.error?.message ?? labels.runSummaryFailedFallback;
  }
  if (run.status === 'cancelled') return labels.runSummaryCancelled;
  return interpolate(labels.runSummaryActive, {
    done: run.metrics.doneAgentCount,
    total: run.metrics.agentCount,
  });
}

function buildDiagnosticHint(view: WorkflowRunView, labels: WorkflowsMessages): string | null {
  const { run } = view;
  if (run.status === 'failed') return labels.diagnosticFailedHint;
  if (run.status === 'timeout') return labels.diagnosticTimeoutHint;
  if (run.status === 'cancelled') return labels.diagnosticCancelledHint;
  if (run.status === 'succeeded' && run.metrics.errorAgentCount > 0) return labels.diagnosticPartialHint;
  return null;
}

function resolveWorkflowSessionKeyFromView(view: WorkflowRunView): string | null {
  return resolveWorkflowSessionKey(view);
}

function formatSourceSummary(source: WorkflowRunView['run']['source']): string {
  if (!source || typeof source !== 'object' || !('kind' in source)) return 'unknown';
  if (source.kind === 'chat') return `chat · ${source.sessionKey}`;
  if (source.kind === 'webui') return source.sessionKey ? `webui · ${source.sessionKey}` : 'webui';
  if (source.kind === 'cron') return `cron · ${source.scheduleId}`;
  if (source.kind === 'api') return source.requestId ? `api · ${source.requestId}` : 'api';
  if (source.kind === 'im') return `${source.channel} · ${source.chatId}`;
  return String(source.kind);
}

export function WorkflowRunPanel({
  view,
  comparison,
  currentDefinition,
  loading,
  language,
  localeTag,
  onCancel,
  onRetry,
  onReplay,
  onOpenRunId,
  ownerAgentId,
  onClose,
}: {
  view: WorkflowRunView | undefined;
  comparison?: WorkflowRunComparison;
  currentDefinition?: WorkflowDefinition;
  loading: boolean;
  language: StoredLanguage;
  localeTag: string;
  onCancel: () => void;
  onRetry: () => void;
  onReplay: (scope: WorkflowRunReplayScope) => void;
  onOpenRunId?: (runId: string) => void;
  ownerAgentId?: string;
  onClose: () => void;
}) {
  const labels = messages(language).workflows;
  const cardLabels = workflowCardLabels(language);
  const navigate = useNavigate();

  const [processExpanded, setProcessExpanded] = useState(true);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [drawerAgentId, setDrawerAgentId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const runStatus = view?.run.status;
  const isActive = runStatus ? ACTIVE_RUN_STATUSES.has(runStatus) : false;

  useEffect(() => {
    if (!view?.run.id) return;

    const shouldExpandProcess = isActive
      || runStatus === 'failed'
      || runStatus === 'timeout'
      || (runStatus === 'succeeded' && view.run.metrics.errorAgentCount > 0);

    setProcessExpanded(shouldExpandProcess);
    setDrawerAgentId(null);
    setDownloadError(null);
  }, [view?.run.id, isActive, runStatus, view?.run.metrics.errorAgentCount]);

  useEffect(() => {
    if (!isActive) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [isActive]);

  const snapshot = useMemo(() => (view ? runViewToSnapshot(view) : null), [view]);
  const rollup = useMemo(() => (snapshot ? rollupPhases(snapshot) : { phases: [], unphased: null }), [snapshot]);
  const drawerAgent = useMemo(() => {
    if (drawerAgentId == null || !snapshot) return null;
    return snapshot.agents.find((agent) => agent.id === drawerAgentId) ?? null;
  }, [drawerAgentId, snapshot]);

  const handleSelectAgent = useCallback((agent: WorkflowAgentSnapshot) => {
    setDrawerAgentId(agent.id);
  }, []);

  const outcome = view ? resolveWorkflowOutcome(view.run.result) : null;
  const diagnostics = useMemo(() => (view ? collectWorkflowRunDiagnostics(view) : []), [view]);
  const resultForDisplay = view ? resolveWorkflowResultForDisplay(view.run.result) : undefined;
  const resultText = stringifyWorkflowResult(resultForDisplay);
  const hasResult = resultText.trim().length > 0;

  const handleCopy = useCallback(async () => {
    if (!hasResult) return;
    const ok = await copyTextToClipboard(resultText);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [hasResult, resultText]);

  const handleExport = useCallback(() => {
    if (!hasResult || !view) return;
    const blob = new Blob([resultText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${view.run.definitionId}-${view.run.id.slice(0, 8)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [hasResult, resultText, view]);

  const continueInChat = useCallback(() => {
    if (!view) return;
    const sessionKey = resolveWorkflowSessionKeyFromView(view);
    if (!sessionKey) return;
    navigate(workflowChatHref(sessionKey));
  }, [navigate, view]);

  const handleDownloadArtifact = useCallback(async (artifact: WorkflowArtifactRef) => {
    if (!view) return;
    setDownloadError(null);
    setDownloadingArtifactId(artifact.id);
    try {
      const blob = await downloadWorkflowArtifact(view.run.id, artifact.id, { ownerAgentId });
      triggerBlobDownload(blob, artifact.name || artifact.id);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloadingArtifactId(null);
    }
  }, [ownerAgentId, view]);

  const handleStartFollowUp = useCallback((followUp: WorkflowFollowUp) => {
    if (!view || !followUp.prompt) return;
    const sessionKey = resolveWorkflowSessionKeyFromView(view);
    if (!sessionKey) {
      void copyTextToClipboard(followUp.prompt);
      return;
    }
    navigate(workflowChatHref(sessionKey, followUp.prompt));
  }, [navigate, view]);

  const openDiagnosticAgent = useCallback((agentId: string | number | undefined) => {
    if (!view || agentId == null) return;
    const rawAgentId = String(agentId);
    const index = view.agents.findIndex((agent) => String(agent.id) === rawAgentId);
    if (index < 0) return;
    const parsed = Number.parseInt(rawAgentId, 10);
    setDrawerAgentId(Number.isFinite(parsed) ? parsed : index + 1);
  }, [view]);
  const workflowSessionKey = view ? resolveWorkflowSessionKeyFromView(view) : null;

  if (loading) {
    return (
      <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex max-h-[min(85vh,44rem)] w-[min(100%-2rem,48rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold tracking-tight text-fg">{labels.runSummaryTitle}</Dialog.Title>
              <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={labels.pickStartClose} onClick={onClose}>
                <X className="size-5" aria-hidden />
              </Button>
            </div>
            <div className="p-5 text-sm text-fg-muted">{labels.loading}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (!view || !snapshot) return null;

  const { run } = view;
  const canCancel = view.controls.canCancel && isActive;
  const durationText = isActive && run.startedAtMs != null
    ? formatDuration(Date.now() - run.startedAtMs)
    : formatDuration(run.metrics.durationMs ?? undefined);
  const runSummary = buildRunSummary(view, labels);
  const diagnosticHint = buildDiagnosticHint(view, labels);
  const metadata = run.metadata;
  const sourceSummary = formatSourceSummary(run.source);
  const canReplayFailedAgents = view.controls.canRetry && view.agents.some((agent) => (agent.status === 'error' || agent.status === 'skipped') && agent.prompt?.trim());
  const canReplayFailedPhases = view.controls.canRetry && (
    view.phases.some((phase) => phase.status === 'failed' && view.agents.some((agent) => agent.phaseId === phase.id && agent.prompt?.trim()))
    || view.agents.some((agent) => (agent.status === 'error' || agent.status === 'skipped') && agent.phaseId && agent.prompt?.trim())
  );

  return (
    <>
      <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex max-h-[min(90vh,52rem)] w-[min(100%-2rem,64rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-5 py-4">
              <Dialog.Title className="truncate text-base font-semibold tracking-tight text-fg">{run.title}</Dialog.Title>
              <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={labels.pickStartClose} onClick={onClose}>
                <X className="size-5" aria-hidden />
              </Button>
            </div>
            <section className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-fg">{run.title}</h2>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusTone(run.status))}>
                {statusLabel(run.status, labels)}
              </span>
            </div>
            <p className="mt-1 text-xs text-fg-subtle">{run.definitionId}</p>
            {run.goal ? <p className="mt-3 text-sm leading-6 text-fg-muted">{run.goal}</p> : null}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-edge-subtle bg-surface-base/60 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-accent-soft p-2 text-accent-fg">
              {run.status === 'succeeded' ? (
                <PackageCheck className="size-4" aria-hidden />
              ) : run.status === 'failed' || run.status === 'timeout' ? (
                <AlertTriangle className="size-4" aria-hidden />
              ) : (
                <Sparkles className="size-4" aria-hidden />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-fg">{labels.runSummaryTitle}</h3>
              <p className="mt-1 text-sm leading-6 text-fg-muted">{runSummary}</p>
              {diagnosticHint ? (
                <p className="mt-2 text-xs leading-5 text-fg-subtle">{diagnosticHint}</p>
              ) : null}
            </div>
          </div>
        </div>

        <WorkflowDiagnosticsPanel
          diagnostics={diagnostics}
          labels={labels}
          onOpenAgent={openDiagnosticAgent}
        />

        <WorkflowReplayLineagePanel
          view={view}
          comparison={comparison}
          labels={labels}
          onOpenRunId={onOpenRunId}
        />

        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label={labels.metrics.startedAt} value={formatTime(run.startedAtMs ?? run.createdAtMs, localeTag)} />
          <Metric label={labels.metrics.duration} value={durationText} />
          <Metric
            label={labels.metrics.agents}
            value={interpolate(labels.agentProgress, {
              done: run.metrics.doneAgentCount,
              total: run.metrics.agentCount,
            })}
          />
          <Metric label={labels.metrics.artifacts} value={String(run.metrics.artifactCount)} />
        </dl>

        <div className="mt-5 flex flex-wrap gap-2">
          {workflowSessionKey ? (
            <Button variant="primary" onClick={continueInChat}>
              <MessageSquare className="size-4" aria-hidden />
              {labels.continueInChat}
            </Button>
          ) : null}
          {canCancel ? (
            <Button variant="secondary" onClick={onCancel} className="text-red-600 dark:text-red-300">
              <CircleStop className="size-4" aria-hidden />
              {labels.cancel}
            </Button>
          ) : null}
          {view.controls.canRetry ? (
            <Button variant="secondary" onClick={onRetry}>
              <RotateCcw className="size-4" aria-hidden />
              {labels.rerun}
            </Button>
          ) : null}
          {canReplayFailedAgents ? (
            <Button variant="secondary" onClick={() => onReplay('failed_agents')}>
              <RotateCcw className="size-4" aria-hidden />
              {labels.replayFailedAgents}
            </Button>
          ) : null}
          {canReplayFailedPhases ? (
            <Button variant="secondary" onClick={() => onReplay('failed_phases')}>
              <RotateCcw className="size-4" aria-hidden />
              {labels.replayFailedPhases}
            </Button>
          ) : null}
          {hasResult ? (
            <>
              <Button variant="secondary" onClick={handleCopy}>
                {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied ? labels.copied : labels.copyResult}
              </Button>
              <Button variant="secondary" onClick={handleExport}>
                <Download className="size-4" aria-hidden />
                {labels.exportResult}
              </Button>
            </>
          ) : null}
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-fg">{labels.resultTitle}</h3>
          {hasResult ? (
            <div className="mt-3 rounded-xl border border-edge bg-surface-base/50 p-3">
              <WorkflowResultSummary result={resultForDisplay} labels={cardLabels.result} />
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-edge p-4 text-sm text-fg-muted">
              {labels.noResult}
            </div>
          )}
          <WorkflowOutcomePanel
            outcome={outcome}
            labels={labels}
            downloadingArtifactId={downloadingArtifactId}
            downloadError={downloadError}
            onCopyText={(text) => void copyTextToClipboard(text)}
            onDownloadArtifact={(artifact) => void handleDownloadArtifact(artifact)}
            onStartFollowUp={handleStartFollowUp}
          />
        </div>

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
                {interpolate(labels.agentProgress, {
                  done: run.metrics.doneAgentCount,
                  total: run.metrics.agentCount,
                })}
                {' · '}
                {durationText}
              </p>
            </div>
            <ChevronDown
              className={cn('size-4 shrink-0 text-fg-subtle transition-transform', processExpanded ? 'rotate-180' : null)}
              aria-hidden
            />
          </button>

          {processExpanded ? (
            <div className="border-t border-edge px-4 pb-4 pt-4">
              {isActive ? (
                <RunningProgressPanel
                  snapshot={snapshot}
                  labels={cardLabels}
                  logsExpanded={logsExpanded}
                  onToggleLogs={() => setLogsExpanded((value) => !value)}
                  selectedAgentId={drawerAgentId}
                  onSelectAgent={handleSelectAgent}
                />
              ) : (
                <ProgressTree
                  rollup={rollup}
                  currentPhase={snapshot.currentPhase}
                  labels={cardLabels.phase}
                  recentLogs={snapshot.logs}
                  recentLogsHeading={cardLabels.recentLogsHeading}
                  showAllLogsLabel={cardLabels.showAllLogs}
                  logsExpanded={logsExpanded}
                  onToggleLogs={() => setLogsExpanded((value) => !value)}
                  selectedAgentId={drawerAgentId}
                  onSelectAgent={handleSelectAgent}
                />
              )}

              {view.phases.length > 0 ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {view.phases.map((phase) => (
                    <div key={phase.id} className="rounded-xl border border-edge bg-surface-panel px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-fg">{phase.title}</span>
                        <span className="text-xs text-fg-subtle">{phaseStatusLabel(phase.status, labels)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <AgentInputOutputOverview
          agents={snapshot.agents}
          labels={labels}
          defaultExpanded={run.status === 'failed' || run.status === 'timeout' || run.metrics.errorAgentCount > 0}
        />

        <div className="mt-6 grid gap-3 rounded-2xl border border-edge-subtle bg-surface-base/35 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetadataItem label={labels.metadataSession} value={metadata?.sessionKey ?? resolveWorkflowSessionKey(view) ?? '—'} />
          <MetadataItem label={labels.metadataSource} value={sourceSummary} />
          <MetadataItem
            label={labels.metadataDefinition}
            value={`${metadata?.definition.version ?? run.definitionVersion} · ${metadata?.definition.source ?? 'unknown'}`}
          />
          <MetadataItem
            label={labels.metadataDefinitionHash}
            value={definitionSnapshotStatus(metadata?.definition, currentDefinition, labels)}
          />
          <MetadataItem
            label={labels.metadataPermissions}
            value={formatPermissionSnapshot(metadata?.definition)}
          />
          <MetadataItem label={labels.metadataRetryOf} value={metadata?.retryOfRunId ?? '—'} />
        </div>
            </section>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <WorkflowAgentDetailDrawer
        open={drawerAgentId != null && drawerAgent != null}
        agent={drawerAgent}
        snapshot={snapshot}
        sessionKey={null}
        ownerAgentId={ownerAgentId}
        pinnedAgentId={null}
        onPinAgent={() => {}}
        onClose={() => setDrawerAgentId(null)}
        labels={cardLabels.drawer}
      />
    </>
  );
}

function WorkflowDiagnosticsPanel({
  diagnostics,
  labels,
  onOpenAgent,
}: {
  diagnostics: WorkflowRunDiagnosticItem[];
  labels: WorkflowsMessages;
  onOpenAgent: (agentId: string | number | undefined) => void;
}) {
  if (diagnostics.length === 0) return null;

  return (
    <section className="mt-5 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-rose-500/10 p-2 text-rose-700 dark:text-rose-300">
          <AlertTriangle className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">{labels.diagnosticsTitle}</h3>
          <p className="mt-1 text-xs leading-5 text-fg-subtle">{labels.diagnosticsHint}</p>
          <ul className="mt-3 space-y-2">
            {diagnostics.slice(0, 5).map((item) => (
              <li key={item.key} className="rounded-xl border border-edge-subtle bg-surface-panel px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-fg">{diagnosticItemTitle(item, labels)}</div>
                    {item.message ? (
                      <div className="mt-0.5 text-xs leading-5 text-fg-muted">{item.message}</div>
                    ) : null}
                    {item.detail ? (
                      <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-fg-subtle">{item.detail}</div>
                    ) : null}
                  </div>
                  {item.agentId != null ? (
                    <Button type="button" variant="ghost" className="h-8 shrink-0 px-2 text-xs" onClick={() => onOpenAgent(item.agentId)}>
                      {labels.openAgentDetails}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function diagnosticItemTitle(item: WorkflowRunDiagnosticItem, labels: WorkflowsMessages): string {
  if (item.kind === 'run_error') {
    return item.code ? interpolate(labels.diagnosticsRunErrorWithCode, { code: item.code }) : labels.diagnosticsRunError;
  }
  if (item.kind === 'agent_error') {
    return interpolate(labels.diagnosticsAgentError, { agent: item.agentLabel ?? String(item.agentId ?? '—') });
  }
  if (item.kind === 'step_error') {
    return interpolate(labels.diagnosticsStepError, {
      agent: item.agentLabel ?? String(item.agentId ?? '—'),
      step: item.stepLabel ?? item.stepId ?? '—',
    });
  }
  return interpolate(labels.diagnosticsAgentSkipped, { agent: item.agentLabel ?? String(item.agentId ?? '—') });
}

function WorkflowReplayLineagePanel({
  view,
  comparison,
  labels,
  onOpenRunId,
}: {
  view: WorkflowRunView;
  comparison?: WorkflowRunComparison;
  labels: WorkflowsMessages;
  onOpenRunId?: (runId: string) => void;
}) {
  const replay = view.run.metadata?.replay;
  if (!replay) return null;

  return (
    <section className="mt-5 rounded-2xl border border-edge-subtle bg-surface-base/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{labels.replayLineageTitle}</h3>
          <p className="mt-1 text-xs leading-5 text-fg-subtle">
            {interpolate(labels.replayLineageSummary, {
              scope: replayScopeLabel(replay.scope, labels),
              count: replay.targetCount,
            })}
          </p>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <MetadataItem label={labels.replaySourceRun} value={replay.sourceRunId} />
            <MetadataItem label={labels.replayTargetAgents} value={replay.agentIds.join(', ')} />
          </dl>
          {comparison ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Metric label={labels.replayFixedAgents} value={String(comparison.fixedAgentIds.length)} />
              <Metric label={labels.replayStillFailingAgents} value={String(comparison.stillFailingAgentIds.length)} />
              <Metric label={labels.replayDurationDelta} value={formatDurationDelta(comparison.durationDeltaMs)} />
            </div>
          ) : null}
        </div>
        {onOpenRunId ? (
          <Button type="button" variant="secondary" className="shrink-0" onClick={() => onOpenRunId(replay.sourceRunId)}>
            {labels.replayOpenSource}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function definitionSnapshotStatus(
  snapshot: WorkflowRunDefinitionSnapshot | undefined,
  currentDefinition: WorkflowDefinition | undefined,
  labels: WorkflowsMessages,
): string {
  if (!snapshot?.contentHash) return labels.definitionHashUnavailable;
  const short = snapshot.contentHash.slice(0, 8);
  if (!currentDefinition?.contentHash) return `${short} · ${labels.definitionHashCurrentUnknown}`;
  return currentDefinition.contentHash === snapshot.contentHash
    ? `${short} · ${labels.definitionHashMatches}`
    : `${short} · ${labels.definitionHashDrifted}`;
}

function formatPermissionSnapshot(snapshot: WorkflowRunDefinitionSnapshot | undefined): string {
  const permissions = snapshot?.permissions;
  if (!permissions) return '—';
  const parts = [
    permissions.tools?.length ? `tools:${permissions.tools.join(',')}` : null,
    permissions.network != null ? `network:${permissions.network ? 'on' : 'off'}` : null,
    permissions.fileSystem ? `fs:${permissions.fileSystem}` : null,
    permissions.approvalRequired ? 'approval' : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

function formatDurationDelta(deltaMs: number | null): string {
  if (deltaMs == null) return '—';
  const sign = deltaMs > 0 ? '+' : deltaMs < 0 ? '-' : '';
  return `${sign}${formatDuration(Math.abs(deltaMs))}`;
}

function replayScopeLabel(scope: WorkflowRunReplayScope, labels: WorkflowsMessages): string {
  return scope === 'failed_phases' ? labels.replayScopeFailedPhases : labels.replayScopeFailedAgents;
}

function WorkflowOutcomePanel({
  outcome,
  labels,
  downloadingArtifactId,
  downloadError,
  onCopyText,
  onDownloadArtifact,
  onStartFollowUp,
}: {
  outcome: WorkflowOutcomeView | null;
  labels: WorkflowsMessages;
  downloadingArtifactId: string | null;
  downloadError: string | null;
  onCopyText: (text: string) => void;
  onDownloadArtifact: (artifact: WorkflowArtifactRef) => void;
  onStartFollowUp: (followUp: WorkflowFollowUp) => void;
}) {
  if (!outcome || (!outcome.artifacts.length && !outcome.followUps.length && outcome.structuredOutput === undefined)) {
    return null;
  }

  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-3">
      {outcome.artifacts.length > 0 ? (
        <OutcomeCard title={labels.outcomeArtifacts}>
          <ul className="space-y-2">
            {outcome.artifacts.map((artifact) => (
              <li key={artifact.id} className="min-w-0 rounded-lg bg-surface-base px-2.5 py-2">
                <div className="truncate text-sm font-medium text-fg" title={artifact.title ?? artifact.name}>
                  {artifact.title ?? artifact.name}
                </div>
                <div className="mt-0.5 text-xs text-fg-subtle">{artifact.mimeType}</div>
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent-fg hover:underline disabled:cursor-wait disabled:opacity-60"
                  disabled={downloadingArtifactId === artifact.id}
                  onClick={() => onDownloadArtifact(artifact)}
                >
                  <Download className="size-3" aria-hidden />
                  {downloadingArtifactId === artifact.id ? labels.downloadingArtifact : labels.downloadArtifact}
                </button>
              </li>
            ))}
          </ul>
          {downloadError ? <p className="mt-2 text-xs leading-5 text-rose-600 dark:text-rose-400">{downloadError}</p> : null}
        </OutcomeCard>
      ) : null}

      {outcome.followUps.length > 0 ? (
        <OutcomeCard title={labels.outcomeFollowUps}>
          <ul className="space-y-2">
            {outcome.followUps.map((followUp) => (
              <li key={followUp.id} className="rounded-lg bg-surface-base px-2.5 py-2">
                <div className="text-sm font-medium text-fg">{followUp.title}</div>
                {followUp.prompt ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-xs font-medium text-accent-fg hover:underline"
                      onClick={() => onStartFollowUp(followUp)}
                    >
                      {labels.startFollowUp}
                    </button>
                    <button
                      type="button"
                      className="text-xs font-medium text-fg-subtle hover:text-fg"
                      onClick={() => onCopyText(followUp.prompt ?? '')}
                    >
                      {labels.copyPrompt}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </OutcomeCard>
      ) : null}

      {outcome.structuredOutput !== undefined ? (
        <OutcomeCard title={labels.outcomeStructuredOutput}>
          <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-base p-2 font-mono text-xs leading-5 text-fg-muted">
            {stringifyWorkflowResult(outcome.structuredOutput)}
          </pre>
        </OutcomeCard>
      ) : null}
    </div>
  );
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function OutcomeCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-edge-subtle bg-surface-base/35 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</h4>
      <div className="mt-2">{children}</div>
    </section>
  );
}

interface WorkflowOutcomeView {
  artifacts: WorkflowArtifactRef[];
  followUps: WorkflowFollowUp[];
  structuredOutput?: unknown;
}

function resolveWorkflowOutcome(result: unknown): WorkflowOutcomeView | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const envelope = result as Partial<WorkflowResultEnvelope>;
  const artifacts = Array.isArray(envelope.artifacts) ? envelope.artifacts : [];
  const followUps = Array.isArray(envelope.followUps) ? envelope.followUps : [];
  if (artifacts.length === 0 && followUps.length === 0 && envelope.structuredOutput === undefined) return null;
  return { artifacts, followUps, structuredOutput: envelope.structuredOutput };
}

function AgentInputOutputOverview({
  agents,
  labels,
  defaultExpanded,
}: {
  agents: WorkflowAgentSnapshot[];
  labels: WorkflowsMessages;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  if (agents.length === 0) return null;

  return (
    <section className="mt-6 rounded-2xl border border-edge bg-surface-base/35">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-fg">{labels.agentIoTitle}</h3>
          <p className="text-xs leading-5 text-fg-subtle">{labels.agentIoHint}</p>
        </div>
        <ChevronDown
          className={cn('mt-0.5 size-4 shrink-0 text-fg-subtle transition-transform', expanded ? 'rotate-180' : null)}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div className="grid gap-3 border-t border-edge px-4 py-4">
          {agents.map((agent) => {
          const output = agent.error || agent.resultPreview || labels.agentNoOutput;
          return (
            <article key={agent.id} className="rounded-xl border border-edge-subtle bg-surface-panel p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 text-sm font-medium text-fg">{agent.label}</div>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', agentStatusTone(agent.status))}>
                  {labels.agentStatus[agent.status] ?? agent.status}
                </span>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                    {labels.agentInputHeading}
                  </div>
                  <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-lg border border-edge-subtle bg-surface-base/50 p-2 font-mono text-xs leading-5 text-fg-muted">
                    {agent.prompt || '—'}
                  </pre>
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                    {labels.agentOutputHeading}
                  </div>
                  <div
                    className={cn(
                      'mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-lg border border-edge-subtle bg-surface-base/50 p-2 text-xs leading-5',
                      agent.error ? 'font-mono text-rose-600 dark:text-rose-400' : 'text-fg-muted',
                    )}
                  >
                    {output}
                  </div>
                </div>
              </div>
              <AgentInvocationSnapshotView agent={agent} labels={labels} />
            </article>
          );
          })}
        </div>
      ) : null}
    </section>
  );
}

function AgentInvocationSnapshotView({
  agent,
  labels,
}: {
  agent: WorkflowAgentSnapshot;
  labels: WorkflowsMessages;
}) {
  const invocation = agent.invocation;
  if (!invocation) return null;

  const fields = [
    { label: labels.agentInvocationModel, value: invocation.resolvedModelRef ?? invocation.modelRef },
    { label: labels.agentInvocationTools, value: invocation.toolset?.join(', ') },
    { label: labels.agentInvocationIterations, value: invocation.maxIterations != null ? String(invocation.maxIterations) : undefined },
    { label: labels.agentInvocationSchema, value: invocation.schema ? labels.agentInvocationSchemaPresent : undefined },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));

  if (fields.length === 0) return null;

  return (
    <dl className="mt-3 grid gap-2 border-t border-edge-subtle pt-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
      {fields.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-fg-subtle">{item.label}</dt>
          <dd className="mt-0.5 truncate font-medium text-fg-muted" title={item.value}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function agentStatusTone(status: WorkflowAgentSnapshot['status']): string {
  if (status === 'done') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'error') return 'bg-rose-500/10 text-rose-700 dark:text-rose-300';
  if (status === 'running') return 'bg-accent-soft text-accent-fg';
  return 'bg-surface-hover text-fg-subtle';
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-edge bg-surface-base/40 p-3">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-fg">{value}</dd>
    </div>
  );
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-fg" title={value}>{value}</div>
    </div>
  );
}
