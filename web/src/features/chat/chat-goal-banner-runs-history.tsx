import { useState } from 'react';

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

export function GoalRunsHistory({ sessionKey, goal, language, t }: Props) {
  const [runsOpen, setRunsOpen] = useState(false);

  const {
    data: runs,
    loading: runsLoading,
    error: runsErrorRaw,
  } = useAsyncResource(
    async () => {
      const res = await fetchWebchatGoalRuns(sessionKey, { limit: 40 });
      return res.runs;
    },
    [runsOpen, sessionKey, goal.turnsUsed, goal.lastTurnAt, goal.lastVerdict],
    { enabled: runsOpen, initial: [] as WebchatGoalRunWire[], errorData: [] },
  );

  const runsError =
    runsErrorRaw == null
      ? null
      : runsErrorRaw instanceof Error
        ? runsErrorRaw.message
        : t.runHistoryLoadFailed;

  return (
    <div>
      <button
        type="button"
        className="text-xs text-fg-muted underline-offset-2 hover:underline"
        onClick={() => setRunsOpen((o) => !o)}
      >
        {t.runHistory}
      </button>
      {runsOpen ? (
        <div className="mt-1 max-h-52 space-y-2 overflow-y-auto rounded-md border border-edge bg-surface-panel p-2 text-xs text-fg-muted">
          {runsLoading ? <p className="text-fg-muted">{t.runHistoryLoading}</p> : null}
          {runsError ? <p className="text-destructive">{runsError}</p> : null}
          {!runsLoading && !runsError && runs.length === 0 ? (
            <p className="text-fg-muted">{t.runHistoryEmpty}</p>
          ) : null}
          {!runsLoading && runs.length > 0 ? (
            <ul className="space-y-2">
              {runs.map((r) => (
                <li
                  key={r.id}
                  className="rounded-md border border-edge/80 bg-surface-muted/40 px-2 py-1.5 dark:bg-surface-muted/25"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[10px] text-fg-muted">
                    <time dateTime={new Date(r.at).toISOString()}>
                      {new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(r.at)}
                    </time>
                    <span>
                      {t.runHistoryTurns
                        .replace('{{used}}', String(r.turnsUsed))
                        .replace('{{max}}', String(r.maxTurns))}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-fg">
                    <span>{runVerdictLabel(r.verdict, t)}</span>
                    <span className="text-fg-muted">·</span>
                    <span>{statusAfterLabel(r.statusAfter, t)}</span>
                    <span className="text-fg-muted">·</span>
                    <span>{r.willContinue ? t.runHistoryContinue : t.runHistoryStop}</span>
                    {r.checklistProgress ? (
                      <>
                        <span className="text-fg-muted">·</span>
                        <span>
                          {t.checklistProgress
                            .replace('{{done}}', String(r.checklistProgress.done))
                            .replace('{{total}}', String(r.checklistProgress.total))}
                        </span>
                      </>
                    ) : null}
                  </div>
                  {r.reason ? (
                    <p className="mt-1 whitespace-pre-wrap break-words text-fg-muted">
                      <span className="font-medium text-fg">{t.lastReason}:</span> {r.reason}
                    </p>
                  ) : null}
                  {r.assistantPreview ? (
                    <p className="mt-1 line-clamp-3 break-words text-[10px] leading-snug text-fg-muted">
                      {r.assistantPreview}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
