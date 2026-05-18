import {
  fetchWebchatGoalRuns,
  type WebchatGoalRunWire,
  type WebchatPersistentGoalWire,
} from '@/features/chat/goals-api';
import type { StoredLanguage } from '@/lib/storage';
import { useAsyncResource } from '@/lib/use-async-resource';

import { runVerdictLabel, statusAfterLabel, type GoalMessages } from './chat-goal-banner-utils';

type Props = {
  sessionKey: string;
  goal: WebchatPersistentGoalWire;
  language: StoredLanguage;
  t: GoalMessages;
};

type GoalMessagesWithRunCopy = GoalMessages & {
  latestRunTitle?: string;
  nextStepContinue?: string;
  nextStepStop?: string;
};

export function GoalLatestRun({ sessionKey, goal, language, t }: Props) {
  const { data: runs, loading } = useAsyncResource(
    async () => {
      const res = await fetchWebchatGoalRuns(sessionKey, { limit: 1 });
      return res.runs;
    },
    [sessionKey, goal.turnsUsed, goal.lastTurnAt, goal.lastVerdict],
    { initial: [] as WebchatGoalRunWire[], errorData: [] },
  );

  const run = runs[0];
  if (!run && !loading) return null;
  const copy = t as GoalMessagesWithRunCopy;

  return (
    <section className="rounded-xl border border-edge/70 bg-surface-panel px-2.5 py-2 text-xs">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-fg-muted">
        <span className="font-medium uppercase tracking-wide">{copy.latestRunTitle ?? t.runHistory}</span>
        {run ? (
          <time suppressHydrationWarning dateTime={new Date(run.at).toISOString()}>
            {new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }).format(run.at)}
          </time>
        ) : null}
      </div>
      {run ? (
        <div className="grid gap-1.5 sm:grid-cols-[auto_1fr_auto] sm:items-start">
          <div className="rounded-full border border-edge bg-surface-muted px-2 py-0.5 text-[10px] text-fg-muted">
            {t.runHistoryTurns.replace('{{used}}', String(run.turnsUsed)).replace('{{max}}', String(run.maxTurns))}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-fg">
              <span>{runVerdictLabel(run.verdict, t)}</span>
              <span className="text-fg-muted">·</span>
              <span>{statusAfterLabel(run.statusAfter, t)}</span>
              {run.checklistProgress ? (
                <>
                  <span className="text-fg-muted">·</span>
                  <span>
                    {t.checklistProgress
                      .replace('{{done}}', String(run.checklistProgress.done))
                      .replace('{{total}}', String(run.checklistProgress.total))}
                  </span>
                </>
              ) : null}
            </div>
            {run.reason ? <p className="mt-1 line-clamp-2 break-words text-fg-muted">{run.reason}</p> : null}
          </div>
          <div className="text-[10px] text-accent sm:text-right">
            {run.willContinue ? (copy.nextStepContinue ?? t.runHistoryContinue) : (copy.nextStepStop ?? t.runHistoryStop)}
          </div>
        </div>
      ) : (
        <p className="text-fg-muted">{t.runHistoryLoading}</p>
      )}
    </section>
  );
}
