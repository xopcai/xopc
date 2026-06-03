/**
 * One `agent()` call rendered as a row. Holds the status icon, label, and
 * (when present) result preview / error message. Expands inline on click to
 * reveal the prompt + result preview — no modal, no jump.
 */

import { memo, useState } from 'react';
import { ChevronRight, CircleAlert, CircleDashed, CircleDot, CircleSlash, CircleCheck, Loader2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

import type { WorkflowAgentSnapshot } from './workflow.types';

export type WorkflowAgentRowLabels = {
  showPrompt: string;
  hidePrompt: string;
  promptHeading: string;
  resultPreviewHeading: string;
  errorHeading: string;
  emptyPreview: string;
  agentNumber: (n: number) => string;
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
}: {
  agent: WorkflowAgentSnapshot;
  labels: WorkflowAgentRowLabels;
}) {
  const [open, setOpen] = useState(false);
  const canExpand = Boolean(agent.prompt || agent.resultPreview || agent.error);
  const icon = statusToIcon[agent.status] ?? <CircleDot className="size-3.5 shrink-0" aria-hidden />;

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => canExpand && setOpen((v) => !v)}
        disabled={!canExpand}
        aria-expanded={canExpand ? open : undefined}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 text-left',
          'text-sm leading-6 text-fg-muted',
          canExpand && 'hover:bg-surface-hover hover:text-fg',
          interaction.transition,
          interaction.focusRingPanel,
          interaction.disabled,
        )}
      >
        {canExpand ? (
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 text-fg-disabled transition-transform duration-150',
              open && 'rotate-90 text-fg-subtle',
            )}
            aria-hidden
          />
        ) : (
          <span className="inline-block size-3.5 shrink-0" aria-hidden />
        )}
        {icon}
        <span className="shrink-0 text-xs tabular-nums text-fg-disabled">
          {labels.agentNumber(agent.id)}
        </span>
        <span className="min-w-0 flex-1 truncate text-fg">{agent.label}</span>
      </button>

      {open && canExpand ? (
        <div className="ml-7 mt-1 space-y-2 rounded-md border border-edge-subtle bg-surface-hover/30 p-2 text-xs">
          {agent.prompt ? (
            <div className="min-w-0">
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                {labels.promptHeading}
              </div>
              <pre className="max-h-48 min-w-0 overflow-y-auto whitespace-pre-wrap break-words font-mono text-fg-muted">
                {agent.prompt}
              </pre>
            </div>
          ) : null}
          {agent.resultPreview ? (
            <div className="min-w-0">
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                {labels.resultPreviewHeading}
              </div>
              <div className="max-h-48 min-w-0 overflow-y-auto whitespace-pre-wrap break-words font-mono text-fg-muted">
                {agent.resultPreview}
              </div>
            </div>
          ) : null}
          {agent.error ? (
            <div className="min-w-0">
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-600 dark:text-rose-400">
                {labels.errorHeading}
              </div>
              <div className="font-mono text-rose-600 dark:text-rose-400">{agent.error}</div>
            </div>
          ) : null}
          {!agent.prompt && !agent.resultPreview && !agent.error ? (
            <div className="text-fg-disabled">{labels.emptyPreview}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
