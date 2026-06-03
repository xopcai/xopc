/**
 * One phase as a header row + (collapsible) list of agent rows beneath it.
 *
 * Default-open rule (matches user UX expectation):
 *   - currentPhase: always open (you want to watch what's running)
 *   - any phase with running/error/skipped agents: open (status matters)
 *   - already-complete phases: closed (signal-to-noise for big workflows)
 *
 * User clicks the phase header to toggle open/closed; we honor that for the
 * lifetime of the card (no auto-collapse).
 */

import { memo, useEffect, useState } from 'react';
import { ChevronRight, Circle, CircleCheck, Loader2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

import { WorkflowAgentRow, type WorkflowAgentRowLabels } from './workflow-agent-row';
import type { PhaseRollup } from './workflow.utils';

export type WorkflowPhaseRowLabels = WorkflowAgentRowLabels & {
  countTpl: (done: number, total: number) => string;
  runningTag: (n: number) => string;
  errorsTag: (n: number) => string;
  skippedTag: (n: number) => string;
};

export const WorkflowPhaseRow = memo(function WorkflowPhaseRow({
  rollup,
  isCurrent,
  labels,
}: {
  rollup: PhaseRollup;
  isCurrent: boolean;
  labels: WorkflowPhaseRowLabels;
}) {
  const shouldDefaultOpen = isCurrent || rollup.running > 0 || rollup.errored > 0 || rollup.skipped > 0 || !rollup.complete;
  const [open, setOpen] = useState(shouldDefaultOpen);

  // Re-open automatically when this phase newly becomes the current one
  // (e.g. workflow advances mid-stream and the user had it collapsed).
  useEffect(() => {
    // Re-open only when this phase newly becomes the current one (e.g. workflow
    // advances mid-stream and the user had it collapsed). Intentionally
    // depends on `isCurrent` alone — depending on `open` would re-open the
    // phase right after the user collapses it.
    if (isCurrent) setOpen(true);
  }, [isCurrent]);

  const total = rollup.agents.length;
  const stateIcon =
    rollup.running > 0 ? (
      <Loader2 className="size-3.5 shrink-0 animate-spin text-accent-fg" aria-hidden />
    ) : rollup.complete ? (
      <CircleCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
    ) : (
      <Circle className="size-3.5 shrink-0 text-fg-disabled" aria-hidden />
    );

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left',
          'text-sm font-medium text-fg',
          'hover:bg-surface-hover',
          interaction.transition,
          interaction.focusRingPanel,
        )}
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-fg-subtle transition-transform duration-150',
            open && 'rotate-90',
          )}
          aria-hidden
        />
        {stateIcon}
        <span className="min-w-0 flex-1 truncate">{rollup.title}</span>
        <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
          {labels.countTpl(rollup.done, total)}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-fg-disabled">
          {rollup.running > 0 ? <span className="text-accent-fg">{labels.runningTag(rollup.running)}</span> : null}
          {rollup.errored > 0 ? (
            <span className="text-rose-600 dark:text-rose-400">{labels.errorsTag(rollup.errored)}</span>
          ) : null}
          {rollup.skipped > 0 ? <span>{labels.skippedTag(rollup.skipped)}</span> : null}
        </span>
      </button>

      {open ? (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-edge-subtle pl-2">
          {rollup.agents.map((agent) => (
            <WorkflowAgentRow key={agent.id} agent={agent} labels={labels} />
          ))}
          {rollup.agents.length === 0 ? (
            <div className="px-1.5 py-0.5 text-xs text-fg-disabled">…</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
