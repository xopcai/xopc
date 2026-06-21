import { ChevronUp, ListChecks } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { WebchatPersistentGoalWire } from '@/features/chat/goals/goals-api';
import { cn } from '@/lib/cn';

import { phaseLabel, type GoalMessages, type GoalUiPhase } from './chat-goal-banner-utils';

type Props = {
  goal: WebchatPersistentGoalWire;
  phase: GoalUiPhase;
  statusShort: string;
  turnsShort: string;
  clLine: string;
  elapsedStr: string;
  t: GoalMessages;
  onCollapse: () => void;
};

export function GoalMissionHeader({
  goal,
  phase,
  statusShort,
  turnsShort,
  clLine,
  elapsedStr,
  t,
  onCollapse,
}: Props) {
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <ListChecks className="size-3.5 shrink-0 text-accent" aria-hidden />
          <span className="font-medium text-fg">{phaseLabel(phase, t)}</span>
          <span
            className={cn(
              'rounded-full border px-1.5 py-0.5',
              goal.status === 'active' && 'border-accent/40 text-accent',
              goal.status === 'paused' && 'border-edge text-fg-muted',
              goal.status === 'done' && 'border-edge text-fg-muted',
            )}
          >
            {statusShort}
          </span>
          <span>{t.turns.replace('{{used}}', String(goal.turnsUsed)).replace('{{max}}', String(goal.maxTurns))}</span>
          {clLine ? <span className="rounded-full bg-surface-panel px-1.5 py-0.5 text-fg">{clLine}</span> : null}
          <span className="text-fg-muted">
            {t.elapsedLabel}: <span className="text-fg">{elapsedStr}</span>
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-sm leading-snug text-fg" title={goal.title}>
          {goal.title}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="hidden rounded-full bg-surface-muted px-2 py-1 text-[10px] text-fg-muted sm:inline-flex">
          {turnsShort}
        </span>
        <Button
          type="button"
          variant="ghost"
          className="size-8 shrink-0 rounded-full p-0 text-fg-muted hover:text-fg"
          aria-label={t.collapseAria}
          onClick={onCollapse}
        >
          <ChevronUp className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
