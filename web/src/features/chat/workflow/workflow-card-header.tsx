/**
 * Header band of the WorkflowCard:
 *   ◆  audit_repo               7/12 · 02:34    [actions]
 *
 * Pure visual: it does not own any state besides showing what its props say.
 * Action buttons are passed in as ReactNode slots so the parent (WorkflowCard)
 * controls visibility per status (cancel only while running, save only when
 * completed, etc.).
 */

import { memo } from 'react';
import { ChevronDown, ChevronUp, Hexagon, Loader2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

import type { WorkflowCardStatus } from './workflow.types';

export type WorkflowCardHeaderLabels = {
  collapse: string;
  expand: string;
  runningMeta: (countLabel: string, durationLabel: string) => string;
  completedMeta: (countLabel: string, durationLabel: string) => string;
  failedMeta: string;
};

export const WorkflowCardHeader = memo(function WorkflowCardHeader({
  name,
  description,
  status,
  doneCount,
  totalCount,
  durationText,
  metaText,
  collapsed,
  onToggleCollapsed,
  actions,
  labels,
}: {
  name: string;
  description?: string;
  status: WorkflowCardStatus;
  doneCount: number;
  totalCount: number;
  durationText: string;
  metaText?: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  actions?: React.ReactNode;
  labels: WorkflowCardHeaderLabels;
}) {
  const countLabel =
    totalCount > 0 ? `${doneCount}/${totalCount}` : status === 'running' ? '…' : '0';
  const metaLine = metaText ??
    (status === 'running'
      ? labels.runningMeta(countLabel, durationText)
      : status === 'completed'
        ? labels.completedMeta(countLabel, durationText)
        : labels.failedMeta);

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 border-b border-edge-subtle px-3 py-2',
        status === 'failed' && 'border-rose-300/40',
      )}
    >
      <span aria-hidden className="shrink-0 text-fg-subtle">
        {status === 'running' ? (
          <Loader2 className="size-4 animate-spin text-accent-fg" />
        ) : (
          <Hexagon className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <div className="min-w-0 shrink truncate text-base font-semibold tracking-tight text-fg">{name}</div>
          <div className="min-w-0 flex-1 truncate text-xs tabular-nums text-fg-subtle">{metaLine}</div>
        </div>
        {description ? (
          <div className="mt-0.5 line-clamp-1 text-xs text-fg-subtle">{description}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {actions}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-md',
            'text-fg-muted hover:bg-surface-hover hover:text-fg',
            interaction.transition,
            interaction.focusRingPanel,
          )}
          aria-label={collapsed ? labels.expand : labels.collapse}
          title={collapsed ? labels.expand : labels.collapse}
        >
          {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </button>
      </div>
    </div>
  );
});
