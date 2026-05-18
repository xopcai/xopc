import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronUp, ListChecks } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  computeGoalWallElapsedMs,
  formatExecutionElapsedMs,
} from '@/features/chat/format-execution-elapsed';
import {
  fetchWebchatGoal,
  postWebchatChecklistMutation,
  postWebchatGoalAction,
  type GoalWebchatAction,
  type WebchatPersistentGoalWire,
} from '@/features/chat/goals-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import { GoalActions } from './chat-goal-banner-actions';
import { GoalChecklist } from './chat-goal-banner-checklist';
import { GoalCollapsedFab } from './chat-goal-banner-collapsed-fab';
import { GoalDetailsToggle } from './chat-goal-banner-details';
import { GoalRunsHistory } from './chat-goal-banner-runs-history';
import {
  checklistStats,
  collapsedStorageKey,
  shouldShowGoal,
  statusLabel,
} from './chat-goal-banner-utils';

type ChatGoalBannerProps = {
  sessionKey: string;
  streaming: boolean;
  sending: boolean;
};

export function ChatGoalBanner({ sessionKey, streaming, sending }: ChatGoalBannerProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.chat.goal;

  const [goal, setGoal] = useState<WebchatPersistentGoalWire | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const prevStreamingRef = useRef(false);
  const [, bumpGoalClock] = useState(0);

  useEffect(() => {
    try {
      setCollapsed(sessionStorage.getItem(collapsedStorageKey(sessionKey)) === '1');
    } catch {
      setCollapsed(false);
    }
  }, [sessionKey]);

  const setCollapsedPersist = useCallback(
    (next: boolean) => {
      setCollapsed(next);
      try {
        if (next) {
          sessionStorage.setItem(collapsedStorageKey(sessionKey), '1');
        } else {
          sessionStorage.removeItem(collapsedStorageKey(sessionKey));
        }
      } catch {
        /* ignore */
      }
    },
    [sessionKey],
  );

  const refetch = useCallback(async () => {
    try {
      setError(null);
      const res = await fetchWebchatGoal(sessionKey, { uiLocale: language });
      setGoal(res.persistentGoal);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.loadFailed);
    } finally {
      setLoaded(true);
    }
  }, [sessionKey, t.loadFailed, language]);

  useEffect(() => {
    setLoaded(false);
    setGoal(null);
    void refetch();
  }, [sessionKey, refetch]);

  useEffect(() => {
    const onSessionUpdated = (e: Event) => {
      const key = (e as CustomEvent<{ key?: string }>).detail?.key;
      if (key === sessionKey) void refetch();
    };
    window.addEventListener('session-updated', onSessionUpdated);
    return () => window.removeEventListener('session-updated', onSessionUpdated);
  }, [sessionKey, refetch]);

  useEffect(() => {
    const was = prevStreamingRef.current;
    prevStreamingRef.current = streaming || sending;
    if (was && !streaming && !sending) {
      void refetch();
    }
  }, [streaming, sending, refetch]);

  const goalStatus = goal?.status;
  useEffect(() => {
    if (collapsed || !goalStatus || goalStatus === 'done' || goalStatus === 'cleared') return;
    const id = window.setInterval(() => bumpGoalClock((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [goalStatus, collapsed]);

  const runAction = async (action: GoalWebchatAction) => {
    setMutationBusy(true);
    setError(null);
    try {
      await postWebchatGoalAction(sessionKey, action, { uiLocale: language });
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.loadFailed);
    } finally {
      setMutationBusy(false);
    }
  };

  const runChecklist = async (mutation: Parameters<typeof postWebchatChecklistMutation>[1]) => {
    setMutationBusy(true);
    setError(null);
    try {
      await postWebchatChecklistMutation(sessionKey, mutation, { uiLocale: language });
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.loadFailed);
    } finally {
      setMutationBusy(false);
    }
  };

  if (!loaded || !shouldShowGoal(goal)) {
    return null;
  }

  const g = goal;
  const turnPct = g.maxTurns > 0 ? Math.min(100, (100 * g.turnsUsed) / g.maxTurns) : 0;
  const agentBusy = streaming || sending;
  const turnsShort = `${g.turnsUsed}/${g.maxTurns}`;
  const statusShort = statusLabel(g, t);
  const { total: clTotal, done: clDone } = checklistStats(g);
  const clLine =
    clTotal > 0 ? t.checklistProgress.replace('{{done}}', String(clDone)).replace('{{total}}', String(clTotal)) : '';
  const elapsedMs = computeGoalWallElapsedMs(g, Date.now());
  const elapsedStr = formatExecutionElapsedMs(elapsedMs, language);
  const pillTitle = t.pillTitle.replace('{{status}}', statusShort).replace('{{turns}}', turnsShort);

  if (collapsed) {
    return (
      <GoalCollapsedFab
        goal={g}
        agentBusy={agentBusy}
        pillTitle={pillTitle}
        statusShort={statusShort}
        turnsShort={turnsShort}
        clLine={clLine}
        t={t}
        onExpand={() => setCollapsedPersist(false)}
      />
    );
  }

  const canEditChecklist = g.status === 'active' || g.status === 'paused';

  return (
    <div className="shrink-0 w-full px-3 pt-1.5 sm:px-5 sm:pt-2 xl:px-6">
      <div className="mx-auto flex w-full max-w-[var(--max-width-chat)] flex-col gap-2.5 rounded-2xl bg-surface-panel px-3 py-2.5 shadow-elevated sm:px-4 sm:py-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <ListChecks className="size-3.5 shrink-0 text-accent" aria-hidden />
              <span className="font-medium text-fg">{t.heading}</span>
              <span
                className={cn(
                  'rounded-full border px-1.5 py-0.5',
                  g.status === 'active' && 'border-accent/40 text-accent',
                  g.status === 'paused' && 'border-edge text-fg-muted',
                  g.status === 'done' && 'border-edge text-fg-muted',
                )}
              >
                {statusShort}
              </span>
              <span>{t.turns.replace('{{used}}', String(g.turnsUsed)).replace('{{max}}', String(g.maxTurns))}</span>
              {clTotal > 0 ? (
                <span className="rounded-full bg-surface-panel px-1.5 py-0.5 text-fg">{clLine}</span>
              ) : null}
              <span className="text-fg-muted">
                {t.elapsedLabel}: <span className="text-fg">{elapsedStr}</span>
              </span>
              {agentBusy ? <span className="text-accent">{t.agentRunning}</span> : null}
            </div>
            <p className="mt-1 line-clamp-2 text-sm leading-snug text-fg" title={g.goal}>
              {g.goal}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              className="size-8 shrink-0 rounded-full p-0 text-fg-muted hover:text-fg"
              aria-label={t.collapseAria}
              onClick={() => setCollapsedPersist(true)}
            >
              <ChevronUp className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        <div className="h-1 overflow-hidden rounded-full bg-surface-elevated">
          <div className="h-full rounded-full bg-accent/70 transition-[width]" style={{ width: `${turnPct}%` }} />
        </div>

        <GoalChecklist goal={g} canEdit={canEditChecklist} mutationBusy={mutationBusy} t={t} onMutate={runChecklist} />

        <GoalActions
          goal={g}
          canEditChecklist={canEditChecklist}
          mutationBusy={mutationBusy}
          t={t}
          onAction={runAction}
          onChecklist={runChecklist}
        />

        <GoalDetailsToggle goal={g} t={t} />
        <GoalRunsHistory sessionKey={sessionKey} goal={g} language={language} t={t} />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
