/**
 * Minimal card for a failed workflow run.
 *
 * Header is always clickable — expanded body shows the full error, logs,
 * failed subagents, optional progress snapshot, and submitted script.
 */

import { memo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  OctagonX,
  TimerOff,
  XCircle,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

import type { WorkflowAgentSnapshot, WorkflowFailureKind, WorkflowSnapshot } from './workflow.types';
import { rollupPhases } from './workflow.utils';
import { WorkflowPhaseRow, type WorkflowPhaseRowLabels } from './workflow-phase-row';

export type WorkflowErrorCardLabels = {
  titleParse: string;
  titleAbort: string;
  titleTimeout: string;
  titleRuntime: string;
  expand: string;
  collapse: string;
  expandHint: string;
  detailsHeading: string;
  logsHeading: string;
  failedAgentsHeading: string;
  progressHeading: string;
  scriptHeading: string;
  noExtraDetails: string;
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
  const details = detailLines ?? [];
  const logLines = logs ?? [];
  const agents = failedAgents ?? [];
  const rollup = snapshot ? rollupPhases(snapshot) : null;
  const hasProgress =
    rollup != null && (rollup.phases.length > 0 || rollup.unphased != null) && (snapshot?.agents.length ?? 0) > 0;

  const bodySections =
    details.length > 0 ||
    logLines.length > 0 ||
    agents.length > 0 ||
    hasProgress ||
    Boolean(scriptPreview?.trim());

  const [collapsed, setCollapsed] = useState(true);
  const isOpen = !collapsed;

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
          {details.length > 0 ? (
            <section className="min-w-0">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                {labels.detailsHeading}
              </div>
              <pre className="max-h-60 min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-surface-hover/60 p-2 font-mono text-xs text-fg-muted dark:bg-surface-hover/35">
                {details.join('\n\n')}
              </pre>
            </section>
          ) : null}

          {agents.length > 0 ? (
            <section className="min-w-0">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                {labels.failedAgentsHeading}
              </div>
              <ul className="space-y-1 text-xs text-fg-muted">
                {agents.map((a) => (
                  <li key={a.id} className="rounded-md bg-surface-hover/40 px-2 py-1">
                    <span className="font-medium text-fg">{a.label}</span>
                    {a.error ? (
                      <span className="text-rose-600 dark:text-rose-400"> — {a.error}</span>
                    ) : (
                      <span> — {a.status}</span>
                    )}
                  </li>
                ))}
              </ul>
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

          {hasProgress && rollup ? (
            <section className="min-w-0">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                {labels.progressHeading}
              </div>
              <div className="space-y-1">
                {rollup.phases.map((p) => (
                  <WorkflowPhaseRow key={p.title} rollup={p} isCurrent={false} labels={labels.phase} />
                ))}
                {rollup.unphased ? (
                  <WorkflowPhaseRow rollup={rollup.unphased} isCurrent={false} labels={labels.phase} />
                ) : null}
              </div>
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
