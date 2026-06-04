/**
 * One `agent()` call rendered as a row. Holds the status icon, label, and
 * optional current-step / elapsed summary. Click opens the detail drawer.
 */

import { memo, useEffect, useState } from 'react';
import {
  ChevronRight,
  CircleAlert,
  CircleDashed,
  CircleDot,
  CircleSlash,
  CircleCheck,
  Loader2,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

import type { WorkflowAgentSnapshot } from './workflow.types';
import { formatAgentElapsed } from './workflow.utils';

export type WorkflowAgentRowLabels = {
  showPrompt: string;
  hidePrompt: string;
  promptHeading: string;
  resultPreviewHeading: string;
  errorHeading: string;
  emptyPreview: string;
  agentNumber: (n: number) => string;
  queued: string;
  running: string;
  openDetail: string;
};

const statusToIcon = {
  queued: <CircleDashed className="size-3.5 shrink-0 text-fg-disabled" aria-hidden />,
  running: <Loader2 className="size-3.5 shrink-0 animate-spin text-accent-fg" aria-hidden />,
  done: <CircleCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />,
  error: <CircleAlert className="size-3.5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />,
  skipped: <CircleSlash className="size-3.5 shrink-0 text-fg-disabled" aria-hidden />,
} as const;

export const WorkflowAgentRow = memo(function WorkflowAgentRow({
  agent,
  labels,
  selected,
  onSelect,
}: {
  agent: WorkflowAgentSnapshot;
  labels: WorkflowAgentRowLabels;
  selected?: boolean;
  onSelect?: (agent: WorkflowAgentSnapshot) => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (agent.status !== 'running') return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [agent.status, agent.startedAtMs]);

  const icon = statusToIcon[agent.status] ?? <CircleDot className="size-3.5 shrink-0" aria-hidden />;
  const elapsed = formatAgentElapsed(agent);
  const statusHint =
    agent.status === 'queued'
      ? labels.queued
      : agent.status === 'running' && !agent.currentStep
        ? labels.running
        : agent.currentStep;

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => onSelect?.(agent)}
        aria-label={`${labels.openDetail}: ${agent.label}`}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex w-full min-w-0 flex-col gap-0.5 rounded-md px-1.5 py-0.5 text-left',
          'text-sm leading-6 text-fg-muted',
          'hover:bg-surface-hover hover:text-fg',
          selected && 'bg-surface-hover/80 ring-1 ring-edge-subtle',
          interaction.transition,
          interaction.focusRingPanel,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronRight className="size-3.5 shrink-0 text-fg-disabled" aria-hidden />
          {icon}
          <span className="shrink-0 text-xs tabular-nums text-fg-disabled">
            {labels.agentNumber(agent.id)}
          </span>
          <span className="min-w-0 flex-1 truncate text-fg">{agent.label}</span>
          {elapsed ? (
            <span className="shrink-0 text-[10px] tabular-nums text-fg-disabled">{elapsed}</span>
          ) : null}
        </span>
        {statusHint ? (
          <span className="ml-7 truncate text-xs text-fg-subtle">{statusHint}</span>
        ) : null}
      </button>
    </div>
  );
});
