import { useState } from 'react';

import type { WebchatPersistentGoalWire } from '@/features/chat/goals-api';

import { verdictLabel, type GoalMessages } from './chat-goal-banner-utils';

type Props = {
  goal: WebchatPersistentGoalWire;
  t: GoalMessages;
};

export function GoalDetailsToggle({ goal, t }: Props) {
  const [open, setOpen] = useState(false);
  if (!goal.lastVerdict && !goal.lastReason) return null;

  return (
    <div>
      <button
        type="button"
        className="text-xs text-fg-muted underline-offset-2 hover:underline"
        onClick={() => setOpen((o) => !o)}
      >
        {t.detailsToggle}
      </button>
      {open ? (
        <div className="mt-1 space-y-1 rounded-md border border-edge bg-surface-panel px-2 py-1.5 text-xs text-fg-muted">
          {goal.lastVerdict ? (
            <div>
              <span className="font-medium text-fg">{t.lastVerdict}:</span> {verdictLabel(goal.lastVerdict, t)}
            </div>
          ) : null}
          {goal.lastReason ? (
            <div className="whitespace-pre-wrap break-words">
              <span className="font-medium text-fg">{t.lastReason}:</span> {goal.lastReason}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
