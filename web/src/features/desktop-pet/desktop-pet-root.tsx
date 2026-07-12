import { ChevronDown } from 'lucide-react';
import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DesktopPetSprite } from '@/features/desktop-pet/desktop-pet-sprite';
import { actionForEvent, messageForEvent } from '@/features/desktop-pet/desktop-pet-copy';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';
import type { DesktopPetAction, DesktopPetEvent, DesktopPetState } from '@/types/electron';

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
  const [tipCount, setTipCount] = useState(0);
  const [activeRoute, setActiveRoute] = useState('/chat');
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

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
      if (state.prefs.feedbackLevel === 'quiet' && event.severity !== 'error' && event.kind !== 'agent-success') {
        return;
      }
      setAction(actionForEvent(event));
      setBubble(messageForEvent(event, language, t));
      setTipCount((current) => (state.prefs.collapsed ? Math.min(99, Math.max(1, current) + 1) : 1));
      if (event.route?.startsWith('/')) {
        setActiveRoute(event.route);
      }
      window.clearTimeout(Number((window as unknown as { desktopPetBubbleTimer?: number }).desktopPetBubbleTimer));
      (window as unknown as { desktopPetBubbleTimer?: number }).desktopPetBubbleTimer = window.setTimeout(() => {
        setAction('idle');
        setBubble(null);
        if (!state.prefs.collapsed) setTipCount(0);
      }, event.severity === 'error' ? 9000 : 6200);
    });
    return () => {
      offState();
      offEvent();
    };
  }, [language, state.prefs.collapsed, state.prefs.feedbackLevel, t]);

  useEffect(() => {
    void window.electronAPI?.pet?.setClickThrough(false);
  }, []);

  const selectedPet = useMemo(
    () => state.pets.find((pet) => pet.id === state.prefs.selectedPetId) ?? state.pets[0],
    [state.pets, state.prefs.selectedPetId],
  );

  const openTarget = () => {
    void window.electronAPI?.pet?.openMainWindow(activeRoute);
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
    <div className="desktop-pet-window">
      {state.prefs.bubbleEnabled && !state.prefs.collapsed && bubble ? (
        <button
          type="button"
          className={cn('desktop-pet-bubble', interaction.press)}
          onClick={openTarget}
          title={t.openApp}
        >
          <span className="line-clamp-2">{bubble}</span>
        </button>
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
          <DesktopPetSprite pet={selectedPet} action={action} />
        </button>
      </div>
    </div>
  );
}
