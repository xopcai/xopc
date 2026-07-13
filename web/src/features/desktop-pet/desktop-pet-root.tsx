import { ChevronDown } from 'lucide-react';
import {
  type CSSProperties,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { DesktopPetSprite } from '@/features/desktop-pet/desktop-pet-sprite';
import { actionForEvent, messageForEvent } from '@/features/desktop-pet/desktop-pet-copy';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/fetch';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';
import type { DesktopPetAction, DesktopPetEvent, DesktopPetState } from '@/types/electron';

type ActivityEntry = {
  id: string;
  label: string;
  detail?: string;
};

function activityDetail(event: DesktopPetEvent): string | undefined {
  const detail = event.activity?.detail;
  const { completed, total } = event.activity ?? {};
  const progress =
    typeof completed === 'number' && typeof total === 'number' ? `${completed}/${total}` : undefined;
  return [detail, progress].filter((value): value is string => Boolean(value)).join(' · ') || undefined;
}

function fallbackState(): DesktopPetState {
  return {
    prefs: {
      enabled: true,
      showOnStartup: false,
      selectedPetId: 'ember',
      alwaysOnTop: true,
      bubbleEnabled: true,
      clickThroughWhenIdle: false,
      muted: false,
      feedbackLevel: 'normal',
      sizePercent: 100,
      collapsed: false,
    },
    pets: [],
    visible: true,
    customPetsDir: '',
    petIssues: [],
  };
}

export function DesktopPetRoot() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).desktopPet;
  const [state, setState] = useState<DesktopPetState>(() => fallbackState());
  const [action, setAction] = useState<DesktopPetAction>('idle');
  const [bubble, setBubble] = useState<string | null>(null);
  const [bubbleDetail, setBubbleDetail] = useState<string | null>(null);
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [taskStartedAt, setTaskStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [tipCount, setTipCount] = useState(0);
  const [activeRoute, setActiveRoute] = useState('/chat');
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const bubbleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.dataset.desktopPet = 'true';
    return () => {
      delete document.documentElement.dataset.desktopPet;
    };
  }, []);

  useEffect(() => {
    const api = window.electronAPI?.pet;
    if (!api) return;
    void api.getState().then((next) => {
      setState(next);
      setTipCount(0);
    }).catch(() => {});
    const offState = api.onStateChanged((next) => {
      setState(next);
      if (!next.prefs.collapsed) setTipCount(0);
    });
    const offEvent = api.onEvent((event: DesktopPetEvent) => {
      if (
        state.prefs.feedbackLevel === 'quiet' &&
        event.severity !== 'error' &&
        event.kind !== 'agent-success' &&
        event.activity?.phase !== 'waiting'
      ) {
        return;
      }
      const label = messageForEvent(event, language, t);
      const detail = activityDetail(event);
      const isWaiting = event.activity?.phase === 'waiting';
      const isTerminal = event.kind === 'agent-success' || event.kind === 'agent-error';
      setAction(actionForEvent(event));
      setBubble(label);
      setBubbleDetail(detail ?? null);
      if (event.kind === 'agent-start') {
        setActivityEntries([]);
        setTaskStartedAt(Date.now());
        setElapsedSeconds(0);
      }
      if (event.runId) setActiveRunId(event.runId);
      if (event.kind === 'agent-tool' || event.kind === 'agent-progress') {
        setActivityEntries((current) => [
          { id: `${Date.now()}-${event.kind}-${Math.random().toString(36).slice(2, 7)}`, label, detail },
          ...current.filter((entry) => entry.label !== label || entry.detail !== detail),
        ].slice(0, 3));
      }
      if (isTerminal) setActiveRunId(null);
      setTipCount((current) => (state.prefs.collapsed ? Math.min(99, Math.max(1, current) + 1) : 1));
      if (event.route?.startsWith('/')) {
        setActiveRoute(event.route);
      }
      if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
      if (isWaiting) return;
      bubbleTimerRef.current = window.setTimeout(() => {
        setAction('idle');
        setBubble(null);
        setBubbleDetail(null);
        if (!state.prefs.collapsed) setTipCount(0);
      }, event.severity === 'error' ? 9000 : 6200);
    });
    return () => {
      offState();
      offEvent();
      if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
    };
  }, [language, state.prefs.collapsed, state.prefs.feedbackLevel, t]);

  useEffect(() => {
    if (!taskStartedAt || !activeRunId) return;
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - taskStartedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [activeRunId, taskStartedAt]);

  useEffect(() => {
    void window.electronAPI?.pet?.setClickThrough(false);
  }, []);

  const selectedPet = useMemo(
    () => state.pets.find((pet) => pet.id === state.prefs.selectedPetId) ?? state.pets[0],
    [state.pets, state.prefs.selectedPetId],
  );
  const sizeScale = Math.min(1.4, Math.max(0.7, state.prefs.sizePercent / 100));
  const petDisplayHeight = Math.round(112 * sizeScale);
  const petWindowStyle = {
    '--desktop-pet-stage-size': `${Math.round(132 * sizeScale)}px`,
    '--desktop-pet-stage-right': `${Math.round(24 * sizeScale)}px`,
    '--desktop-pet-stage-bottom': `${Math.round(16 * sizeScale)}px`,
    '--desktop-pet-menu-size': `${Math.round(28 * sizeScale)}px`,
    '--desktop-pet-menu-left': `${Math.round(-6 * sizeScale)}px`,
    '--desktop-pet-menu-bottom': `${Math.round(12 * sizeScale)}px`,
  } as CSSProperties;

  const openTarget = () => {
    void window.electronAPI?.pet?.openMainWindow(activeRoute);
  };

  const stopTask = async () => {
    if (!activeRunId) return;
    const response = await apiFetch('/api/agent/abort', {
      method: 'POST',
      body: JSON.stringify({ runId: activeRunId }),
    }).catch(() => null);
    if (response?.ok) {
      setActiveRunId(null);
      setBubble(t.taskStopped);
      setBubbleDetail(null);
      setAction('idle');
    }
  };

  const toggleBubble = async () => {
    const nextCollapsed = !state.prefs.collapsed;
    setTipCount((current) => (nextCollapsed && bubble ? Math.max(1, current) : 0));
    setState((current) => ({
      ...current,
      prefs: { ...current.prefs, collapsed: nextCollapsed },
    }));
    const next = await window.electronAPI?.pet?.setPrefs({ collapsed: nextCollapsed });
    if (next) setState(next);
  };

  const beginDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    void window.electronAPI?.pet?.startDrag({ screenX: event.screenX, screenY: event.screenY });
  }, []);

  const moveDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
    if (distance > 4) {
      drag.moved = true;
      event.preventDefault();
      void window.electronAPI?.pet?.drag({ screenX: event.screenX, screenY: event.screenY });
    }
  }, []);

  const endDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    void window.electronAPI?.pet?.endDrag();
    if (drag.moved) {
      suppressClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }, []);

  const handlePetClick = () => {
    if (suppressClickRef.current) return;
    openTarget();
  };

  if (!selectedPet) {
    return (
      <div className="flex h-screen items-center justify-center bg-transparent text-sm text-fg-muted">
        {t.loading}
      </div>
    );
  }

  return (
    <div className="desktop-pet-window" style={petWindowStyle}>
      {state.prefs.bubbleEnabled && !state.prefs.collapsed && bubble ? (
        <div className="desktop-pet-bubble">
          <button
            type="button"
            className={cn('desktop-pet-bubble-main', interaction.press)}
            onClick={openTarget}
            title={t.openApp}
          >
            <span className="desktop-pet-bubble-title">{bubble}</span>
            {state.prefs.feedbackLevel === 'chatty' && bubbleDetail ? (
              <span className="desktop-pet-bubble-detail">{bubbleDetail}</span>
            ) : null}
          </button>
          {state.prefs.feedbackLevel === 'chatty' && (activityEntries.length > 0 || activeRunId) ? (
            <div className="desktop-pet-activity-card">
              <div className="desktop-pet-activity-heading">
                {activeRunId ? `${t.taskInProgress} · ${elapsedSeconds}s` : t.taskRecentActivity}
              </div>
              {activityEntries.length > 0 ? (
                <ul className="desktop-pet-activity-list">
                  {activityEntries.map((entry) => (
                    <li key={entry.id}>
                      <span>{entry.label}</span>
                      {entry.detail ? <small>{entry.detail}</small> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="desktop-pet-activity-actions">
                <button type="button" onClick={openTarget}>{t.viewSession}</button>
                {activeRunId ? <button type="button" onClick={() => void stopTask()}>{t.stopTask}</button> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="desktop-pet-stage">
        <button
          type="button"
          className={cn('desktop-pet-menu-button', state.prefs.collapsed && 'desktop-pet-menu-button--collapsed')}
          onClick={() => void toggleBubble()}
          aria-pressed={state.prefs.collapsed}
          aria-label={t.menu}
          title={t.menu}
        >
          {state.prefs.collapsed && tipCount > 0 ? (
            <span className="desktop-pet-tip-count">{tipCount}</span>
          ) : (
            <ChevronDown className="desktop-pet-menu-chevron size-4" strokeWidth={1.8} />
          )}
        </button>
        <button
          type="button"
          className="desktop-pet-hit-area"
          onClick={handlePetClick}
          onDoubleClick={handlePetClick}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          title={t.openApp}
        >
          <DesktopPetSprite pet={selectedPet} action={action} displayHeight={petDisplayHeight} />
        </button>
      </div>
    </div>
  );
}
