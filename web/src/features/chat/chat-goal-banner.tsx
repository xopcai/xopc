import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronUp, Target } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  fetchWebchatGoal,
  postWebchatGoalAction,
  type GoalWebchatAction,
  type WebchatPersistentGoalWire,
} from '@/features/chat/goals-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

type ChatGoalBannerProps = {
  sessionKey: string;
  streaming: boolean;
  sending: boolean;
};

function shouldShowGoal(g: WebchatPersistentGoalWire | null): g is WebchatPersistentGoalWire {
  return g !== null && g.status !== 'cleared';
}

function statusLabel(
  g: WebchatPersistentGoalWire,
  t: ReturnType<typeof messages>['chat']['goal'],
): string {
  if (g.status === 'active') return t.statusActive;
  if (g.status === 'paused') return t.statusPaused;
  if (g.status === 'done') return t.statusDone;
  return g.status;
}

function collapsedStorageKey(sk: string): string {
  return `xopc:goalBannerCollapsed:${sk}`;
}

export function ChatGoalBanner({ sessionKey, streaming, sending }: ChatGoalBannerProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.chat.goal;

  const [goal, setGoal] = useState<WebchatPersistentGoalWire | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const prevStreamingRef = useRef(false);

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
      const res = await fetchWebchatGoal(sessionKey);
      setGoal(res.persistentGoal);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.loadFailed);
    } finally {
      setLoaded(true);
    }
  }, [sessionKey, t.loadFailed]);

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

  const runAction = async (action: GoalWebchatAction) => {
    setMutationBusy(true);
    setError(null);
    try {
      await postWebchatGoalAction(sessionKey, action);
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
  const pillTitle = t.pillTitle.replace('{{status}}', statusShort).replace('{{turns}}', turnsShort);

  if (collapsed) {
    return (
      <div className="pointer-events-none sticky top-0 z-20 flex shrink-0 justify-end px-3 pt-2 sm:px-5 xl:px-6">
        <div className="pointer-events-auto mx-auto w-full max-w-[var(--max-width-chat)] flex justify-end">
          <button
            type="button"
            className={cn(
              'flex h-11 min-w-11 max-w-[min(100%,14rem)] items-center gap-1.5 rounded-full border border-edge bg-surface-panel px-2.5 py-1 text-left shadow-surface',
              'transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
            )}
            title={`${pillTitle}\n${g.goal}`}
            aria-label={t.expandAria}
            onClick={() => setCollapsedPersist(false)}
          >
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted">
              <Target className="h-4 w-4 text-accent" aria-hidden />
              {agentBusy ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5 rounded-full border-2 border-surface-panel bg-accent motion-safe:animate-pulse" />
              ) : (
                <span
                  className={cn(
                    'absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-panel',
                    g.status === 'active' && 'bg-accent',
                    g.status === 'paused' && 'bg-fg-muted',
                    g.status === 'done' && 'bg-fg-muted',
                  )}
                />
              )}
            </span>
            <span className="min-w-0 flex-1 pr-0.5">
              <span className="block truncate text-[10px] font-medium leading-tight text-fg">{statusShort}</span>
              <span className="block truncate text-[10px] leading-tight text-fg-muted">{turnsShort}</span>
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-edge bg-surface-muted/50 px-3 py-2.5 sm:px-5 xl:px-6">
      <div className="mx-auto flex max-w-[var(--max-width-chat)] flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <span className="font-medium text-fg">{t.heading}</span>
              <span
                className={cn(
                  'rounded-full border px-1.5 py-0.5',
                  g.status === 'active' && 'border-accent/40 text-accent',
                  g.status === 'paused' && 'border-edge text-fg-muted',
                  g.status === 'done' && 'border-edge text-fg-muted',
                )}
              >
                {statusLabel(g, t)}
              </span>
              <span>{t.turns.replace('{{used}}', String(g.turnsUsed)).replace('{{max}}', String(g.maxTurns))}</span>
              {agentBusy ? <span className="text-accent">{t.agentRunning}</span> : null}
            </div>
            <p className="mt-1 truncate text-sm text-fg" title={g.goal}>
              {g.goal}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-8 shrink-0 rounded-full p-0 text-fg-muted hover:text-fg"
              aria-label={t.collapseAria}
              onClick={() => setCollapsedPersist(true)}
            >
              <ChevronUp className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-2.5 py-1 text-xs"
              disabled={mutationBusy || g.status !== 'active'}
              onClick={() => void runAction('pause')}
            >
              {t.pause}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-2.5 py-1 text-xs"
              disabled={mutationBusy || (g.status !== 'paused' && g.status !== 'done')}
              onClick={() => void runAction('resume')}
            >
              {t.resume}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-2.5 py-1 text-xs"
              disabled={mutationBusy}
              onClick={() => void runAction('restart')}
            >
              {t.restart}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-2.5 py-1 text-xs text-destructive hover:text-destructive"
              disabled={mutationBusy}
              onClick={() => void runAction('clear')}
            >
              {t.clear}
            </Button>
          </div>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-surface-elevated">
          <div
            className="h-full rounded-full bg-accent/70 transition-[width]"
            style={{ width: `${turnPct}%` }}
          />
        </div>
        {(g.lastVerdict || g.lastReason) && (
          <div>
            <button
              type="button"
              className="text-xs text-fg-muted underline-offset-2 hover:underline"
              onClick={() => setDetailsOpen((o) => !o)}
            >
              {t.detailsToggle}
            </button>
            {detailsOpen ? (
              <div className="mt-1 space-y-1 rounded-md border border-edge bg-surface-panel px-2 py-1.5 text-xs text-fg-muted">
                {g.lastVerdict ? (
                  <div>
                    <span className="font-medium text-fg">{t.lastVerdict}:</span> {g.lastVerdict}
                  </div>
                ) : null}
                {g.lastReason ? (
                  <div className="whitespace-pre-wrap break-words">
                    <span className="font-medium text-fg">{t.lastReason}:</span> {g.lastReason}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
