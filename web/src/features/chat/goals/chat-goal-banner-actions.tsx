import { Button } from '@/components/ui/button';
import {
  type GoalWebchatAction,
  type postWebchatChecklistMutation,
  type WebchatPersistentGoalWire,
} from '@/features/chat/goals/goals-api';
import { cn } from '@/lib/cn';

import type { GoalMessages } from './chat-goal-banner-utils';

type ChecklistMutation = Parameters<typeof postWebchatChecklistMutation>[1];

type Props = {
  goal: WebchatPersistentGoalWire;
  canEditChecklist: boolean;
  mutationBusy: boolean;
  t: GoalMessages;
  onAction: (a: GoalWebchatAction) => void | Promise<void>;
  onChecklist: (m: ChecklistMutation) => void | Promise<void>;
};

export function GoalActions({ goal, canEditChecklist, mutationBusy, t, onAction, onChecklist }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="primary"
        className="h-8 px-3 text-xs"
        disabled={mutationBusy || goal.status !== 'active'}
        onClick={() => void onAction('pause')}
      >
        {t.pause}
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="h-8 px-3 text-xs"
        disabled={mutationBusy || (goal.status !== 'paused' && goal.status !== 'done')}
        onClick={() => void onAction('resume')}
      >
        {t.resume}
      </Button>
      <details className="group relative">
        <summary
          className={cn(
            'flex h-8 cursor-pointer list-none items-center rounded-md border border-edge bg-surface-panel px-2.5 text-xs text-fg-muted',
            'marker:hidden [&::-webkit-details-marker]:hidden',
            'hover:bg-surface-hover hover:text-fg',
          )}
          title={t.moreHint}
        >
          {t.moreActions}
        </summary>
        <div className="absolute right-0 z-30 mt-1 min-w-[11rem] rounded-md border border-edge bg-surface-panel py-1 shadow-surface">
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-xs text-fg hover:bg-surface-hover"
            disabled={mutationBusy}
            onClick={() => void onAction('restart')}
          >
            {t.restart}
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-xs text-fg hover:bg-surface-hover"
            disabled={mutationBusy || !canEditChecklist}
            onClick={() => void onChecklist({ op: 'reset' })}
          >
            {t.resetChecklist}
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-xs text-destructive hover:bg-surface-hover"
            disabled={mutationBusy}
            onClick={() => void onAction('clear')}
          >
            {t.clear}
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-xs text-fg hover:bg-surface-hover"
            disabled={mutationBusy}
            onClick={() => void onAction('detach')}
          >
            Detach
          </button>
        </div>
      </details>
    </div>
  );
}
