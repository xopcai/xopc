/**
 * Minimal card for a failed workflow run.
 *
 * Header is always clickable — expanded body shows the full error, logs,
 * failed subagents, optional progress snapshot, and submitted script.
 */

import { memo, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  OctagonX,
  TimerOff,
  XCircle,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { interaction } from '@/lib/interaction';

import type { WorkflowAgentSnapshot, WorkflowFailureKind, WorkflowSnapshot } from './workflow.types';
import { WorkflowAgentRow } from './workflow-agent-row';
import type { WorkflowPhaseRowLabels } from './workflow-phase-row';

export type WorkflowErrorCardLabels = {
  titleParse: string;
  titleAbort: string;
  titleTimeout: string;
  titleRuntime: string;
  expand: string;
  collapse: string;
  expandHint: string;
  detailsHeading: string;
  impactHeading: string;
  recoveryHeading: string;
  recoveryActions: Record<WorkflowFailureKind, string[]>;
  logsHeading: string;
  failedAgentsHeading: string;
  executedAgentsHeading: string;
  progressHeading: string;
  scriptHeading: string;
  noExtraDetails: string;
  copyReason: string;
  copyReasonDone: string;
  impactTpl: (done: number, total: number, failed: number) => string;
  phase: WorkflowPhaseRowLabels;
};

export const WorkflowErrorCard = memo(function WorkflowErrorCard({
  kind,
  reason,
  detailLines,
  logs,
  failedAgents,
  snapshot,
  scriptPreview,
  selectedAgentId,
  onSelectAgent,
  labels,
  className,
}: {
  kind: WorkflowFailureKind;
  reason: string;
  detailLines?: string[];
  logs?: string[];
  failedAgents?: WorkflowAgentSnapshot[];
  snapshot?: WorkflowSnapshot | null;
  scriptPreview?: string;
  selectedAgentId?: number | null;
  onSelectAgent?: (agent: WorkflowAgentSnapshot) => void;
  labels: WorkflowErrorCardLabels;
  className?: string;
}) {
  const title =
    kind === 'parse_error'
      ? labels.titleParse
      : kind === 'aborted'
        ? labels.titleAbort
        : kind === 'timeout'
          ? labels.titleTimeout
          : labels.titleRuntime;

  const trimmedReason = reason.trim() || 'workflow failed';
  const logLines = logs ?? [];
  const agents = failedAgents ?? [];
  const workflowAgents = useMemo(() => snapshot?.agents ?? [], [snapshot?.agents]);
  const diagnosticText = useMemo(() => {
    const lines: string[] = [];
    const pushLine = (line: string) => {
      const trimmedLine = line.trim();
      if (trimmedLine && !lines.includes(trimmedLine)) lines.push(trimmedLine);
    };

    pushLine(trimmedReason);
    for (const line of detailLines ?? []) pushLine(line);
    return lines.join('\n');
  }, [detailLines, trimmedReason]);

  const recoveryActions = labels.recoveryActions[kind] ?? [];
  const doneCount = snapshot?.doneCount ?? 0;
  const totalCount = snapshot?.agentCount ?? 0;
  const failedCount = agents.length || snapshot?.errorCount || 0;
  const bodySections =
    Boolean(diagnosticText) ||
    recoveryActions.length > 0 ||
    logLines.length > 0 ||
    workflowAgents.length > 0 ||
    Boolean(scriptPreview?.trim());

  const [collapsed, setCollapsed] = useState(false);
  const [reasonExpanded, setReasonExpanded] = useState(false);
  const [copiedReason, setCopiedReason] = useState(false);
  const isOpen = !collapsed;

  const handleCopyReason = async () => {
    const ok = await copyTextToClipboard(diagnosticText || trimmedReason);
    if (!ok) return;
    setCopiedReason(true);
    window.setTimeout(() => setCopiedReason(false), 1500);
  };

  const headerInner = (
    <>
      {iconFor[kind]}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-sm font-semibold tracking-tight text-fg">{title}</span>
          <span className="min-w-0 truncate text-sm text-fg-muted">{trimmedReason}</span>
        </div>
        {collapsed && bodySections ? (
          <div className="mt-0.5 text-xs text-fg-subtle">{labels.expandHint}</div>
        ) : null}
      </div>
      <span
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted"
        aria-hidden
      >
        {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </span>
    </>
  );

  return (
    <div
      className={cn(
        'min-w-0 rounded-xl border border-edge bg-surface-panel shadow-surface',
        className,
      )}
      role="group"
      aria-label={title}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={isOpen}
        aria-label={isOpen ? labels.collapse : labels.expand}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left',
          isOpen ? 'rounded-t-xl border-b border-edge-subtle' : 'rounded-xl',
          'hover:bg-surface-hover',
          interaction.transition,
          interaction.focusRingPanel,
        )}
      >
        {headerInner}
      </button>

      {isOpen ? (
        <div className="space-y-3 px-3 py-2.5">
          <section className="min-w-0 rounded-lg bg-surface-hover/35 px-2.5 py-2">
            <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setReasonExpanded((value) => !value)}
                aria-expanded={reasonExpanded}
                className={cn(
                  'inline-flex min-w-0 flex-1 items-center gap-1 text-left text-[10px] font-medium uppercase tracking-wide text-fg-subtle',
                  'hover:text-fg-muted',
                  interaction.transition,
                  interaction.focusRingPanel,
                )}
              >
                <span className="truncate">{labels.detailsHeading}</span>
                {reasonExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              </button>
              <button
                type="button"
                onClick={handleCopyReason}
                className={cn(
                  'inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-fg-muted',
                  'hover:bg-surface-hover hover:text-fg',
                  interaction.transition,
                  interaction.focusRingPanel,
                )}
                aria-label={copiedReason ? labels.copyReasonDone : labels.copyReason}
                title={copiedReason ? labels.copyReasonDone : labels.copyReason}
              >
                {copiedReason ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                <span>{copiedReason ? labels.copyReasonDone : labels.copyReason}</span>
              </button>
            </div>
            {reasonExpanded ? (
              <pre className="max-h-36 min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-surface-panel/60 p-2 font-sans text-sm leading-6 text-fg-muted">
                {diagnosticText || trimmedReason}
              </pre>
            ) : (
              <div className="truncate text-sm text-fg-muted" title={trimmedReason}>
                {trimmedReason}
              </div>
            )}
          </section>

          {totalCount > 0 ? (
            <section className="min-w-0">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                {labels.impactHeading}
              </div>
              <div className="text-sm text-fg-muted">
                {labels.impactTpl(doneCount, totalCount, failedCount)}
              </div>
            </section>
          ) : null}

          {recoveryActions.length > 0 ? (
            <section className="min-w-0">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                {labels.recoveryHeading}
              </div>
              <ul className="space-y-0.5 text-sm text-fg-muted">
                {recoveryActions.map((action, index) => (
                  <li key={index} className="flex gap-2">
                    <span className="text-fg-disabled">•</span>
                    <span className="min-w-0 break-words">{action}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {workflowAgents.length > 0 ? (
            <section className="min-w-0">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                {labels.executedAgentsHeading}
              </div>
              <div className="space-y-0.5">
                {workflowAgents.map((agent) => (
                  <WorkflowAgentRow
                    key={agent.id}
                    agent={agent}
                    labels={labels.phase}
                    selected={selectedAgentId === agent.id}
                    onSelect={onSelectAgent}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {logLines.length > 0 ? (
            <section className="min-w-0">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                {labels.logsHeading}
              </div>
              <pre className="max-h-48 min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-surface-hover/60 p-2 font-mono text-xs text-fg-muted dark:bg-surface-hover/35">
                {logLines.join('\n')}
              </pre>
            </section>
          ) : null}

          {scriptPreview?.trim() ? (
            <section className="min-w-0">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                {labels.scriptHeading}
              </div>
              <pre className="max-h-60 min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-surface-hover/60 p-2 font-mono text-xs text-fg-muted dark:bg-surface-hover/35">
                {scriptPreview}
              </pre>
            </section>
          ) : null}

          {!bodySections ? (
            <div className="text-xs text-fg-disabled">{labels.noExtraDetails}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

const iconFor: Record<WorkflowFailureKind, React.ReactNode> = {
  parse_error: <OctagonX className="size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />,
  aborted: <XCircle className="size-4 shrink-0 text-fg-muted" aria-hidden />,
  timeout: <TimerOff className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />,
  runtime_error: <AlertTriangle className="size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />,
};
