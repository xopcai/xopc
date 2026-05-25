import type { WebchatPersistentGoalWire } from '@/features/chat/goals/goals-api';
import { cn } from '@/lib/cn';

import {
  goalChecklistProgress,
  goalTurnProgress,
  type GoalMessages,
} from './chat-goal-banner-utils';

type Props = {
  goal: WebchatPersistentGoalWire;
  t: GoalMessages;
};

export function GoalProgressMeter({ goal, t }: Props) {
  const turn = goalTurnProgress(goal);
  const checklist = goalChecklistProgress(goal);

  return (
    <div className="space-y-1.5" aria-label={t.heading}>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-elevated">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-300',
            goal.status === 'done' ? 'bg-accent' : 'bg-accent/75',
          )}
          style={{ width: `${turn.percent}%` }}
        />
      </div>
      {checklist.total > 0 ? (
        <div className="flex items-center gap-2 text-[10px] text-fg-muted">
          <span className="shrink-0">
            {t.checklistProgress
              .replace('{{done}}', String(checklist.done))
              .replace('{{total}}', String(checklist.total))}
          </span>
          <div className="h-1 min-w-10 flex-1 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-fg-muted/55 transition-[width] duration-300"
              style={{ width: `${checklist.percent}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
