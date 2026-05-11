import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronUp, ListChecks, Target } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  fetchWebchatGoal,
  postWebchatChecklistMutation,
  postWebchatGoalAction,
  type GoalWebchatAction,
  type WebchatChecklistItemWire,
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

function checklistStats(g: WebchatPersistentGoalWire): { total: number; done: number } {
  const items = g.checklist ?? [];
  const total = items.length;
  const done = items.filter((i) => i.status === 'completed' || i.status === 'impossible').length;
  return { total, done };
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

function verdictLabel(
  v: WebchatPersistentGoalWire['lastVerdict'],
  t: ReturnType<typeof messages>['chat']['goal'],
): string {
  if (v === 'done') return t.verdictDone;
  if (v === 'continue') return t.verdictContinue;
  if (v === 'skipped') return t.verdictSkipped;
  if (v === 'decompose') return t.verdictDecompose;
  return v ?? '';
}

function collapsedStorageKey(sk: string): string {
  return `xopc:goalBannerCollapsed:${sk}`;
}

function itemMarker(it: WebchatChecklistItemWire): string {
  if (it.status === 'completed') return '✓';
  if (it.status === 'impossible') return '!';
  return '○';
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
  const [newCriterion, setNewCriterion] = useState('');
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
      setNewCriterion('');
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
  const pillTitle = t.pillTitle.replace('{{status}}', statusShort).replace('{{turns}}', turnsShort);

  if (collapsed) {
    return (
      <div className="pointer-events-none sticky top-0 z-20 flex shrink-0 justify-end px-3 pb-1 pt-2 sm:px-5 xl:px-6">
        <div className="pointer-events-auto mx-auto w-full max-w-[var(--max-width-chat)] flex justify-end">
          <button
            type="button"
            className={cn(
              'flex h-11 min-w-11 max-w-[min(100%,16rem)] items-center gap-1.5 rounded-full bg-surface-panel px-2.5 py-1 text-left shadow-elevated',
              'transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
            )}
            title={`${pillTitle}${clLine ? ` · ${clLine}` : ''}\n${g.goal}`}
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
              <span className="block truncate text-[10px] leading-tight text-fg-muted">
                {clLine ? `${turnsShort} · ${clLine}` : turnsShort}
              </span>
            </span>
          </button>
        </div>
      </div>
    );
  }

  const items = g.checklist ?? [];
  const canEditChecklist = g.status === 'active' || g.status === 'paused';

  return (
    <div className="shrink-0 w-full px-3 pb-3 pt-1.5 sm:px-5 sm:pb-3 sm:pt-2 xl:px-6">
      <div className="mx-auto flex w-full max-w-[var(--max-width-chat)] flex-col gap-2.5 rounded-2xl bg-surface-panel px-3 py-2.5 shadow-elevated sm:px-4 sm:py-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <ListChecks className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
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
              {clTotal > 0 ? (
                <span className="rounded-full bg-surface-panel px-1.5 py-0.5 text-fg">{clLine}</span>
              ) : null}
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
              className="h-8 w-8 shrink-0 rounded-full p-0 text-fg-muted hover:text-fg"
              aria-label={t.collapseAria}
              onClick={() => setCollapsedPersist(true)}
            >
              <ChevronUp className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>

        <div className="h-1 overflow-hidden rounded-full bg-surface-elevated">
          <div
            className="h-full rounded-full bg-accent/70 transition-[width]"
            style={{ width: `${turnPct}%` }}
          />
        </div>

        <div className="rounded-xl bg-surface-muted/70 px-2.5 py-2 dark:bg-surface-muted/40">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-muted">{t.checklistHeading}</p>
          {items.length === 0 ? (
            <p className="text-xs text-fg-muted">{t.checklistEmpty}</p>
          ) : (
            <ul className="max-h-36 space-y-1.5 overflow-y-auto pr-0.5 text-xs">
              {items.map((it, i) => {
                const n = i + 1;
                return (
                  <li
                    key={`${n}-${it.text.slice(0, 24)}`}
                    className="flex items-start gap-2 rounded-md border border-transparent px-1 py-0.5 hover:border-edge/60"
                  >
                    <span className="mt-0.5 w-4 shrink-0 text-center text-fg-muted" title={it.status}>
                      {itemMarker(it)}
                    </span>
                    <span className="min-w-0 flex-1 text-fg">{it.text}</span>
                    {canEditChecklist && it.status === 'pending' ? (
                      <span className="flex shrink-0 gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-7 px-1.5 text-[11px] text-accent"
                          disabled={mutationBusy}
                          onClick={() => void runChecklist({ op: 'mark', index: n, status: 'completed' })}
                        >
                          {t.markDone}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-7 px-1.5 text-[11px] text-fg-muted"
                          disabled={mutationBusy}
                          onClick={() => void runChecklist({ op: 'mark', index: n, status: 'impossible' })}
                        >
                          {t.markBlocked}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-7 px-1.5 text-[11px] text-destructive"
                          disabled={mutationBusy}
                          onClick={() => void runChecklist({ op: 'remove', index: n })}
                        >
                          {t.removeItem}
                        </Button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {canEditChecklist ? (
            <div className="mt-2 flex gap-1.5">
              <input
                type="text"
                value={newCriterion}
                onChange={(e) => setNewCriterion(e.target.value)}
                placeholder={t.addCriterionPlaceholder}
                className={cn(
                  'min-w-0 flex-1 rounded-md border border-edge bg-surface-muted px-2 py-1.5 text-xs text-fg',
                  'placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                )}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newCriterion.trim()) {
                    e.preventDefault();
                    void runChecklist({ op: 'add', text: newCriterion.trim() });
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                className="h-8 shrink-0 px-2.5 text-xs"
                disabled={mutationBusy || !newCriterion.trim()}
                onClick={() => void runChecklist({ op: 'add', text: newCriterion.trim() })}
              >
                {t.addCriterion}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="primary"
            className="h-8 px-3 text-xs"
            disabled={mutationBusy || g.status !== 'active'}
            onClick={() => void runAction('pause')}
          >
            {t.pause}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-8 px-3 text-xs"
            disabled={mutationBusy || (g.status !== 'paused' && g.status !== 'done')}
            onClick={() => void runAction('resume')}
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
                onClick={() => void runAction('restart')}
              >
                {t.restart}
              </button>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-xs text-fg hover:bg-surface-hover"
                disabled={mutationBusy || !canEditChecklist}
                onClick={() => void runChecklist({ op: 'reset' })}
              >
                {t.resetChecklist}
              </button>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-xs text-destructive hover:bg-surface-hover"
                disabled={mutationBusy}
                onClick={() => void runAction('clear')}
              >
                {t.clear}
              </button>
            </div>
          </details>
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
                    <span className="font-medium text-fg">{t.lastVerdict}:</span>{' '}
                    {verdictLabel(g.lastVerdict, t)}
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
