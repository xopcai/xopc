import { Check, CircleStop, Copy, Download, MessageSquare, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { workflowCardLabels } from '@/features/chat/workflow/workflow-card-labels';
import { dispatchFillChatComposer } from '@/features/chat/composer/fill-composer-dispatch';
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
import type { WorkflowRunView } from './workflow-api';
import { ACTIVE_RUN_STATUSES } from './workflow-page.constants';
import {
  formatDuration,
  formatTime,
  interpolate,
  resolveWorkflowResultForDisplay,
  statusTone,
  stringifyWorkflowResult,
} from './workflow-page.utils';

type WorkflowsMessages = ReturnType<typeof messages>['workflows'];

function statusLabel(status: WorkflowRunView['run']['status'], labels: WorkflowsMessages): string {
  return labels.status[status] ?? status;
}

function phaseStatusLabel(status: string, labels: WorkflowsMessages): string {
  return labels.phaseStatus[status as keyof WorkflowsMessages['phaseStatus']] ?? status;
}

export function WorkflowRunPanel({
  view,
  loading,
  language,
  localeTag,
  onCancel,
  onRetry,
}: {
  view: WorkflowRunView | undefined;
  loading: boolean;
  language: StoredLanguage;
  localeTag: string;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const labels = messages(language).workflows;
  const cardLabels = workflowCardLabels(language);
  const navigate = useNavigate();

  const [processExpanded, setProcessExpanded] = useState(true);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [drawerAgentId, setDrawerAgentId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);

  const runStatus = view?.run.status;
  const isActive = runStatus ? ACTIVE_RUN_STATUSES.has(runStatus) : false;

  useEffect(() => {
    if (!view?.run.id) return;
    setProcessExpanded(isActive);
    setDrawerAgentId(null);
  }, [view?.run.id, isActive]);

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
    const prompt = interpolate(labels.continueInChatPrompt, {
      workflow: view.run.definitionId,
      goal: view.run.goal || view.run.title,
    });
    dispatchFillChatComposer(prompt);
    navigate('/chat');
  }, [labels.continueInChatPrompt, navigate, view]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-edge bg-surface-panel p-6 text-sm text-fg-muted">
        {labels.loading}
      </div>
    );
  }

  if (!view || !snapshot) {
    return (
      <div className="rounded-2xl border border-dashed border-edge p-6 text-sm text-fg-muted">
        {labels.selectRunHint}
      </div>
    );
  }

  const { run } = view;
  const canCancel = view.controls.canCancel && isActive;
  const durationText = isActive && run.startedAtMs != null
    ? formatDuration(Date.now() - run.startedAtMs)
    : formatDuration(run.metrics.durationMs ?? undefined);

  return (
    <>
      <section className="rounded-2xl border border-edge bg-surface-panel p-5">
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
            {run.error ? (
              <p className="mt-3 text-sm leading-6 text-red-600 dark:text-red-300">{run.error.message}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
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
          </div>
        </div>

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
            <span className="text-xs text-fg-muted">{processExpanded ? labels.collapse : labels.expand}</span>
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

        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-fg">{labels.resultTitle}</h3>
            {hasResult ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={handleCopy}>
                  {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                  {copied ? labels.copied : labels.copyResult}
                </Button>
                <Button variant="secondary" onClick={handleExport}>
                  <Download className="size-4" aria-hidden />
                  {labels.exportResult}
                </Button>
                <Button variant="secondary" onClick={continueInChat}>
                  <MessageSquare className="size-4" aria-hidden />
                  {labels.continueInChat}
                </Button>
              </div>
            ) : null}
          </div>
          {hasResult ? (
            <div className="mt-3 rounded-xl border border-edge bg-surface-base/50 p-3">
              <WorkflowResultSummary result={resultForDisplay} labels={cardLabels.result} />
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-edge p-4 text-sm text-fg-muted">
              {labels.noResult}
            </div>
          )}
        </div>
      </section>

      <WorkflowAgentDetailDrawer
        open={drawerAgentId != null && drawerAgent != null}
        agent={drawerAgent}
        snapshot={snapshot}
        sessionKey={null}
        pinnedAgentId={null}
        onPinAgent={() => {}}
        onClose={() => setDrawerAgentId(null)}
        labels={cardLabels.drawer}
      />
    </>
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
