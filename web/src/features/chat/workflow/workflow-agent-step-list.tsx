/**
 * Live tool-step list for a workflow subagent (Drawer body).
 */

import { memo } from 'react';
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react';

import { cn } from '@/lib/cn';

import type { WorkflowAgentStep } from './workflow.types';
import { formatDuration } from './workflow.utils';

export type WorkflowAgentStepListLabels = {
  empty: string;
  iteration: (current: number, max: number) => string;
};

const statusIcon = {
  running: <Loader2 className="size-3.5 shrink-0 animate-spin text-accent-fg" aria-hidden />,
  done: <CircleCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />,
  error: <CircleAlert className="size-3.5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />,
} as const;

export const WorkflowAgentStepList = memo(function WorkflowAgentStepList({
  steps,
  iteration,
  maxIterations,
  labels,
}: {
  steps: WorkflowAgentStep[] | undefined;
  iteration?: number;
  maxIterations?: number;
  labels: WorkflowAgentStepListLabels;
}) {
  const list = steps ?? [];
  const iterLine =
    iteration != null && maxIterations != null
      ? labels.iteration(iteration, maxIterations)
      : null;

  if (list.length === 0 && !iterLine) {
    return <div className="text-xs text-fg-disabled">{labels.empty}</div>;
  }

  return (
    <div className="space-y-2">
      {iterLine ? (
        <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{iterLine}</div>
      ) : null}
      <ul className="space-y-1">
        {list.map((step) => (
          <li
            key={step.id}
            className={cn(
              'flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1 text-xs',
              step.status === 'running' && 'bg-surface-hover/50',
            )}
          >
            {statusIcon[step.status]}
            <div className="min-w-0 flex-1">
              <div className="truncate text-fg">{step.label}</div>
              {step.detail ? (
                <div className="truncate font-mono text-fg-muted">{step.detail}</div>
              ) : null}
              {step.durationMs != null ? (
                <div className="text-[10px] tabular-nums text-fg-disabled">
                  {formatDuration(step.durationMs)}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
});
