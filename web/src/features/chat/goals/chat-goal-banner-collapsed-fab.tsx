import { Target } from 'lucide-react';

import type { WebchatPersistentGoalWire } from '@/features/chat/goals/goals-api';
import { cn } from '@/lib/cn';

import { phaseLabel, type GoalMessages, type GoalUiPhase } from './chat-goal-banner-utils';

type Props = {
  goal: WebchatPersistentGoalWire;
  agentBusy: boolean;
  pillTitle: string;
  phase: GoalUiPhase;
  statusShort: string;
  turnsShort: string;
  clLine: string;
  t: GoalMessages;
  onExpand: () => void;
};

/** Zero layout height + FAB pinned to chat column corner (no full-width sticky row). */
export function GoalCollapsedFab({ goal, agentBusy, pillTitle, phase, statusShort, turnsShort, clLine, t, onExpand }: Props) {
  return (
    <div className="relative h-0 shrink-0 overflow-visible">
      <div
        className={cn(
          'pointer-events-none absolute z-30',
          'right-[max(0.75rem,env(safe-area-inset-right,0px))] top-[max(0.5rem,env(safe-area-inset-top,0px))]',
          'sm:right-[max(1.25rem,env(safe-area-inset-right,0px))] xl:right-[max(1.5rem,env(safe-area-inset-right,0px))]',
        )}
      >
        <button
          type="button"
          className={cn(
            'pointer-events-auto flex h-11 min-w-11 max-w-[min(calc(100vw-1.5rem),16rem)] items-center gap-1.5 rounded-full border border-edge/60 bg-surface-panel/95 px-2.5 py-1 text-left shadow-elevated backdrop-blur-sm',
            'transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
          )}
          title={`${pillTitle}${clLine ? ` · ${clLine}` : ''}${goal.lastVerdict ? `\n${t.lastVerdict}: ${goal.lastVerdict}` : ''}${goal.lastReason ? `\n${t.lastReason}: ${goal.lastReason}` : ''}\n${goal.title}`}
          aria-label={t.expandAria}
          onClick={onExpand}
        >
          <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted">
            <Target className="size-4 text-accent" aria-hidden />
            {agentBusy ? (
              <span className="absolute -right-0.5 -top-0.5 flex size-2.5 rounded-full border-2 border-surface-panel bg-accent motion-safe:animate-pulse" />
            ) : (
              <span
                className={cn(
                  'absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface-panel',
                  goal.status === 'active' && 'bg-accent',
                  goal.status === 'paused' && 'bg-fg-muted',
                  goal.status === 'done' && 'bg-fg-muted',
                )}
              />
            )}
          </span>
          <span className="min-w-0 flex-1 pr-0.5">
            <span className="block truncate text-[10px] font-medium leading-tight text-fg">
              {phaseLabel(phase, t)} · {statusShort}
            </span>
            <span className="block truncate text-[10px] leading-tight text-fg-muted">
              {clLine ? `${turnsShort} · ${clLine}` : turnsShort}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
