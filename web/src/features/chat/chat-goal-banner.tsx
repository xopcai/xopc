import { useCallback, useEffect, useRef, useState } from 'react';

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

export function ChatGoalBanner({ sessionKey, streaming, sending }: ChatGoalBannerProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.chat.goal;

  const [goal, setGoal] = useState<WebchatPersistentGoalWire | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const prevStreamingRef = useRef(false);

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
