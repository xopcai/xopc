import { ChevronDown, X } from "lucide-react";
import { type CSSProperties, type PointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { DesktopPetSprite } from "@/features/desktop-pet/desktop-pet-sprite";
import { desktopPetWindowTarget } from "@/features/desktop-pet/desktop-pet-window-target";
import { messages } from "@/i18n/messages";
import { useLocaleStore } from "@/stores/locale-store";
import type { DesktopPetAction, DesktopPetState, PetSessionUpdate } from "@/types/electron";

type Activity = PetSessionUpdate & { expiresAt?: number };
const TERMINAL_TTL_MS = 8_000;

function visibleActivities(values: Activity[]): Activity[] {
  const rank = { error: 0, waiting: 1, running: 2, success: 3 };
  return values.sort((a, b) => rank[a.state] - rank[b.state] || b.timestamp - a.timestamp).slice(0, 3);
}

function fallbackState(): DesktopPetState {
  return { prefs: { enabled: true, showOnStartup: false, selectedPetId: "ember", alwaysOnTop: true, bubbleEnabled: true, clickThroughWhenIdle: false, muted: false, feedbackLevel: "normal", sizePercent: 100, collapsed: false }, pets: [], visible: true, customPetsDir: "", petIssues: [] };
}

export function DesktopPetRoot() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).desktopPet;
  const [state, setState] = useState<DesktopPetState>(fallbackState);
  const [activities, setActivities] = useState<Record<string, Activity>>({});
  const [dismissedSessionKeys, setDismissedSessionKeys] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(Date.now());
  const dragRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const queueRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const selectedPet = useMemo(() => state.pets.find((pet) => pet.id === state.prefs.selectedPetId) ?? state.pets[0], [state]);
  const sizeScale = Math.min(1.4, Math.max(0.7, state.prefs.sizePercent / 100));
  const allActive = useMemo(() => visibleActivities(Object.values(activities).filter((item) => !item.expiresAt || item.expiresAt > now)), [activities, now]);
  const active = useMemo(() => allActive.filter((item) => !dismissedSessionKeys.has(item.sessionKey)), [allActive, dismissedSessionKeys]);
  const primary = active[0];
  const action: DesktopPetAction = primary?.state === "error" ? "error" : primary?.state === "success" ? "success" : primary ? "typing" : "idle";

  useEffect(() => {
    document.documentElement.dataset.desktopPet = "true";
    const api = window.electronAPI?.pet;
    if (!api) return;
    void api.getState().then(setState).catch(() => {});
    const offState = api.onStateChanged(setState);
    const offEvent = api.onEvent((update) => setActivities((current) => {
      const prior = current[update.sessionKey];
      if (prior && update.sequence <= prior.sequence) return current;
      return { ...current, [update.sessionKey]: { ...prior, ...update, outputLines: update.outputLines ?? prior?.outputLines, expiresAt: update.state === "success" ? Date.now() + TERMINAL_TTL_MS : undefined } };
    }));
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { delete document.documentElement.dataset.desktopPet; offState(); offEvent(); window.clearInterval(timer); };
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const pet = window.electronAPI?.pet;
    if (!root || !pet) return;
    const report = () => {
      const rects = [queueRef.current, stageRef.current].filter((item): item is HTMLDivElement => item !== null).map((item) => item.getBoundingClientRect());
      if (!rects.length) return;
      const left = Math.min(...rects.map((rect) => rect.left)); const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right)); const bottom = Math.max(...rects.map((rect) => rect.bottom));
      void pet.setContentSize({ width: Math.ceil(right - left), height: Math.ceil(bottom - top) });
    };
    const observer = new ResizeObserver(report); observer.observe(root); if (queueRef.current) observer.observe(queueRef.current); if (stageRef.current) observer.observe(stageRef.current); report();
    return () => observer.disconnect();
  }, [active.length, state.prefs.collapsed, sizeScale]);

  const open = (item = primary) => {
    if (item?.state === "success") {
      setActivities((current) => {
        const { [item.sessionKey]: _opened, ...remaining } = current;
        return remaining;
      });
    }
    void window.electronAPI?.pet?.openMainWindow(desktopPetWindowTarget(item));
  };
  const toggle = async () => {
    if (dismissedSessionKeys.size > 0) {
      setDismissedSessionKeys(new Set());
      if (!state.prefs.collapsed) return;
    }
    const next = await window.electronAPI?.pet?.setPrefs({ collapsed: !state.prefs.collapsed });
    if (next) setState(next);
  };
  const beginDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => { if (event.button !== 0) return; dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); void window.electronAPI?.pet?.startDrag({ screenX: event.screenX, screenY: event.screenY }); }, []);
  const moveDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => { const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return; if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 4) { drag.moved = true; void window.electronAPI?.pet?.drag({ screenX: event.screenX, screenY: event.screenY }); } }, []);
  const endDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    void window.electronAPI?.pet?.endDrag();
    if (drag.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
  }, []);
  const handlePetClick = () => { if (!suppressClickRef.current) open(); };

  if (!selectedPet) return null;
  const style = { "--desktop-pet-stage-size": `${Math.round(132 * sizeScale)}px`, "--desktop-pet-menu-size": `${Math.round(28 * sizeScale)}px`, "--desktop-pet-menu-left": "0px", "--desktop-pet-menu-bottom": `${Math.round(12 * sizeScale)}px` } as CSSProperties;
  return <div ref={rootRef} className="desktop-pet-window" style={style}>
    {!state.prefs.collapsed && active.length > 0 ? <div ref={queueRef} className="desktop-pet-bubble desktop-pet-queue">{active.map((item) => <div key={item.sessionKey} className={`desktop-pet-session desktop-pet-session--${item.state}`}><button type="button" className="desktop-pet-session-open" onClick={() => open(item)}><span className="desktop-pet-session-dot" /><span className="desktop-pet-session-main"><strong>{item.sessionLabel}</strong><span>{item.action}{item.detail ? `：${item.detail}` : item.progress ? ` · ${item.progress.completed}/${item.progress.total}` : item.outputLines?.length ? `：${item.outputLines[Math.floor((now - item.timestamp) / 1800) % item.outputLines.length]}` : item.outputTail ? `：${item.outputTail}` : item.state === "running" ? ` · ${Math.max(1, Math.floor((now - item.timestamp) / 1000))}s` : ""}</span></span></button><button type="button" className="desktop-pet-session-close" aria-label="收起会话" onClick={() => setDismissedSessionKeys((current) => new Set(current).add(item.sessionKey))}><X size={12} /></button></div>)}</div> : null}
    <div ref={stageRef} className="desktop-pet-stage"><button type="button" className="desktop-pet-menu-button" onClick={() => void toggle()} aria-label={t.menu}>{(state.prefs.collapsed ? allActive.length : dismissedSessionKeys.size) > 0 ? <span className="desktop-pet-tip-count">{Math.min(99, state.prefs.collapsed ? allActive.length : dismissedSessionKeys.size)}</span> : <ChevronDown className="desktop-pet-menu-chevron size-4" />}</button><button type="button" className="desktop-pet-hit-area" onClick={handlePetClick} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} title={t.openApp}><DesktopPetSprite pet={selectedPet} action={action} displayHeight={Math.round(112 * sizeScale)} /></button></div>
  </div>;
}
