/**
 * Top-level WorkflowCard — the only piece message-content-renderer.tsx wires
 * into the chat stream. It owns the state machine:
 *
 *   running   →  spinner + name + elapsed time + cancel
 *   completed →  result summary (priority) + collapsed progress tree (default)
 *                + save / copy / collapse actions
 *   failed    →  WorkflowErrorCard with reason and recovery guidance
 *
 * The component is intentionally a single file at the top (state + layout +
 * data plumbing); child pieces (Header, PhaseRow, AgentRow, ResultSummary,
 * ErrorCard) stay pure presentational and unit-testable on their own.
 */

import { memo, useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleStop, Copy, Check, GitBranch, Save } from 'lucide-react';

import type { ToolUseContent } from '@/features/chat/messages/messages.types';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { interaction } from '@/lib/interaction';

import { WorkflowAgentInlineDetail, type WorkflowAgentInlineDetailLabels } from './workflow-agent-inline-detail';
import { WorkflowCardHeader, type WorkflowCardHeaderLabels } from './workflow-card-header';
import { WorkflowErrorCard, type WorkflowErrorCardLabels } from './workflow-error-card';
import type { WorkflowPhaseRowLabels } from './workflow-phase-row';
import { ProgressTree } from './workflow-progress-display';
import { WorkflowResultSummary, type WorkflowResultSummaryLabels } from './workflow-result-summary';
import type { WorkflowAgentSnapshot } from './workflow.types';
import { isWorkflowResultEnvelope, stringifyWorkflowResult, workflowBoardHref } from '@/features/workflows/workflow-page.utils';
import {
  classifyFailure,
  buildWorkflowFailureContext,
  extractSnapshot,
  formatDuration,
  isWorkflowFailureOutcome,
  readErrorText,
  resolveCardStatus,
  rollupPhases,
} from './workflow.utils';

export type WorkflowCardLabels = {
  header: WorkflowCardHeaderLabels;
  phase: WorkflowPhaseRowLabels;
  result: WorkflowResultSummaryLabels;
  error: WorkflowErrorCardLabels;
  checkDetail: WorkflowAgentInlineDetailLabels;
  /** Header action button tooltips / a11y. */
  cancel: string;
  saveAria: string;
  saveTitle: string;
  copyAria: string;
  copyDoneAria: string;
  openInWorkflowsAria: string;
  openInWorkflowsTitle: string;
  viewSubagentsHeading: string;
  runningProgressHeading: string;
  runningAgentsHeading: string;
  completedAgentsHeading: string;
  queuedAgentsHeading: string;
  failedAgentsHeading: string;
  currentProgressTpl: (phase: string | undefined, running: number, done: number, total: number) => string;
  recentLogsHeading: string;
  showAllLogs: string;
  live: {
    details: string;
    openRun: string;
    stop: string;
    close: string;
    title: string;
    overview: string;
    agents: string;
    logs: string;
    result: string;
    currentState: string;
    runId: string;
    elapsed: string;
    progress: (done: number, total: number) => string;
    activeFallback: string;
    noResult: string;
    status: Record<'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout', string>;
  };
};

export interface WorkflowCardProps {
  block: ToolUseContent;
  /** Live elapsed-time anchor; set when the block transitions to running. */
  startedAt?: number;
  sessionKey?: string | null;
  /** Cancel handler — wired by parent (typically calls existing /abort path). */
  onAbort?: () => void;
  labels: WorkflowCardLabels;
  className?: string;
}

export const WorkflowCard = memo(function WorkflowCard({
  block,
  startedAt,
  onAbort,
  labels,
  className,
}: WorkflowCardProps) {
  const status = resolveCardStatus(block);
  const snapshot = useMemo(() => extractSnapshot(block), [block]);
  const navigate = useNavigate();
  const failureKind = status === 'failed' ? classifyFailure(block) : null;
  const errorReason = status === 'failed' ? readErrorText(block) : '';

  // Default-collapsed when completed: result summary stays prominent, progress
  // tree tucks into the second-level disclosure. Running stays expanded so the
  // user always sees what's happening.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (status === 'completed') setCollapsed(true);
    if (status === 'running' || status === 'failed') setCollapsed(false);
  }, [status]);

  const [showSubagentsAfterComplete, setShowSubagentsAfterComplete] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);

  const selectedAgent = useMemo(() => {
    if (selectedAgentId == null || !snapshot) return null;
    return snapshot.agents.find((a) => a.id === selectedAgentId) ?? null;
  }, [selectedAgentId, snapshot]);

  const handleSelectAgent = useCallback((agent: WorkflowAgentSnapshot) => {
    setSelectedAgentId(agent.id);
  }, []);

  const clearSelectedAgent = useCallback(() => {
    setSelectedAgentId(null);
  }, []);

  useEffect(() => {
    setSelectedAgentId(null);
  }, [snapshot?.runId, status]);

  // Live elapsed ticker for running state. Tick once a second; cleared on
  // status change.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (status !== 'running') return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const durationText = useMemo(() => {
    if (status === 'running') {
      if (!startedAt) return '';
      return formatDuration(Date.now() - startedAt);
    }
    if (snapshot?.durationMs != null) return formatDuration(snapshot.durationMs);
    return '';
  }, [status, startedAt, snapshot?.durationMs]);

  // ----- copy result -----
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    if (!snapshot || !isWorkflowResultEnvelope(snapshot.result)) return;
    const text = stringifyWorkflowResult(snapshot.result);
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [snapshot]);

  const openInWorkflows = useCallback(() => {
    const runId = snapshot?.runId?.trim();
    if (runId) {
      navigate(workflowBoardHref(runId));
      return;
    }
    const name = snapshot?.name?.trim();
    if (name) navigate(`/workflows?def=${encodeURIComponent(name)}`);
  }, [navigate, snapshot?.name, snapshot?.runId]);

  const openWorkflowCopyEditor = useCallback(() => {
    const name = snapshot?.name?.trim();
    if (!name) return;
    navigate(`/workflows?def=${encodeURIComponent(name)}&copy=1`);
  }, [navigate, snapshot?.name]);

  const handleCardClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const runId = snapshot?.runId?.trim();
    if (!runId) return;
    const target = event.target;
    if (target instanceof Element) {
      const interactive = target.closest('button,a,input,textarea,select,summary,[role="button"],[data-workflow-inline-detail]');
      if (interactive) return;
    }
    navigate(workflowBoardHref(runId));
  }, [navigate, snapshot?.runId]);

  // ----- render -----
  if (isWorkflowFailureOutcome(block) || (status === 'completed' && !snapshot)) {
    const kind = failureKind ?? classifyFailure(block);
    const failureCtx = buildWorkflowFailureContext(block);
    const failureSnapshot = failureCtx.snapshot;
    const failureSelectedAgent =
      selectedAgentId == null || !failureSnapshot
        ? null
        : failureSnapshot.agents.find((agent) => agent.id === selectedAgentId) ?? null;

    return (
      <>
        <WorkflowErrorCard
          kind={kind}
          reason={failureCtx.headline || errorReason || 'workflow failed'}
          detailLines={failureCtx.detailLines}
          logs={failureCtx.logs}
          failedAgents={failureCtx.failedAgents}
          snapshot={failureSnapshot}
          selectedAgentId={selectedAgentId}
          onSelectAgent={handleSelectAgent}
          labels={labels.error}
          className={className}
        />
        <WorkflowAgentInlineDetail
          agent={failureSelectedAgent}
          snapshot={failureSnapshot}
          labels={labels.checkDetail}
          className="mt-2"
          onClose={clearSelectedAgent}
        />
      </>
    );
  }

  const totalCount = snapshot?.agentCount ?? 0;
  const doneCount = snapshot?.doneCount ?? 0;
  const rollup = snapshot ? rollupPhases(snapshot) : { phases: [], unphased: null };
  const headerMetaText =
    status === 'running' && snapshot
      ? labels.currentProgressTpl(
          snapshot.currentPhase,
          snapshot.runningCount,
          snapshot.doneCount,
          snapshot.agentCount,
        )
      : undefined;

  const actions = (
    <>
      {status === 'running' && onAbort ? (
        <button
          type="button"
          onClick={onAbort}
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-md text-fg-muted',
            'hover:bg-surface-hover hover:text-rose-600 dark:hover:text-rose-400',
            interaction.transition,
            interaction.focusRingPanel,
          )}
          aria-label={labels.cancel}
          title={labels.cancel}
        >
          <CircleStop className="size-4" />
        </button>
      ) : null}
      {status === 'completed' && snapshot ? (
        <>
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-md text-fg-muted',
              'hover:bg-surface-hover hover:text-fg',
              interaction.transition,
              interaction.focusRingPanel,
            )}
            aria-label={copied ? labels.copyDoneAria : labels.copyAria}
            title={copied ? labels.copyDoneAria : labels.copyAria}
          >
            {copied ? <Check className="size-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="size-4" />}
          </button>
          {snapshot?.name ? (
            <button
              type="button"
              onClick={openWorkflowCopyEditor}
              className={cn(
                'inline-flex size-7 items-center justify-center rounded-md text-fg-muted',
                'hover:bg-surface-hover hover:text-fg',
                interaction.transition,
                interaction.focusRingPanel,
              )}
              aria-label={labels.saveAria}
              title={labels.saveTitle}
            >
              <Save className="size-4" />
            </button>
          ) : null}
          {snapshot?.name ? (
            <button
              type="button"
              onClick={openInWorkflows}
              className={cn(
                'inline-flex size-7 items-center justify-center rounded-md text-fg-muted',
                'hover:bg-surface-hover hover:text-fg',
                interaction.transition,
                interaction.focusRingPanel,
              )}
              aria-label={labels.openInWorkflowsAria}
              title={labels.openInWorkflowsTitle}
            >
              <GitBranch className="size-4" />
            </button>
          ) : null}
        </>
      ) : null}
    </>
  );

  return (
    <>
    <div
      onClick={handleCardClick}
      className={cn(
        'min-w-0 rounded-xl border border-edge bg-surface-panel shadow-surface',
        snapshot?.runId && 'cursor-pointer hover:bg-surface-hover/35',
        className,
      )}
      role="group"
      aria-label={snapshot ? `Workflow ${snapshot.name}` : 'Workflow'}
    >
      <WorkflowCardHeader
        name={snapshot?.name ?? block.name}
        description={snapshot?.description}
        status={status}
        doneCount={doneCount}
        totalCount={totalCount}
        durationText={durationText}
        metaText={headerMetaText}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
        actions={actions}
        labels={labels.header}
      />

      {!collapsed ? (
        <div className="space-y-3 px-3 py-2.5">
          {status === 'completed' && snapshot ? (
            <WorkflowResultSummary
              result={isWorkflowResultEnvelope(snapshot.result) ? snapshot.result : null}
              labels={labels.result}
            />
          ) : null}

          {status === 'running' && snapshot ? (
            <div className="rounded-lg border border-edge-subtle bg-surface-base/45 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
                <span className="min-w-0 truncate">
                  {snapshot.currentPhase ?? labels.live.activeFallback}
                </span>
                <span className="shrink-0 tabular-nums">
                  {labels.live.progress(snapshot.doneCount, snapshot.agentCount)}
                </span>
              </div>
              {snapshot.agentCount > 0 ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-hover">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${Math.round((snapshot.doneCount / snapshot.agentCount) * 100)}%` }}
                  />
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={cn(
                    'rounded-md px-2 py-1 text-xs font-medium text-accent-fg hover:bg-accent-soft',
                    interaction.focusRingPanel,
                  )}
                  onClick={openInWorkflows}
                >
                  {labels.live.details}
                </button>
              </div>
            </div>
          ) : null}

          {status === 'running' && !snapshot ? (
            <div className="py-1 text-sm text-fg-subtle">
              <span className="inline-block size-2 animate-pulse rounded-full bg-accent align-middle" />
              <span className="ml-2 align-middle">{labels.viewSubagentsHeading}</span>
            </div>
          ) : null}

          {status === 'completed' && snapshot && (rollup.phases.length > 0 || rollup.unphased) ? (
            <details
              className="group"
              open={showSubagentsAfterComplete}
              onToggle={(e) => setShowSubagentsAfterComplete((e.target as HTMLDetailsElement).open)}
            >
              <summary className="cursor-pointer select-none text-xs text-fg-subtle underline-offset-2 hover:text-fg-muted">
                {labels.viewSubagentsHeading}
              </summary>
              <div className="mt-2">
                <ProgressTree
                  rollup={rollup}
                  currentPhase={undefined}
                  labels={labels.phase}
                  recentLogs={[]}
                  recentLogsHeading={labels.recentLogsHeading}
                  showAllLogsLabel={labels.showAllLogs}
                  logsExpanded={false}
                  onToggleLogs={() => {}}
                  selectedAgentId={selectedAgentId}
                  onSelectAgent={handleSelectAgent}
                />
                <WorkflowAgentInlineDetail
                  agent={selectedAgent}
                  snapshot={snapshot}
                  labels={labels.checkDetail}
                  className="mt-2"
                  onClose={clearSelectedAgent}
                />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>

    </>
  );
});
