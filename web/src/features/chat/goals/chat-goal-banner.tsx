import * as Dialog from '@radix-ui/react-dialog';
import { ExternalLink, ListChecks, Minus, Pause, Play, Target, X } from 'lucide-react';
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  computeGoalWallElapsedMs,
  formatExecutionElapsedMs,
} from '@/features/chat/time/format-execution-elapsed';
import {
  fetchWebchatGoal,
  postWebchatChecklistMutation,
  postWebchatGoalAction,
  type GoalWebchatAction,
  type WebchatPersistentGoalWire,
} from '@/features/chat/goals/goals-api';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';
import { useLocaleStore } from '@/stores/locale-store';
import { useAsyncResource } from '@/lib/use-async-resource';
import { cn } from '@/lib/cn';
import { showActivity } from '@/stores/activity-store';

import { GoalActions } from './chat-goal-banner-actions';
import { GoalChecklist } from './chat-goal-banner-checklist';
import { GoalCollapsedFab } from './chat-goal-banner-collapsed-fab';
import { GoalDetailsToggle } from './chat-goal-banner-details';
import { GoalLatestRun } from './chat-goal-latest-run';
import { GoalProgressMeter } from './chat-goal-progress-meter';
import { GoalRunsHistory } from './chat-goal-banner-runs-history';
import {
  checklistStats,
  collapsedStorageKey,
  goalUiPhase,
  type GoalMessages,
  phaseLabel,
  shouldShowGoal,
  statusLabel,
} from './chat-goal-banner-utils';

type ChatGoalBannerProps = {
  sessionKey: string;
  streaming: boolean;
  sending: boolean;
};

type MutationState = {
  busy: boolean;
  error: string | null;
};

type MutationAction =
  | { type: 'start' }
  | { type: 'error'; error: string }
  | { type: 'done' };

type GoalPanelTab = 'overview' | 'criteria' | 'runs';

function mutationReducer(_state: MutationState, action: MutationAction): MutationState {
  switch (action.type) {
    case 'start':
      return { busy: true, error: null };
    case 'error':
      return { busy: false, error: action.error };
    case 'done':
      return { busy: false, error: null };
  }
}

function readCollapsedFromStorage(sessionKey: string): boolean {
  try {
    return sessionStorage.getItem(collapsedStorageKey(sessionKey)) === '1';
  } catch {
    return false;
  }
}

function GoalElapsedTicker({ onTick }: { onTick: () => void }) {
  useEffect(() => {
    const id = window.setInterval(onTick, 1000);
    return () => clearInterval(id);
  }, [onTick]);
  return null;
}

function GoalSummaryBar({
  goal,
  agentBusy,
  phase,
  statusShort,
  turnsShort,
  clLine,
  elapsedStr,
  mutationBusy,
  t,
  onAction,
  onOpenDetails,
  onMinimize,
}: {
  goal: WebchatPersistentGoalWire;
  agentBusy: boolean;
  phase: ReturnType<typeof goalUiPhase>;
  statusShort: string;
  turnsShort: string;
  clLine: string;
  elapsedStr: string;
  mutationBusy: boolean;
  t: GoalMessages;
  onAction: (action: GoalWebchatAction) => void | Promise<void>;
  onOpenDetails: () => void;
  onMinimize: () => void;
}) {
  const canPause = goal.status === 'active';
  const canResume =
    goal.status === 'paused' || goal.status === 'done' || goal.status === 'blocked' || goal.status === 'needs_input';

  return (
    <div className="shrink-0 w-full px-3 pt-1.5 sm:px-5 sm:pt-2 xl:px-6">
      <div className="mx-auto flex min-h-12 w-full max-w-[var(--max-width-chat)] items-center gap-2 rounded-xl border border-edge bg-surface-panel px-2.5 py-2 shadow-surface sm:px-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left outline-none hover:bg-surface-hover/70 focus-visible:ring-2 focus-visible:ring-accent"
          onClick={onOpenDetails}
        >
          <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted">
            <Target className="size-4 text-accent" aria-hidden />
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface-panel',
                agentBusy && 'bg-accent motion-safe:animate-pulse',
                !agentBusy && goal.status === 'active' && 'bg-accent',
                !agentBusy && goal.status !== 'active' && 'bg-fg-muted',
              )}
            />
          </span>
          <span className="min-w-0 flex-1 py-0.5">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-fg-muted">
              <span className="font-medium text-fg">{phaseLabel(phase, t)}</span>
              <span className="rounded-full border border-edge px-1.5 py-0.5">{statusShort}</span>
              <span>{turnsShort}</span>
              {clLine ? <span>{clLine}</span> : null}
              {goal.status !== 'done' && goal.status !== 'archived' ? (
                <span>
                  {t.elapsedLabel}: <span className="text-fg">{elapsedStr}</span>
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-sm font-medium leading-tight text-fg">{goal.title}</span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            className="hidden h-8 px-2 text-xs sm:inline-flex"
            disabled={mutationBusy || (!canPause && !canResume)}
            onClick={() => void onAction(canPause ? 'pause' : 'resume')}
          >
            {canPause ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            {canPause ? t.pause : t.resume}
          </Button>
          <Button type="button" variant="secondary" className="h-8 px-2.5 text-xs" onClick={onOpenDetails}>
            {t.details}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="size-8 shrink-0 p-0 text-fg-muted hover:text-fg"
            aria-label={t.collapseAria}
            onClick={onMinimize}
          >
            <Minus className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

function GoalDetailsDialog({
  open,
  sessionKey,
  goal,
  language,
  activeTab,
  canEditChecklist,
  mutationBusy,
  error,
  t,
  onOpenChange,
  onTabChange,
  onAction,
  onChecklist,
}: {
  open: boolean;
  sessionKey: string;
  goal: WebchatPersistentGoalWire;
  language: StoredLanguage;
  activeTab: GoalPanelTab;
  canEditChecklist: boolean;
  mutationBusy: boolean;
  error: string | null;
  t: GoalMessages;
  onOpenChange: (open: boolean) => void;
  onTabChange: (tab: GoalPanelTab) => void;
  onAction: (action: GoalWebchatAction) => void | Promise<void>;
  onChecklist: (mutationArg: Parameters<typeof postWebchatChecklistMutation>[1]) => void | Promise<void>;
}) {
  const tabs: Array<{ id: GoalPanelTab; label: string }> = [
    { id: 'overview', label: t.tabOverview },
    { id: 'criteria', label: t.tabCriteria },
    { id: 'runs', label: t.tabRuns },
  ];
  const stateText = goal.blockedReason || goal.nextAction || t.noNextAction || '';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[120] bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[121] flex h-[min(82vh,42rem)] w-[min(100vw-2rem,48rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-popover outline-none">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Target className="size-4 shrink-0 text-accent" aria-hidden />
                <Dialog.Title className="truncate text-sm font-semibold text-fg">
                  {t.detailsTitle}
                </Dialog.Title>
                <span className="rounded-full border border-edge px-1.5 py-0.5 text-[10px] text-fg-muted">
                  {statusLabel(goal, t)}
                </span>
              </div>
              <Dialog.Description className="mt-1 line-clamp-2 text-xs text-fg-muted">
                {goal.title}
              </Dialog.Description>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button asChild type="button" variant="ghost" className="h-8 px-2 text-xs">
                <Link to={`/goals/${encodeURIComponent(goal.id)}`}>
                  <ExternalLink className="size-3.5" aria-hidden />
                  {t.openFullGoal}
                </Link>
              </Button>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="size-8 p-0" aria-label={t.closeDetails}>
                  <X className="size-4" aria-hidden />
                </Button>
              </Dialog.Close>
            </div>
          </div>

          <div className="flex shrink-0 gap-1 border-b border-edge px-4 py-2" role="tablist" aria-label={t.detailsTitle}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  activeTab === tab.id ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
                onClick={() => onTabChange(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {activeTab === 'overview' ? (
              <div className="grid gap-3">
                <section className="rounded-lg border border-edge bg-surface-base p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
                    <ListChecks className="size-4 text-accent" aria-hidden />
                    {t.currentState}
                  </div>
                  <p className={cn('break-words text-sm', goal.blockedReason ? 'text-warning' : 'text-fg')}>
                    {stateText}
                  </p>
                </section>
                <GoalProgressMeter goal={goal} t={t} />
                <GoalDetailsToggle goal={goal} t={t} />
                <GoalLatestRun sessionKey={sessionKey} goal={goal} language={language} t={t} />
              </div>
            ) : null}

            {activeTab === 'criteria' ? (
              <GoalChecklist goal={goal} canEdit={canEditChecklist} mutationBusy={mutationBusy} t={t} onMutate={onChecklist} />
            ) : null}

            {activeTab === 'runs' ? (
              <div className="grid gap-3">
                <GoalLatestRun sessionKey={sessionKey} goal={goal} language={language} t={t} />
                <GoalRunsHistory sessionKey={sessionKey} goal={goal} language={language} t={t} />
              </div>
            ) : null}

            {error ? (
              <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-edge px-4 py-3">
            <span className="text-xs text-fg-muted">
              {t.turns.replace('{{used}}', String(goal.turnsUsed)).replace('{{max}}', String(goal.maxTurns))}
            </span>
            <GoalActions
              goal={goal}
              canEditChecklist={canEditChecklist}
              mutationBusy={mutationBusy}
              t={t}
              onAction={onAction}
              onChecklist={onChecklist}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ChatGoalBannerBody({ sessionKey, streaming, sending }: ChatGoalBannerProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.chat.goal;

  const [collapsed, setCollapsed] = useState(() => readCollapsedFromStorage(sessionKey));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<GoalPanelTab>('overview');
  const [mutation, dispatchMutation] = useReducer(mutationReducer, { busy: false, error: null });
  const [goalClockMs, setGoalClockMs] = useState(() => Date.now());
  const prevAgentBusyRef = useRef(streaming || sending);
  const observedStatusRef = useRef<{ goalId: string; status: string } | null>(null);
  const idleRefetchPendingRef = useRef(false);
  const isAgentBusy = streaming || sending;
  if (prevAgentBusyRef.current && !isAgentBusy) {
    idleRefetchPendingRef.current = true;
  }
  prevAgentBusyRef.current = isAgentBusy;

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

  const {
    data: goal,
    loading,
    error: fetchError,
    setData: setGoal,
  } = useAsyncResource(
    async () => {
      const res = await fetchWebchatGoal(sessionKey, { uiLocale: language });
      return res.goal;
    },
    [sessionKey, language],
    { initial: null as WebchatPersistentGoalWire | null, errorData: null },
  );

  const refetchGoal = useCallback(async () => {
    try {
      const res = await fetchWebchatGoal(sessionKey, { uiLocale: language });
      setGoal(res.goal);
    } catch (e) {
      dispatchMutation({
        type: 'error',
        error: e instanceof Error ? e.message : t.loadFailed,
      });
    }
  }, [sessionKey, language, setGoal, t.loadFailed]);

  const refetchFromEffect = useEffectEvent(() => {
    void refetchGoal();
  });

  useEffect(() => {
    if (!goal) {
      observedStatusRef.current = null;
      return;
    }
    const previous = observedStatusRef.current;
    observedStatusRef.current = { goalId: goal.id, status: goal.status };
    if (!previous || previous.goalId !== goal.id || previous.status === goal.status) return;
    if (goal.status === 'done') {
      showActivity({
        tone: 'success',
        status: 'done',
        title: language === 'zh' ? '目标已完成' : 'Goal completed',
        message: goal.title,
        source: language === 'zh' ? '目标' : 'Goal',
        href: `/goals/${encodeURIComponent(goal.id)}`,
        dedupeKey: `goal:${goal.id}`,
      });
      return;
    }
    if (goal.status === 'blocked') {
      showActivity({
        tone: 'warning',
        status: 'attention',
        title: language === 'zh' ? '目标受阻' : 'Goal blocked',
        message: goal.blockedReason || goal.title,
        source: language === 'zh' ? '目标' : 'Goal',
        href: `/goals/${encodeURIComponent(goal.id)}`,
        dedupeKey: `goal:${goal.id}`,
      });
      return;
    }
    if (goal.status === 'needs_input') {
      showActivity({
        tone: 'warning',
        status: 'attention',
        title: language === 'zh' ? '目标需要你的输入' : 'Goal needs input',
        message: goal.blockedReason || goal.title,
        source: language === 'zh' ? '目标' : 'Goal',
        href: `/goals/${encodeURIComponent(goal.id)}`,
        dedupeKey: `goal:${goal.id}`,
      });
    }
  }, [goal?.id, goal?.status, goal?.updatedAt, goal?.title, goal?.blockedReason]);

  useEffect(() => {
    const onSessionUpdated = (e: Event) => {
      const key = (e as CustomEvent<{ key?: string }>).detail?.key;
      if (key === sessionKey) refetchFromEffect();
    };
    window.addEventListener('session-updated', onSessionUpdated);
    return () => window.removeEventListener('session-updated', onSessionUpdated);
  }, [sessionKey]);

  useLayoutEffect(() => {
    if (!idleRefetchPendingRef.current) return;
    idleRefetchPendingRef.current = false;
    refetchFromEffect();
  });

  const bumpGoalClock = useCallback(() => {
    setGoalClockMs(Date.now());
  }, []);

  const runAction = async (action: GoalWebchatAction) => {
    dispatchMutation({ type: 'start' });
    try {
      await postWebchatGoalAction(sessionKey, action, { uiLocale: language });
      await refetchGoal();
      dispatchMutation({ type: 'done' });
    } catch (e) {
      dispatchMutation({
        type: 'error',
        error: e instanceof Error ? e.message : t.loadFailed,
      });
    }
  };

  const runChecklist = async (mutationArg: Parameters<typeof postWebchatChecklistMutation>[1]) => {
    dispatchMutation({ type: 'start' });
    try {
      await postWebchatChecklistMutation(sessionKey, mutationArg, { uiLocale: language });
      await refetchGoal();
      dispatchMutation({ type: 'done' });
    } catch (e) {
      dispatchMutation({
        type: 'error',
        error: e instanceof Error ? e.message : t.loadFailed,
      });
    }
  };

  const loaded = !loading || fetchError != null || goal != null;
  const error =
    mutation.error ??
    (fetchError == null
      ? null
      : fetchError instanceof Error
        ? fetchError.message
        : t.loadFailed);

  if (!loaded) {
    return null;
  }
  if (!shouldShowGoal(goal)) {
    return null;
  }

  const g = goal;
  const agentBusy = streaming || sending;
  const turnsShort = `${g.turnsUsed}/${g.maxTurns}`;
  const statusShort = statusLabel(g, t);
  const { total: clTotal, done: clDone } = checklistStats(g);
  const clLine =
    clTotal > 0 ? t.checklistProgress.replace('{{done}}', String(clDone)).replace('{{total}}', String(clTotal)) : '';
  const elapsedMs = computeGoalWallElapsedMs(g, goalClockMs);
  const elapsedStr = formatExecutionElapsedMs(elapsedMs, language);
  const phase = goalUiPhase(g, agentBusy);
  const pillTitle = t.pillTitle.replace('{{status}}', statusShort).replace('{{turns}}', turnsShort);
  const showGoalClock = g.status !== 'done' && g.status !== 'archived';

  if (collapsed) {
    return (
      <>
        {showGoalClock ? <GoalElapsedTicker onTick={bumpGoalClock} /> : null}
        <GoalCollapsedFab
          goal={g}
          agentBusy={agentBusy}
          pillTitle={pillTitle}
          phase={phase}
          statusShort={statusShort}
          turnsShort={turnsShort}
          clLine={clLine}
          t={t}
          onExpand={() => setDetailsOpen(true)}
        />
        <GoalDetailsDialog
          open={detailsOpen}
          sessionKey={sessionKey}
          goal={g}
          language={language}
          activeTab={activeTab}
          canEditChecklist={g.status === 'active' || g.status === 'paused'}
          mutationBusy={mutation.busy}
          error={error}
          t={t}
          onOpenChange={setDetailsOpen}
          onTabChange={setActiveTab}
          onAction={runAction}
          onChecklist={runChecklist}
        />
      </>
    );
  }

  const canEditChecklist = g.status === 'active' || g.status === 'paused';

  return (
    <>
      {showGoalClock ? <GoalElapsedTicker onTick={bumpGoalClock} /> : null}
      <GoalSummaryBar
        goal={g}
        agentBusy={agentBusy}
        phase={phase}
        statusShort={statusShort}
        turnsShort={turnsShort}
        clLine={clLine}
        elapsedStr={elapsedStr}
        mutationBusy={mutation.busy}
        t={t}
        onAction={runAction}
        onOpenDetails={() => setDetailsOpen(true)}
        onMinimize={() => setCollapsedPersist(true)}
      />
      <GoalDetailsDialog
        open={detailsOpen}
        sessionKey={sessionKey}
        goal={g}
        language={language}
        activeTab={activeTab}
        canEditChecklist={canEditChecklist}
        mutationBusy={mutation.busy}
        error={error}
        t={t}
        onOpenChange={setDetailsOpen}
        onTabChange={setActiveTab}
        onAction={runAction}
        onChecklist={runChecklist}
      />
    </>
  );
}

export function ChatGoalBanner(props: ChatGoalBannerProps) {
  return <ChatGoalBannerBody key={props.sessionKey} {...props} />;
}
