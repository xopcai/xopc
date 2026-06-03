/**
 * Minimal card for a failed workflow run. Surfaces the error reason plus a
 * collapsible block with the submitted script (when the model wrote one
 * inline) so the user can spot what went wrong without scrolling the
 * transcript for the original tool args.
 */

import { memo } from 'react';
import { AlertTriangle, OctagonX, TimerOff, XCircle } from 'lucide-react';

import { cn } from '@/lib/cn';

import type { WorkflowFailureKind } from './workflow.types';

export type WorkflowErrorCardLabels = {
  titleParse: string;
  titleAbort: string;
  titleTimeout: string;
  titleRuntime: string;
  viewScriptHeading: string;
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

  return (
    <div
      className={cn(
        'min-w-0 rounded-xl border border-edge bg-surface-panel shadow-surface',
        'p-3',
        className,
      )}
      role="group"
      aria-label={title}
    >
      <div className="flex items-start gap-2">
        {iconFor[kind]}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold tracking-tight text-fg">{title}</div>
          {reason ? (
            <div className="mt-1 whitespace-pre-wrap break-words text-sm text-fg-muted">{reason}</div>
          ) : null}
        </div>
      </div>
      {scriptPreview ? (
        <details className="group mt-2">
          <summary className="cursor-pointer select-none text-xs text-fg-subtle underline-offset-2 hover:text-fg-muted">
            {labels.viewScriptHeading}
          </summary>
          <pre className="mt-1 max-h-60 min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-surface-hover/60 p-2 font-mono text-xs text-fg-muted dark:bg-surface-hover/35">
            {scriptPreview}
          </pre>
        </details>
      ) : null}
    </div>
  );
});
