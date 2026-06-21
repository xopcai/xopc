/**
 * Top-level WorkflowCard — the only piece message-content-renderer.tsx wires
 * into the chat stream. It owns the state machine:
 *
 *   running   →  spinner + name + elapsed time + cancel
 *   completed →  result summary (priority) + collapsed progress tree (default)
 *                + save / copy / collapse actions
 *   failed    →  WorkflowErrorCard with reason + script preview
 *
 * The component is intentionally a single file at the top (state + layout +
 * data plumbing); child pieces (Header, PhaseRow, AgentRow, ResultSummary,
 * ErrorCard) stay pure presentational and unit-testable on their own.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleStop, Copy, Check, GitBranch, MoreHorizontal, Save } from 'lucide-react';

import type { ToolUseContent } from '@/features/chat/messages/messages.types';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { interaction } from '@/lib/interaction';

import { WorkflowAgentDetailModal, type WorkflowAgentDetailModalLabels } from './workflow-agent-detail-modal';
import { WorkflowCardHeader, type WorkflowCardHeaderLabels } from './workflow-card-header';
import { WorkflowErrorCard, type WorkflowErrorCardLabels } from './workflow-error-card';
import type { WorkflowPhaseRowLabels } from './workflow-phase-row';
import { ProgressTree, RunningProgressPanel } from './workflow-progress-display';
import { WorkflowResultSummary, type WorkflowResultSummaryLabels } from './workflow-result-summary';
import type { WorkflowAgentSnapshot } from './workflow.types';
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
  drawer: WorkflowAgentDetailModalLabels;
  /** Header action button tooltips / a11y. */
  cancel: string;
  saveAria: string;
  saveTitle: string;
  savePlaceholder: string;
  saveSubmit: string;
  saveCancel: string;
  saveDispatched: string;
  copyAria: string;
  copyDoneAria: string;
  moreAria: string;
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
};

export interface WorkflowCardProps {
  block: ToolUseContent;
  /** Live elapsed-time anchor; set when the block transitions to running. */
  startedAt?: number;
  sessionKey?: string | null;
  /** Cancel handler — wired by parent (typically calls existing /abort path). */
  onAbort?: () => void;
  /**
   * Send raw text into the user's chat composer. Used by "Save as…" to
   * synthesize `/workflow save <name>` and submit it through the same SSE
   * channel commands already use. When omitted, the save button is hidden.
   */
  onSendChatMessage?: (text: string) => void;
  labels: WorkflowCardLabels;
  className?: string;
}

export const WorkflowCard = memo(function WorkflowCard({
  block,
  startedAt,
  sessionKey,
  onAbort,
  onSendChatMessage,
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
  const [drawerAgentId, setDrawerAgentId] = useState<number | null>(null);
  const [logsExpanded, setLogsExpanded] = useState(false);

  const drawerAgent = useMemo(() => {
    if (drawerAgentId == null || !snapshot) return null;
    return snapshot.agents.find((a) => a.id === drawerAgentId) ?? null;
  }, [drawerAgentId, snapshot]);

  const handleSelectAgent = useCallback((agent: WorkflowAgentSnapshot) => {
    setDrawerAgentId(agent.id);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerAgentId(null);
  }, []);

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
    if (!snapshot) return;
    const text =
      typeof snapshot.result === 'string' ? snapshot.result : safeStringify(snapshot.result);
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [snapshot]);

  // ----- save as named -----
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const saveInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (savePromptOpen) {
      if (!saveName) setSaveName(snapshot?.name ?? '');
      window.setTimeout(() => saveInputRef.current?.focus(), 0);
    }
  }, [savePromptOpen, saveName, snapshot?.name]);
  const dispatchSave = useCallback(() => {
    const cleaned = saveName.trim();
    if (!cleaned || !onSendChatMessage) return;
    onSendChatMessage(`/workflow save ${cleaned}`);
    setSavePromptOpen(false);
  }, [saveName, onSendChatMessage]);

  const openInWorkflows = useCallback(() => {
    const name = snapshot?.name?.trim();
    if (!name) return;
    navigate(`/workflows?tab=catalog&def=${encodeURIComponent(name)}`);
  }, [navigate, snapshot?.name]);

  // ----- render -----
  if (isWorkflowFailureOutcome(block) || (status === 'completed' && !snapshot)) {
    const kind = failureKind ?? classifyFailure(block);
    const failureCtx = buildWorkflowFailureContext(block);
    const scriptPreview = extractScriptPreview(block);
    const failureSnapshot = failureCtx.snapshot;
    const failureDrawerAgent =
      drawerAgentId == null || !failureSnapshot
        ? null
        : failureSnapshot.agents.find((agent) => agent.id === drawerAgentId) ?? null;

    return (
      <>
        <WorkflowErrorCard
          kind={kind}
          reason={failureCtx.headline || errorReason || 'workflow failed'}
          detailLines={failureCtx.detailLines}
          logs={failureCtx.logs}
          failedAgents={failureCtx.failedAgents}
          snapshot={failureSnapshot}
          scriptPreview={scriptPreview}
          selectedAgentId={drawerAgentId}
          onSelectAgent={handleSelectAgent}
          labels={labels.error}
          className={className}
        />
        <WorkflowAgentDetailModal
          open={drawerAgentId != null && failureDrawerAgent != null}
          agent={failureDrawerAgent}
          snapshot={failureSnapshot}
          sessionKey={sessionKey}
          onClose={closeDrawer}
          labels={labels.drawer}
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
          {onSendChatMessage ? (
            <button
              type="button"
              onClick={() => setSavePromptOpen((v) => !v)}
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
          <button
            type="button"
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-md text-fg-muted',
              'hover:bg-surface-hover hover:text-fg',
              interaction.transition,
              interaction.focusRingPanel,
              // P2 menu is intentionally a no-op placeholder; opens nothing
              // until W-P2b ships its action menu. Hidden when no actions.
              'invisible',
            )}
            aria-label={labels.moreAria}
            title={labels.moreAria}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </>
      ) : null}
    </>
  );

  return (
    <>
    <div
      className={cn(
        'min-w-0 rounded-xl border border-edge bg-surface-panel shadow-surface',
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

      {savePromptOpen && status === 'completed' ? (
        <div className="flex min-w-0 items-center gap-2 border-b border-edge-subtle px-3 py-2">
          <input
            ref={saveInputRef}
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') dispatchSave();
              else if (e.key === 'Escape') setSavePromptOpen(false);
            }}
            placeholder={labels.savePlaceholder}
            className={cn(
              'min-w-0 flex-1 rounded-md border border-edge bg-surface-base px-2 py-1 text-sm text-fg',
              'placeholder:text-fg-disabled',
              interaction.focusRingPanel,
            )}
          />
          <button
            type="button"
            onClick={dispatchSave}
            disabled={!saveName.trim()}
            className={cn(
              'inline-flex h-7 items-center rounded-md bg-accent px-2.5 text-xs font-medium text-fg-onAccent',
              'hover:bg-accent-hover',
              interaction.transition,
              interaction.focusRingPanel,
              interaction.disabled,
            )}
          >
            {labels.saveSubmit}
          </button>
          <button
            type="button"
            onClick={() => setSavePromptOpen(false)}
            className={cn(
              'inline-flex h-7 items-center rounded-md px-2 text-xs text-fg-muted',
              'hover:bg-surface-hover hover:text-fg',
              interaction.transition,
              interaction.focusRingPanel,
            )}
          >
            {labels.saveCancel}
          </button>
        </div>
      ) : null}

      {!collapsed ? (
        <div className="space-y-3 px-3 py-2.5">
          {status === 'completed' && snapshot ? (
            <WorkflowResultSummary result={snapshot.result} labels={labels.result} />
          ) : null}

          {status === 'running' && snapshot ? (
            <RunningProgressPanel
              snapshot={snapshot}
              labels={labels}
              logsExpanded={logsExpanded}
              onToggleLogs={() => setLogsExpanded((v) => !v)}
              selectedAgentId={drawerAgentId}
              onSelectAgent={handleSelectAgent}
            />
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
                  selectedAgentId={drawerAgentId}
                  onSelectAgent={handleSelectAgent}
                />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>

    <WorkflowAgentDetailModal
      open={drawerAgentId != null && drawerAgent != null}
      agent={drawerAgent}
      snapshot={snapshot}
      sessionKey={sessionKey}
      onClose={closeDrawer}
      labels={labels.drawer}
    />
    </>
  );
});

function extractScriptPreview(block: ToolUseContent): string | undefined {
  if (!block.input || typeof block.input !== 'object') return undefined;
  const input = block.input as Record<string, unknown>;
  if (typeof input.script === 'string' && input.script.trim()) {
    const lines = input.script.split('\n').slice(0, 80);
    return lines.join('\n');
  }
  return undefined;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
