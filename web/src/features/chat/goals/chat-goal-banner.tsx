import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useReducer, useRef, useState } from 'react';
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
import { useLocaleStore } from '@/stores/locale-store';
import { useAsyncResource } from '@/lib/use-async-resource';
import { showToast } from '@/lib/toast';

import { GoalActions } from './chat-goal-banner-actions';
import { GoalChecklist } from './chat-goal-banner-checklist';
import { GoalCollapsedFab } from './chat-goal-banner-collapsed-fab';
import { GoalDetailsToggle } from './chat-goal-banner-details';
import { GoalLatestRun } from './chat-goal-latest-run';
import { GoalMissionHeader } from './chat-goal-mission-header';
import { GoalProgressMeter } from './chat-goal-progress-meter';
import { GoalRunsHistory } from './chat-goal-banner-runs-history';
import { checklistStats, collapsedStorageKey, goalUiPhase, shouldShowGoal, statusLabel } from './chat-goal-banner-utils';

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

function ChatGoalBannerBody({ sessionKey, streaming, sending }: ChatGoalBannerProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.chat.goal;

  const [collapsed, setCollapsed] = useState(() => readCollapsedFromStorage(sessionKey));
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
      showToast({ type: 'success', title: 'Goal completed', message: goal.title, duration: 0 });
      return;
    }
    if (goal.status === 'blocked') {
      showToast({ type: 'warning', title: 'Goal blocked', message: goal.blockedReason || goal.title, duration: 0 });
      return;
    }
    if (goal.status === 'needs_input') {
      showToast({ type: 'warning', title: 'Goal needs input', message: goal.blockedReason || goal.title, duration: 0 });
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
  const showGoalClock =
    !collapsed && g.status !== 'done' && g.status !== 'archived';

  if (collapsed) {
    return (
      <GoalCollapsedFab
        goal={g}
        agentBusy={agentBusy}
        pillTitle={pillTitle}
        phase={phase}
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
      {showGoalClock ? <GoalElapsedTicker onTick={bumpGoalClock} /> : null}
      <div className="mx-auto flex w-full max-w-[var(--max-width-chat)] flex-col gap-2.5 rounded-2xl bg-surface-panel px-3 py-2.5 shadow-elevated sm:px-4 sm:py-3">
        <GoalMissionHeader
          goal={g}
          phase={phase}
          statusShort={statusShort}
          turnsShort={turnsShort}
          clLine={clLine}
          elapsedStr={elapsedStr}
          t={t}
          onCollapse={() => setCollapsedPersist(true)}
        />

        <GoalProgressMeter goal={g} t={t} />

        <GoalChecklist goal={g} canEdit={canEditChecklist} mutationBusy={mutation.busy} t={t} onMutate={runChecklist} />

        <GoalActions
          goal={g}
          canEditChecklist={canEditChecklist}
          mutationBusy={mutation.busy}
          t={t}
          onAction={runAction}
          onChecklist={runChecklist}
        />

        <GoalDetailsToggle goal={g} t={t} />
        <GoalLatestRun sessionKey={sessionKey} goal={g} language={language} t={t} />
        <GoalRunsHistory sessionKey={sessionKey} goal={g} language={language} t={t} />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

export function ChatGoalBanner(props: ChatGoalBannerProps) {
  return <ChatGoalBannerBody key={props.sessionKey} {...props} />;
}
