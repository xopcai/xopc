/**
 * Minimal card for a failed workflow run.
 *
 * Layout mirrors the success card:
 *   [icon]  <title>  <reason inline, truncated>     [chevron]
 *   (body shown when expanded: full reason + submitted script)
 *
 * The header itself is the toggle — clicking anywhere on the row expands or
 * collapses the body. Default is collapsed so transcript scroll length stays
 * bounded; the chevron / aria-expanded attribute mirror open state.
 *
 * The body is hidden entirely when there is nothing extra to show (no script
 * preview AND a single-line reason that already fits in the header).
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

import type { WorkflowFailureKind } from './workflow.types';

export type WorkflowErrorCardLabels = {
  titleParse: string;
  titleAbort: string;
  titleTimeout: string;
  titleRuntime: string;
  expand: string;
  collapse: string;
};

const iconFor: Record<WorkflowFailureKind, React.ReactNode> = {
  parse_error: <OctagonX className="size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />,
  aborted: <XCircle className="size-4 shrink-0 text-fg-muted" aria-hidden />,
  timeout: <TimerOff className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />,
  runtime_error: <AlertTriangle className="size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />,
};

export const WorkflowErrorCard = memo(function WorkflowErrorCard({
  kind,
  reason,
  scriptPreview,
  labels,
  className,
}: {
  kind: WorkflowFailureKind;
  reason: string;
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

  const trimmedReason = reason.trim();
  const reasonIsMultiLine = trimmedReason.includes('\n');
  const inlineReason = reasonIsMultiLine
    ? trimmedReason.slice(0, trimmedReason.indexOf('\n'))
    : trimmedReason;

  // Body shows full reason when it's longer/multi-line than the header preview,
  // and/or the submitted script. Otherwise the header tells the whole story
  // and we hide the chevron entirely.
  const showFullReasonInBody = reasonIsMultiLine;
  const hasExpandable = Boolean(scriptPreview) || showFullReasonInBody;

  const [collapsed, setCollapsed] = useState(true);
  const isOpen = hasExpandable && !collapsed;

  const headerInner = (
    <>
      {iconFor[kind]}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-sm font-semibold tracking-tight text-fg">
            {title}
          </span>
          {inlineReason ? (
            <span className="min-w-0 truncate text-sm text-fg-muted">{inlineReason}</span>
          ) : null}
        </div>
      </div>
      {hasExpandable ? (
        <span
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted"
          aria-hidden
        >
          {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </span>
      ) : null}
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
      {hasExpandable ? (
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={isOpen}
          aria-label={isOpen ? labels.collapse : labels.expand}
          className={cn(
            'flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left',
            // Match the outer card's rounded-xl so the hover background
            // doesn't bleed past the card's rounded corners. When expanded,
            // only the top corners round and a border separates the body.
            isOpen ? 'rounded-t-xl border-b border-edge-subtle' : 'rounded-xl',
            'hover:bg-surface-hover',
            interaction.transition,
            interaction.focusRingPanel,
          )}
        >
          {headerInner}
        </button>
      ) : (
        <div className="flex w-full min-w-0 items-center gap-2 px-3 py-2">{headerInner}</div>
      )}

      {isOpen ? (
        <div className="space-y-2 px-3 py-2.5">
          {showFullReasonInBody ? (
            <pre className="max-h-60 min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-surface-hover/60 p-2 font-mono text-xs text-fg-muted dark:bg-surface-hover/35">
              {trimmedReason}
            </pre>
          ) : null}
          {scriptPreview ? (
            <pre className="max-h-60 min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-surface-hover/60 p-2 font-mono text-xs text-fg-muted dark:bg-surface-hover/35">
              {scriptPreview}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
