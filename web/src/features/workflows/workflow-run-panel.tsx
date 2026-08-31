import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleStop,
  Copy,
  Download,
  MessageSquare,
  RotateCcw,
  WandSparkles,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Button } from '@/components/ui/button';
import { PageTabs } from '@/components/ui/page-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { workflowCardLabels } from '@/features/chat/workflow/workflow-card-labels';
import { ProgressTree, RunningProgressPanel } from '@/features/chat/workflow/workflow-progress-display';
import { WorkflowResultSummary } from '@/features/chat/workflow/workflow-result-summary';
import type { WorkflowAgentSnapshot, WorkflowSnapshot } from '@/features/chat/workflow/workflow.types';
import { formatAgentElapsed, rollupPhases, type PhaseRollup } from '@/features/chat/workflow/workflow.utils';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import { runViewToSnapshot } from './run-view-to-snapshot';
import { WorkflowRunGraph } from './workflow-run-graph';
import {
  downloadWorkflowArtifact,
  type WorkflowArtifactRef,
  type WorkflowFollowUp,
  type WorkflowNextAction,
  type WorkflowResultEnvelope,
  type WorkflowRunComparison,
  type WorkflowRunReplayScope,
  type WorkflowRunView,
} from './workflow-api';
import { ACTIVE_RUN_STATUSES, type WorkflowRunPanelTab } from './workflow-page.constants';
import {
  collectWorkflowRunDiagnostics,
  formatDuration,
  formatTime,
  interpolate,
  resolveWorkflowResultForDisplay,
  resolveWorkflowSessionKey,
  statusTone,
  workflowResultToMarkdown,
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

export function WorkflowRunPanel({
  view,
  comparison,
  loading,
  language,
  localeTag,
  activeTab,
  onTabChange,
  onCancel,
  onRetry,
  onReplay,
  onOpenRunId,
  ownerAgentId,
  onRepairWorkflow,
}: {
  view: WorkflowRunView | undefined;
  comparison?: WorkflowRunComparison;
  loading: boolean;
  language: StoredLanguage;
  localeTag: string;
  activeTab: WorkflowRunPanelTab;
  onTabChange: (tab: WorkflowRunPanelTab) => void;
  onCancel: () => void;
  onRetry: () => void;
  onReplay: (scope: WorkflowRunReplayScope) => void;
  onOpenRunId?: (runId: string) => void;
  ownerAgentId?: string;
  onRepairWorkflow?: () => void;
}) {
  const labels = messages(language).workflows;
  const cardLabels = workflowCardLabels(language);
  const navigate = useNavigate();

  const [processExpanded, setProcessExpanded] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const runStatus = view?.run.status;
  const isActive = runStatus ? ACTIVE_RUN_STATUSES.has(runStatus) : false;

  useEffect(() => {
    if (!view?.run.id) return;

    setProcessExpanded(false);
    setDownloadError(null);
  }, [view?.run.id, isActive, runStatus, view?.run.metrics.errorAgentCount]);

  useEffect(() => {
    if (!isActive) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [isActive]);

  const snapshot = useMemo(() => (view ? runViewToSnapshot(view) : null), [view]);
  const rollup = useMemo(() => (snapshot ? rollupPhases(snapshot) : { phases: [], unphased: null }), [snapshot]);
  const selectedAgent = useMemo(() => {
    if (selectedAgentId == null || !snapshot) return null;
    return snapshot.agents.find((agent) => agent.id === selectedAgentId) ?? null;
  }, [selectedAgentId, snapshot]);

  useEffect(() => {
    if (!snapshot?.runId) return;
    const nextDefaultAgent =
      snapshot.agents.find((agent) => agent.status === 'error' || agent.status === 'skipped')
      ?? snapshot.agents.find((agent) => agent.status === 'running')
      ?? null;
    setSelectedAgentId(nextDefaultAgent?.id ?? null);
  }, [snapshot?.runId]);

  const handleSelectAgent = useCallback((agent: WorkflowAgentSnapshot) => {
    setSelectedAgentId(agent.id);
  }, []);

  const diagnostics = useMemo(() => (view ? collectWorkflowRunDiagnostics(view) : []), [view]);
  const resultForDisplay = view ? resolveWorkflowResultForDisplay(view.run.result) : undefined;
  const task = resultForDisplay ? resolveWorkflowTask(resultForDisplay) : null;
  const resultText = resultForDisplay ? workflowResultToMarkdown(resultForDisplay) : '';
  const hasResult = Boolean(resultForDisplay);

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

  const handleResultAction = useCallback((action: WorkflowNextAction) => {
    if (action.kind === 'copy_result') {
      void handleCopy();
      return;
    }
    if (action.kind === 'open_artifact') {
      const artifactId = resultActionReference(action.payload);
      const artifact = task?.artifacts.find((item) => item.id === artifactId || item.name === artifactId);
      if (artifact) void handleDownloadArtifact(artifact);
      return;
    }
    const followUpId = resultActionReference(action.payload);
    const followUp = task?.followUps.find((item) => item.id === followUpId);
    if (followUp?.prompt) {
      handleStartFollowUp(followUp);
      return;
    }
    const prompt = resultActionPrompt(action.payload);
    if (!prompt) return;
    handleStartFollowUp({ id: action.id, title: action.label, prompt });
  }, [handleCopy, handleDownloadArtifact, handleStartFollowUp, task?.artifacts, task?.followUps]);

  const openDiagnosticAgent = useCallback((agentId: string | number | undefined) => {
    if (!view || agentId == null) return;
    const rawAgentId = String(agentId);
    const index = view.agents.findIndex((agent) => String(agent.id) === rawAgentId);
    if (index < 0) return;
    const parsed = Number.parseInt(rawAgentId, 10);
    setSelectedAgentId(Number.isFinite(parsed) ? parsed : index + 1);
  }, [view]);
  const workflowSessionKey = view ? resolveWorkflowSessionKeyFromView(view) : null;
  const resultActions = task?.actions.filter((action) => isResultActionAvailable(action, task)) ?? [];
  const hasEnvelopeCopyAction = resultActions.some((action) => action.kind === 'copy_result');

  if (loading) {
    return (
      <main className="min-h-0 flex-1 overflow-y-auto bg-surface-panel p-5">
        <div className="mx-auto w-full max-w-6xl" aria-busy>
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="mt-4 h-28 rounded-2xl" />
          <Skeleton className="mt-5 h-[28rem] rounded-2xl" />
        </div>
      </main>
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
  const canReplayFailedAgents = view.controls.canRetry && view.agents.some((agent) => (agent.status === 'error' || agent.status === 'skipped') && agent.prompt?.trim());
  const canReplayFailedPhases = view.controls.canRetry && (
    view.phases.some((phase) => phase.status === 'failed' && view.agents.some((agent) => agent.phaseId === phase.id && agent.prompt?.trim()))
    || view.agents.some((agent) => (agent.status === 'error' || agent.status === 'skipped') && agent.phaseId && agent.prompt?.trim())
  );
  const displayTitle = run.goal?.trim() || run.title;
  const focusNode = view.nodes.find((node) => node.status === 'running')
    ?? view.nodes.find((node) => node.status === 'error')
    ?? [...view.nodes].reverse().find((node) => node.status === 'done');
  const currentActivityMarkdown = focusNode?.kind === 'output' && !focusNode.error
    ? resultForDisplay?.summary ?? focusNode.resultPreview
    : null;
  const currentActivity = currentActivityMarkdown ?? (focusNode
    ? focusNode.error || (language === 'zh'
      ? `${focusNode.status === 'running' ? '正在执行' : focusNode.status === 'done' ? '刚刚完成' : '需要处理'}：${focusNode.title}`
      : `${focusNode.status === 'running' ? 'Working on' : focusNode.status === 'done' ? 'Just completed' : 'Needs attention'}: ${focusNode.title}`)
    : runSummary);
  const hasDiagnostics = diagnostics.length > 0 || Boolean(diagnosticHint);
  const canRepair = (run.status === 'failed' || run.status === 'timeout') && Boolean(onRepairWorkflow);
  const visibleActiveTab: WorkflowRunPanelTab =
    activeTab === 'diagnostics' || activeTab === 'debug' ? 'process' : activeTab;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-surface-panel">
      <section className="mx-auto w-full max-w-6xl p-5">
              <header className="rounded-2xl border border-edge-subtle bg-surface-base/60 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold leading-7 text-fg">{displayTitle}</h2>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusTone(run.status))}>
                        {statusLabel(run.status, labels)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-fg-subtle">
                      {run.title} · {run.definitionId}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-fg-muted">{runSummary}</p>
                    {diagnosticHint ? <p className="mt-2 text-xs leading-5 text-fg-subtle">{diagnosticHint}</p> : null}
                    <div className={cn('mt-4 rounded-xl border px-3 py-2.5', focusNode?.status === 'error' ? 'border-danger/30 bg-danger/5' : 'border-accent/20 bg-accent-soft/50')}>
                      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{language === 'zh' ? '当前状态' : 'Current status'}</div>
                      {currentActivityMarkdown ? (
                        <div className="mt-2 max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]">
                          <MarkdownView
                            content={currentActivity}
                            compact
                            className="workflow-status-markdown"
                            codeCopy={false}
                            renderMermaid={false}
                          />
                        </div>
                      ) : (
                        <p className="mt-1 text-sm font-medium text-fg">{currentActivity}</p>
                      )}
                    </div>
                  </div>
                </div>
                <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              </header>

              <WorkflowRunTabs
                activeTab={visibleActiveTab}
                onChange={onTabChange}
                labels={labels}
                artifactCount={task?.artifacts.length ?? view.artifacts.length}
              />

              {visibleActiveTab === 'result' ? (
                <section className="mt-5 space-y-4">
                  {hasResult ? (
                    <section className="overflow-hidden rounded-2xl border border-edge bg-surface-base">
                      <header className="flex flex-col gap-3 border-b border-edge-subtle bg-surface-panel/45 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-fg">{labels.resultTitle}</h3>
                          <p className="mt-0.5 text-xs text-fg-subtle">{labels.resultReadyHint}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {workflowSessionKey ? (
                            <Button variant="primary" className="h-8 text-xs" onClick={continueInChat}>
                              <MessageSquare className="size-3.5" aria-hidden />
                              {labels.continueInChat}
                            </Button>
                          ) : null}
                          {resultActions.map((action) => (
                            <Button key={action.id} variant="secondary" className="h-8 text-xs" onClick={() => handleResultAction(action)}>
                              {action.label}
                            </Button>
                          ))}
                          {!hasEnvelopeCopyAction ? (
                            <Button variant="secondary" className="h-8 text-xs" onClick={handleCopy}>
                              {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                              {copied ? labels.copied : labels.copyResult}
                            </Button>
                          ) : null}
                          <Button variant="secondary" className="h-8 text-xs" onClick={handleExport}>
                            <Download className="size-3.5" aria-hidden />
                            {labels.exportResult}
                          </Button>
                        </div>
                      </header>
                      <div className="px-5 py-6 sm:px-8 sm:py-8">
                        <div className="mx-auto w-full max-w-4xl">
                          <WorkflowResultSummary result={resultForDisplay} labels={cardLabels.result} />
                        </div>
                      </div>
                    </section>
                  ) : run.status !== 'failed' && run.status !== 'timeout' ? (
                    <div className="rounded-xl border border-dashed border-edge p-4 text-sm text-fg-muted">
                      {labels.noResult}
                    </div>
                  ) : null}

                  {(run.status === 'failed' || run.status === 'timeout') ? (
                    <>
                      <section className="flex flex-col gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-fg">{labels.recoveryActionsTitle}</h3>
                          <p className="mt-1 text-xs leading-5 text-fg-muted">{diagnosticHint}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {canRepair ? (
                            <Button variant="primary" onClick={onRepairWorkflow}>
                              <WandSparkles className="size-4" aria-hidden />
                              {language === 'zh' ? '让 AI 修复' : 'Fix with AI'}
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
                          {view.controls.canRetry ? (
                            <Button variant="secondary" onClick={onRetry}>
                              <RotateCcw className="size-4" aria-hidden />
                              {labels.rerun}
                            </Button>
                          ) : null}
                        </div>
                      </section>
                      <WorkflowPartialResults view={view} language={language} />
                    </>
                  ) : null}

                  {task ? (
                    <WorkflowTaskPanel
                      task={task}
                      labels={labels}
                      downloadingArtifactId={downloadingArtifactId}
                      downloadError={downloadError}
                      onCopyText={(text) => void copyTextToClipboard(text)}
                      onDownloadArtifact={(artifact) => void handleDownloadArtifact(artifact)}
                      onStartFollowUp={handleStartFollowUp}
                      compact
                    />
                  ) : null}

                  {canCancel ? (
                    <div className="flex justify-end">
                      <Button variant="secondary" onClick={onCancel} className="text-red-600 dark:text-red-300">
                        <CircleStop className="size-4" aria-hidden />
                        {labels.cancel}
                      </Button>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {visibleActiveTab === 'process' ? (
                <>
                  {view.run.metadata?.definition.graph ? (
                    <WorkflowRunGraph
                      graph={view.run.metadata.definition.graph}
                      view={view}
                      language={language}
                      onRepair={onRepairWorkflow}
                    />
                  ) : null}
                  {hasDiagnostics ? (
                    <WorkflowDiagnosticsPanel
                      diagnostics={diagnostics}
                      labels={labels}
                      hint={diagnosticHint}
                      onOpenAgent={openDiagnosticAgent}
                    />
                  ) : null}

                  <WorkflowProcessPanel
                    snapshot={snapshot}
                    rollup={rollup}
                    view={view}
                    labels={labels}
                    cardLabels={cardLabels}
                    isActive={isActive}
                    processExpanded={processExpanded}
                    logsExpanded={logsExpanded}
                    selectedAgentId={selectedAgentId}
                    selectedAgent={selectedAgent}
                    durationText={durationText}
                    onToggleProcess={() => setProcessExpanded((expanded) => !expanded)}
                    onToggleLogs={() => setLogsExpanded((value) => !value)}
                    onSelectAgent={handleSelectAgent}
                  />

                  <WorkflowReplayLineagePanel
                    view={view}
                    comparison={comparison}
                    labels={labels}
                    onOpenRunId={onOpenRunId}
                  />
                  <WorkflowBindingPanel view={view} labels={labels} />

                </>
              ) : null}

              {visibleActiveTab === 'artifacts' ? (
                <WorkflowTaskPanel
                  task={task}
                  labels={labels}
                  downloadingArtifactId={downloadingArtifactId}
                  downloadError={downloadError}
                  onCopyText={(text) => void copyTextToClipboard(text)}
                  onDownloadArtifact={(artifact) => void handleDownloadArtifact(artifact)}
                  onStartFollowUp={handleStartFollowUp}
                />
              ) : null}
      </section>
    </main>
  );
}

function WorkflowDiagnosticsPanel({
  diagnostics,
  labels,
  hint,
  onOpenAgent,
}: {
  diagnostics: WorkflowRunDiagnosticItem[];
  labels: WorkflowsMessages;
  hint?: string | null;
  onOpenAgent: (agentId: string | number | undefined) => void;
}) {
  if (diagnostics.length === 0 && !hint) return null;

  return (
    <section className="mt-5 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-rose-500/10 p-2 text-rose-700 dark:text-rose-300">
          <AlertTriangle className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">{labels.reliabilityTitle}</h3>
          <p className="mt-1 text-xs leading-5 text-fg-subtle">{hint ?? labels.reliabilityHint}</p>
          {diagnostics.length > 0 ? (
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
          ) : null}
        </div>
      </div>
    </section>
  );
}

function WorkflowRunTabs({
  activeTab,
  onChange,
  labels,
  artifactCount,
}: {
  activeTab: WorkflowRunPanelTab;
  onChange: (tab: WorkflowRunPanelTab) => void;
  labels: WorkflowsMessages;
  artifactCount: number;
}) {
  const tabs: Array<{ id: WorkflowRunPanelTab; label: string; count?: number }> = [
    { id: 'result', label: labels.resultTitle },
    { id: 'process', label: labels.process },
    { id: 'artifacts', label: labels.taskArtifacts, count: artifactCount || undefined },
  ];

  return (
    <div className="mt-5 flex overflow-x-auto border-b border-edge pb-2">
      <PageTabs items={tabs} activeTab={activeTab} onChange={onChange} ariaLabel={labels.taskActionsAria} />
    </div>
  );
}

function WorkflowProcessPanel({
  snapshot,
  rollup,
  view,
  labels,
  cardLabels,
  isActive,
  processExpanded,
  logsExpanded,
  selectedAgentId,
  selectedAgent,
  durationText,
  onToggleProcess,
  onToggleLogs,
  onSelectAgent,
}: {
  snapshot: WorkflowSnapshot;
  rollup: { phases: PhaseRollup[]; unphased: PhaseRollup | null };
  view: WorkflowRunView;
  labels: WorkflowsMessages;
  cardLabels: ReturnType<typeof workflowCardLabels>;
  isActive: boolean;
  processExpanded: boolean;
  logsExpanded: boolean;
  selectedAgentId: number | null;
  selectedAgent: WorkflowAgentSnapshot | null;
  durationText: string;
  onToggleProcess: () => void;
  onToggleLogs: () => void;
  onSelectAgent: (agent: WorkflowAgentSnapshot) => void;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-edge bg-surface-base/35">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
        onClick={onToggleProcess}
        aria-expanded={processExpanded}
      >
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{labels.process}</h3>
          <p className="mt-1 text-xs text-fg-subtle">
            {interpolate(labels.agentProgress, {
              done: view.run.metrics.doneAgentCount,
              total: view.run.metrics.agentCount,
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
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
            <div className="min-w-0">
              {isActive ? (
                <RunningProgressPanel
                  snapshot={snapshot}
                  labels={cardLabels}
                  logsExpanded={logsExpanded}
                  onToggleLogs={onToggleLogs}
                  selectedAgentId={selectedAgentId}
                  onSelectAgent={onSelectAgent}
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
                  onToggleLogs={onToggleLogs}
                  selectedAgentId={selectedAgentId}
                  onSelectAgent={onSelectAgent}
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

            <WorkflowAgentInspector
              agent={selectedAgent}
              snapshot={snapshot}
              labels={labels}
              cardLabels={cardLabels}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WorkflowAgentInspector({
  agent,
  snapshot,
  labels,
  cardLabels,
}: {
  agent: WorkflowAgentSnapshot | null;
  snapshot: WorkflowSnapshot;
  labels: WorkflowsMessages;
  cardLabels: ReturnType<typeof workflowCardLabels>;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    setAdvancedOpen(false);
  }, [agent?.id]);

  if (!agent) {
    return (
      <aside className="min-w-0 rounded-2xl border border-dashed border-edge bg-surface-panel/45 p-4 text-sm text-fg-muted">
        {labels.noSubagents}
      </aside>
    );
  }

  const elapsed = formatAgentElapsed(agent);
  const output = agent.error || agent.resultPreview || agent.currentStep || cardLabels.checkDetail.runningPlaceholder;

  return (
    <aside className="min-w-0 rounded-2xl border border-edge bg-surface-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">{agent.label}</h3>
          <p className="mt-1 text-xs text-fg-subtle">{[agent.phase || labels.process, elapsed].filter(Boolean).join(' · ')}</p>
        </div>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', agentStatusTone(agent.status))}>
          {labels.agentStatus[agent.status] ?? agent.status}
        </span>
      </div>

      <section className="mt-4 rounded-xl border border-edge-subtle bg-surface-base/60 p-3">
        <h4 className="text-xs font-semibold text-fg">{labels.agentOutputHeading}</h4>
        <div
          className={cn(
            'mt-2 max-h-72 overflow-auto whitespace-pre-wrap wrap-break-word text-sm leading-6',
            agent.error ? 'font-mono text-rose-600 dark:text-rose-400' : 'text-fg-muted',
          )}
        >
          {output}
        </div>
      </section>

      <section className="mt-3 rounded-xl border border-edge-subtle bg-surface-base/40">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold text-fg"
          onClick={() => setAdvancedOpen((value) => !value)}
          aria-expanded={advancedOpen}
        >
          {labels.debugDetailsTitle}
          <ChevronDown className={cn('size-4 shrink-0 text-fg-subtle transition-transform', advancedOpen && 'rotate-180')} aria-hidden />
        </button>
        {advancedOpen ? (
          <div className="space-y-3 border-t border-edge-subtle p-3">
            {agent.steps?.length ? (
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{cardLabels.checkDetail.stepsHeading}</div>
                <div className="mt-2 space-y-2">
                  {agent.steps.slice(0, 8).map((step) => (
                    <div key={step.id} className="rounded-lg bg-surface-panel px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-medium text-fg">{step.label}</span>
                        <span className="shrink-0 text-[10px] text-fg-subtle">{step.status}</span>
                      </div>
                      {step.detail || step.resultPreview || step.error ? <p className="mt-1 text-xs leading-5 text-fg-muted">{step.error || step.resultPreview || step.detail}</p> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{labels.agentInputHeading}</div>
              <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap wrap-break-word rounded-lg bg-surface-panel p-2 font-mono text-xs leading-5 text-fg-muted">
                {agent.prompt || '—'}
              </pre>
            </div>
            <AgentInvocationSnapshotView agent={agent} labels={labels} />
            {snapshot.logs.length > 0 ? (
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{cardLabels.recentLogsHeading}</div>
                <div className="mt-1 max-h-36 space-y-0.5 overflow-auto rounded-lg bg-surface-panel p-2 font-mono text-xs text-fg-subtle">
                  {snapshot.logs.map((line) => (
                    <div key={line} className="wrap-break-word">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </aside>
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

function WorkflowBindingPanel({ view, labels }: { view: WorkflowRunView; labels: WorkflowsMessages }) {
  const refs = view.run.metadata?.contextRefs ?? [];
  const snapshot = view.run.metadata?.contextSnapshot;
  const targets = view.run.metadata?.writebackPolicy?.targets ?? [];
  if (!refs.length && !targets.length) return null;

  return (
    <section className="mt-5 rounded-2xl border border-edge-subtle bg-surface-base/35 p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{labels.contextRefsTitle}</h3>
          <p className="mt-1 text-xs leading-5 text-fg-subtle">
            {snapshot
              ? labels.contextSnapshotSummary.replace('{{count}}', String(snapshot.totalTokens))
              : labels.contextRefsHint}
          </p>
          <div className="mt-3 grid gap-2">
            {refs.length ? refs.map((ref) => (
              <MetadataItem
                key={`${ref.kind}:${ref.id}:${ref.role ?? ''}`}
                label={labels.contextRefKinds[ref.kind] ?? ref.kind}
                value={[ref.title || ref.id, ref.role].filter(Boolean).join(' · ')}
              />
            )) : <p className="text-xs text-fg-muted">{labels.noContextRefs}</p>}
          </div>
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{labels.writebackTitle}</h3>
          <p className="mt-1 text-xs leading-5 text-fg-subtle">{labels.writebackHint}</p>
          <div className="mt-3 grid gap-2">
            {targets.length ? targets.map((target) => (
              <MetadataItem
                key={`${target.kind}:${target.id}:${target.mode}`}
                label={labels.writebackTargetKinds[target.kind] ?? target.kind}
                value={`${target.id} · ${labels.writebackModes[target.mode] ?? target.mode}`}
              />
            )) : <p className="text-xs text-fg-muted">{labels.noWritebackTargets}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function formatDurationDelta(deltaMs: number | null): string {
  if (deltaMs == null) return '—';
  const sign = deltaMs > 0 ? '+' : deltaMs < 0 ? '-' : '';
  return `${sign}${formatDuration(Math.abs(deltaMs))}`;
}

function replayScopeLabel(scope: WorkflowRunReplayScope, labels: WorkflowsMessages): string {
  return scope === 'failed_phases' ? labels.replayScopeFailedPhases : labels.replayScopeFailedAgents;
}

function WorkflowPartialResults({ view, language }: { view: WorkflowRunView; language: StoredLanguage }) {
  const completed = view.nodes.filter((node) => node.status === 'done' && node.resultPreview?.trim());
  const failed = view.nodes.filter((node) => node.status === 'error');
  if (completed.length === 0 && failed.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
      <h3 className="text-sm font-semibold text-fg">{language === 'zh' ? '已保留的阶段结果' : 'Work completed before the failure'}</h3>
      <p className="mt-1 text-xs leading-5 text-fg-muted">
        {language === 'zh' ? '失败不会清空已经完成的工作。你可以先使用这些结果，再让 AI 修复剩余步骤。' : 'Completed work is preserved. You can use it now and ask AI to repair the remaining steps.'}
      </p>
      {completed.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {completed.map((node) => (
            <li key={node.id} className="rounded-xl border border-edge-subtle bg-surface-base/60 px-3 py-2.5">
              <div className="text-sm font-medium text-fg">{node.title}</div>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-fg-muted">{node.resultPreview}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {failed.length > 0 ? (
        <p className="mt-3 text-xs text-danger">
          {language === 'zh' ? `待修复：${failed.map((node) => node.title).join('、')}` : `Needs repair: ${failed.map((node) => node.title).join(', ')}`}
        </p>
      ) : null}
    </section>
  );
}

function WorkflowTaskPanel({
  task,
  labels,
  downloadingArtifactId,
  downloadError,
  onCopyText,
  onDownloadArtifact,
  onStartFollowUp,
  compact = false,
}: {
  task: WorkflowTaskView | null;
  labels: WorkflowsMessages;
  downloadingArtifactId: string | null;
  downloadError: string | null;
  onCopyText: (text: string) => void;
  onDownloadArtifact: (artifact: WorkflowArtifactRef) => void;
  onStartFollowUp: (followUp: WorkflowFollowUp) => void;
  compact?: boolean;
}) {
  if (!task || (!task.artifacts.length && !task.followUps.length)) {
    if (compact) return null;
    return (
      <section className="mt-5 rounded-xl border border-dashed border-edge p-4 text-sm text-fg-muted">
        {labels.noArtifacts}
      </section>
    );
  }

  return (
    <div className={cn('grid gap-3 lg:grid-cols-3', !compact && 'mt-5')}>
      {task.artifacts.length > 0 ? (
        <TaskCard title={labels.taskArtifacts}>
          <ul className="space-y-2">
            {task.artifacts.map((artifact) => (
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
        </TaskCard>
      ) : null}

      {task.followUps.length > 0 ? (
        <TaskCard title={labels.taskFollowUps}>
          <ul className="space-y-2">
            {task.followUps.map((followUp) => (
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
        </TaskCard>
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

function TaskCard({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 rounded-xl border border-edge-subtle bg-surface-base/35 p-3', className)}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</h4>
      <div className="mt-2">{children}</div>
    </section>
  );
}

interface WorkflowTaskView {
  actions: WorkflowNextAction[];
  artifacts: WorkflowArtifactRef[];
  followUps: WorkflowFollowUp[];
}

function resolveWorkflowTask(result: unknown): WorkflowTaskView | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const envelope = result as Partial<WorkflowResultEnvelope>;
  const actions = Array.isArray(envelope.actions) ? envelope.actions : [];
  const artifacts = Array.isArray(envelope.artifacts) ? envelope.artifacts : [];
  const followUps = Array.isArray(envelope.followUps) ? envelope.followUps : [];
  if (actions.length === 0 && artifacts.length === 0 && followUps.length === 0) return null;
  return { actions, artifacts, followUps };
}

function resultActionPayloadRecord(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
}

function resultActionReference(payload: unknown): string | null {
  if (typeof payload === 'string') return payload.trim() || null;
  const record = resultActionPayloadRecord(payload);
  if (!record) return null;
  for (const key of ['artifactId', 'followUpId', 'id', 'name']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  return null;
}

function resultActionPrompt(payload: unknown): string | null {
  const record = resultActionPayloadRecord(payload);
  if (!record) return null;
  for (const key of ['prompt', 'message', 'text']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  return null;
}

function isResultActionAvailable(action: WorkflowNextAction, task: WorkflowTaskView): boolean {
  if (action.kind === 'copy_result') return true;
  const reference = resultActionReference(action.payload);
  if (action.kind === 'open_artifact') {
    return Boolean(reference && task.artifacts.some((item) => item.id === reference || item.name === reference));
  }
  if (action.kind === 'start_followup') {
    return Boolean(resultActionPrompt(action.payload) || (reference && task.followUps.some((item) => item.id === reference && item.prompt)));
  }
  return Boolean(resultActionPrompt(action.payload));
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
