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
import { CircleStop, Copy, Check, MoreHorizontal, Save } from 'lucide-react';

import type { ToolUseContent } from '@/features/chat/messages/messages.types';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { interaction } from '@/lib/interaction';

import { WorkflowAgentDetailDrawer, type WorkflowAgentDetailDrawerLabels } from './workflow-agent-detail-drawer';
import { WorkflowCardHeader, type WorkflowCardHeaderLabels } from './workflow-card-header';
import { WorkflowAgentRow } from './workflow-agent-row';
import { WorkflowErrorCard, type WorkflowErrorCardLabels } from './workflow-error-card';
import { WorkflowPhaseRow, type WorkflowPhaseRowLabels } from './workflow-phase-row';
import { WorkflowResultSummary, type WorkflowResultSummaryLabels } from './workflow-result-summary';
import type { WorkflowAgentSnapshot, WorkflowSnapshot } from './workflow.types';
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
  drawer: WorkflowAgentDetailDrawerLabels;
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
  const [pinnedAgentId, setPinnedAgentId] = useState<number | null>(null);
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
        <WorkflowAgentDetailDrawer
          open={drawerAgentId != null && failureDrawerAgent != null}
          agent={failureDrawerAgent}
          snapshot={failureSnapshot}
          sessionKey={sessionKey}
          pinnedAgentId={pinnedAgentId}
          onPinAgent={setPinnedAgentId}
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

    <WorkflowAgentDetailDrawer
      open={drawerAgentId != null && drawerAgent != null}
      agent={drawerAgent}
      snapshot={snapshot}
      sessionKey={sessionKey}
      pinnedAgentId={pinnedAgentId}
      onPinAgent={setPinnedAgentId}
      onClose={closeDrawer}
      labels={labels.drawer}
    />
    </>
  );
});

function RunningProgressPanel({
  snapshot,
  labels,
  logsExpanded,
  onToggleLogs,
  selectedAgentId,
  onSelectAgent,
}: {
  snapshot: WorkflowSnapshot;
  labels: WorkflowCardLabels;
  logsExpanded: boolean;
  onToggleLogs: () => void;
  selectedAgentId?: number | null;
  onSelectAgent?: (agent: WorkflowAgentSnapshot) => void;
}) {
  const runningAgents = snapshot.agents.filter((agent) => agent.status === 'running');
  const failedAgents = snapshot.agents.filter((agent) => agent.status === 'error' || agent.status === 'skipped');
  const completedAgents = snapshot.agents.filter((agent) => agent.status === 'done');
  const queuedAgents = snapshot.agents.filter((agent) => agent.status === 'queued');

  return (
    <div className="space-y-3">
      <AgentStatusSection
        heading={labels.runningAgentsHeading}
        agents={runningAgents}
        labels={labels.phase}
        selectedAgentId={selectedAgentId}
        onSelectAgent={onSelectAgent}
      />
      <AgentStatusSection
        heading={labels.failedAgentsHeading}
        agents={failedAgents}
        labels={labels.phase}
        selectedAgentId={selectedAgentId}
        onSelectAgent={onSelectAgent}
      />
      <AgentStatusSection
        heading={labels.completedAgentsHeading}
        agents={completedAgents}
        labels={labels.phase}
        selectedAgentId={selectedAgentId}
        onSelectAgent={onSelectAgent}
      />
      <AgentStatusSection
        heading={labels.queuedAgentsHeading}
        agents={queuedAgents}
        labels={labels.phase}
        selectedAgentId={selectedAgentId}
        onSelectAgent={onSelectAgent}
      />

      <RecentLogs
        recentLogs={snapshot.logs}
        recentLogsHeading={labels.recentLogsHeading}
        showAllLogsLabel={labels.showAllLogs}
        logsExpanded={logsExpanded}
        onToggleLogs={onToggleLogs}
      />
    </div>
  );
}

function AgentStatusSection({
  heading,
  agents,
  labels,
  selectedAgentId,
  onSelectAgent,
}: {
  heading: string;
  agents: WorkflowAgentSnapshot[];
  labels: WorkflowPhaseRowLabels;
  selectedAgentId?: number | null;
  onSelectAgent?: (agent: WorkflowAgentSnapshot) => void;
}) {
  if (agents.length === 0) return null;

  return (
    <section className="min-w-0">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
        {heading}
      </div>
      <div className="space-y-0.5">
        {agents.map((agent) => (
          <WorkflowAgentRow
            key={agent.id}
            agent={agent}
            labels={labels}
            selected={selectedAgentId === agent.id}
            onSelect={onSelectAgent}
          />
        ))}
      </div>
    </section>
  );
}

function RecentLogs({
  recentLogs,
  recentLogsHeading,
  showAllLogsLabel,
  logsExpanded,
  onToggleLogs,
}: {
  recentLogs: string[];
  recentLogsHeading: string;
  showAllLogsLabel: string;
  logsExpanded: boolean;
  onToggleLogs: () => void;
}) {
  const visibleLogs =
    logsExpanded || recentLogs.length <= 2 ? recentLogs : recentLogs.slice(-2);

  if (recentLogs.length === 0) return null;

  return (
    <div className="border-t border-edge-subtle pt-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
          {recentLogsHeading}
        </div>
        {recentLogs.length > 2 ? (
          <button
            type="button"
            onClick={onToggleLogs}
            className="text-[10px] text-accent-fg hover:underline"
          >
            {showAllLogsLabel}
          </button>
        ) : null}
      </div>
      <div className="space-y-0.5">
        {visibleLogs.map((line, index) => (
          <div key={index} className="break-words font-mono text-xs text-fg-subtle">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressTree({
  rollup,
  currentPhase,
  labels,
  recentLogs,
  recentLogsHeading,
  showAllLogsLabel,
  logsExpanded,
  onToggleLogs,
  selectedAgentId,
  onSelectAgent,
}: {
  rollup: ReturnType<typeof rollupPhases>;
  currentPhase: string | undefined;
  labels: WorkflowPhaseRowLabels;
  recentLogs: string[];
  recentLogsHeading: string;
  showAllLogsLabel: string;
  logsExpanded: boolean;
  onToggleLogs: () => void;
  selectedAgentId?: number | null;
  onSelectAgent?: (agent: WorkflowAgentSnapshot) => void;
}) {
  const visibleLogs =
    logsExpanded || recentLogs.length <= 2 ? recentLogs : recentLogs.slice(-2);

  return (
    <div className="space-y-1">
      {rollup.phases.map((p) => (
        <WorkflowPhaseRow
          key={p.title}
          rollup={p}
          isCurrent={p.title === currentPhase}
          labels={labels}
          selectedAgentId={selectedAgentId}
          onSelectAgent={onSelectAgent}
        />
      ))}
      {rollup.unphased ? (
        <WorkflowPhaseRow
          rollup={rollup.unphased}
          isCurrent={false}
          labels={labels}
          selectedAgentId={selectedAgentId}
          onSelectAgent={onSelectAgent}
        />
      ) : null}
      {recentLogs.length > 0 ? (
        <div className="mt-2 border-t border-edge-subtle pt-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
              {recentLogsHeading}
            </div>
            {recentLogs.length > 2 ? (
              <button
                type="button"
                onClick={onToggleLogs}
                className="text-[10px] text-accent-fg hover:underline"
              >
                {showAllLogsLabel}
              </button>
            ) : null}
          </div>
          <div className="space-y-0.5">
            {visibleLogs.map((line, i) => (
              <div key={i} className="break-words font-mono text-xs text-fg-subtle">
                {line}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
