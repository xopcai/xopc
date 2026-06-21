import { useState } from 'react';
import { Scale } from 'lucide-react';

import type { WebchatPersistentGoalWire } from '@/features/chat/goals/goals-api';

import { verdictLabel, type GoalMessages } from './chat-goal-banner-utils';

type GoalMessagesWithJudgementCopy = GoalMessages & {
  lastJudgementTitle?: string;
  showDetails?: string;
  hideDetails?: string;
  pausedReason?: string;
  judgeModel?: string;
  parseFailures?: string;
};

type Props = {
  goal: WebchatPersistentGoalWire;
  t: GoalMessages;
};

export function GoalJudgementSummary({ goal, t }: Props) {
  const [open, setOpen] = useState(false);
  const hasJudgement = Boolean(goal.lastVerdict || goal.lastReason || goal.blockedReason);
  if (!hasJudgement) return null;

  const copy = t as GoalMessagesWithJudgementCopy;
  const verdict = goal.lastVerdict ? verdictLabel(goal.lastVerdict, t) : '';
  const primaryReason = goal.blockedReason || goal.lastReason;

  return (
    <section className="rounded-xl border border-edge/70 bg-surface-muted/45 px-2.5 py-2 text-xs dark:bg-surface-muted/25">
      <button
        type="button"
        className="flex w-full min-w-0 items-start gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-panel text-accent">
          <Scale className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5 text-fg">
            <span className="font-medium">{copy.lastJudgementTitle ?? t.detailsToggle}</span>
            {verdict ? <span className="rounded-full border border-edge px-1.5 py-0.5 text-[10px] text-fg-muted">{verdict}</span> : null}
          </span>
          {primaryReason ? <span className="mt-0.5 line-clamp-2 block text-fg-muted">{primaryReason}</span> : null}
        </span>
        <span className="shrink-0 text-[10px] text-fg-muted">
          {open ? (copy.hideDetails ?? t.detailsToggle) : (copy.showDetails ?? t.detailsToggle)}
        </span>
      </button>

      {open ? (
        <div className="mt-2 space-y-1.5 rounded-lg border border-edge/70 bg-surface-panel px-2 py-1.5 text-fg-muted">
          {goal.lastVerdict ? (
            <p>
              <span className="font-medium text-fg">{t.lastVerdict}:</span> {verdict}
            </p>
          ) : null}
          {goal.lastReason ? (
            <p className="whitespace-pre-wrap break-words">
              <span className="font-medium text-fg">{t.lastReason}:</span> {goal.lastReason}
            </p>
          ) : null}
          {goal.blockedReason ? (
            <p className="whitespace-pre-wrap break-words">
              <span className="font-medium text-fg">{copy.pausedReason ?? t.statusPaused}:</span> {goal.blockedReason}
            </p>
          ) : null}
          {goal.judgeModelRef ? (
            <p className="break-words">
              <span className="font-medium text-fg">{copy.judgeModel ?? 'Judge model'}:</span> {goal.judgeModelRef}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
