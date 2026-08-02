import { ChevronDown, ExternalLink, Send, X } from "lucide-react";
import { type CSSProperties, type FormEvent, type PointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { desktopPetActionForPhase } from "@/features/desktop-pet/desktop-pet-narrative";
import { DesktopPetSprite } from "@/features/desktop-pet/desktop-pet-sprite";
import { shouldShowDesktopPetActivity } from "@/features/desktop-pet/desktop-pet-attention-policy";
import {
  activityCompletionText,
  activityDetailText,
  activityHealthText,
  activityReassuranceText,
  IDLE_COMPANION_COOLDOWN_MS,
  shouldShowIdleTip,
} from "@/features/desktop-pet/desktop-pet-display";
import {
  type DesktopPetActivity as Activity,
  type DesktopPetDismissal,
  isDesktopPetActivityDismissed,
  mergeDesktopPetActivities,
  visibleDesktopPetActivities,
} from "@/features/desktop-pet/desktop-pet-session-state";
import { desktopPetWindowTarget } from "@/features/desktop-pet/desktop-pet-window-target";
import { answerDesktopPetClarify, type DesktopPetClarifyPrompt, runDesktopPetQuickTask } from "@/features/desktop-pet/desktop-pet-quick-task";
import { messages } from "@/i18n/messages";
import { useLocaleStore } from "@/stores/locale-store";
import type { DesktopPetAction, DesktopPetDefinition, DesktopPetState } from "@/types/electron";

function activityAnimation(item: Activity | undefined): DesktopPetAction {
  if (!item) return "idle";
  if (item.state === "error") return "concern";
  if (item.state === "success") return "success";
  return item.animation ?? desktopPetActionForPhase(item.phase);
}

function stablePhrase(values: string[] | undefined, item: Activity): string | undefined {
  if (!values?.length) return undefined;
  let seed = item.sequence;
  for (const char of `${item.sessionKey}:${item.runId}`) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  return values[seed % values.length];
}

function petReactionText(
  pet: DesktopPetDefinition,
  item: Activity,
  fallbackPhrases: NonNullable<DesktopPetDefinition["persona"]>["phrases"],
): string | undefined {
  const phrases = pet.persona?.phrases ?? fallbackPhrases;
  if (item.state === "success") return stablePhrase(phrases?.success, item);
  if (item.state === "waiting") return stablePhrase(phrases?.waiting, item);
  if (item.state === "error") return stablePhrase(phrases?.error, item);
  return undefined;
}

function joinReaction(reaction: string | undefined, fact: string, hasSpecificFact: boolean): string {
  if (!reaction) return fact;
  return hasSpecificFact ? `${reaction} · ${fact}` : reaction;
}

function activityCtaText(item: Activity, labels: { open: string; needsInput: string; reviewIssue: string }): string | undefined {
  const nextAction = item.feedback?.nextAction?.type;
  if (nextAction === "confirm") return labels.needsInput;
  if (nextAction === "review_error") return labels.reviewIssue;
  if (nextAction === "open_session") return labels.open;
  if (item.state === "waiting") return labels.needsInput;
  if (item.state === "error") return labels.reviewIssue;
  if (item.state === "success") return labels.open;
  return undefined;
}

function fallbackState(): DesktopPetState {
  const now = Date.now();
  return { prefs: { enabled: true, showOnStartup: false, selectedPetId: "ember", alwaysOnTop: true, bubbleEnabled: true, clickThroughWhenIdle: false, muted: false, behaviorMode: "companion", proactiveTipsEnabled: true, interactionEnabled: true, reducedMotion: false, sizePercent: 100, collapsed: false }, relationship: { firstMetAt: now, lastSeenAt: now, completedTaskCount: 0, unlockedReactions: [], recentCompletedRunIds: [] }, pets: [], visible: true, customPetsDir: "", petIssues: [], activities: [] };
}

export function DesktopPetRoot() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).desktopPet;
  const [state, setState] = useState<DesktopPetState>(fallbackState);
  const [activities, setActivities] = useState<Record<string, Activity>>({});
  const [dismissals, setDismissals] = useState<Record<string, DesktopPetDismissal>>({});
  const [now, setNow] = useState(Date.now());
  const [lastActivityAt, setLastActivityAt] = useState(() => Date.now());
  const [idleDismissedUntil, setIdleDismissedUntil] = useState(0);
  const [interactionAction, setInteractionAction] = useState<DesktopPetAction | null>(null);
  const [quickTaskOpen, setQuickTaskOpen] = useState(false);
  const [quickTaskDraft, setQuickTaskDraft] = useState("");
  const [quickTaskSessionKey, setQuickTaskSessionKey] = useState<string | null>(null);
  const [quickTaskStatus, setQuickTaskStatus] = useState<"idle" | "starting" | "running" | "waiting" | "success" | "error">("idle");
  const [quickTaskError, setQuickTaskError] = useState<string | null>(null);
  const [quickTaskClarify, setQuickTaskClarify] = useState<DesktopPetClarifyPrompt | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const quickTaskRef = useRef<HTMLDivElement | null>(null);
  const queueRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const selectedPet = useMemo(() => state.pets.find((pet) => pet.id === state.prefs.selectedPetId) ?? state.pets[0], [state]);
  const sizeScale = Math.min(1.4, Math.max(0.7, state.prefs.sizePercent / 100));
  const allActive = useMemo(() => visibleDesktopPetActivities(Object.values(activities), now), [activities, now]);
  const queued = useMemo(
    () => state.prefs.bubbleEnabled
      ? allActive.filter((item) => !isDesktopPetActivityDismissed(item, dismissals[item.sessionKey]) && shouldShowDesktopPetActivity(item, state.prefs.behaviorMode, now, state.prefs.remindersPausedUntil))
      : [],
    [allActive, dismissals, now, state.prefs.behaviorMode, state.prefs.bubbleEnabled, state.prefs.remindersPausedUntil],
  );
  const hiddenQueueCount = useMemo(
    () => state.prefs.bubbleEnabled
      ? allActive.filter((item) => isDesktopPetActivityDismissed(item, dismissals[item.sessionKey]) && shouldShowDesktopPetActivity(item, state.prefs.behaviorMode, now, state.prefs.remindersPausedUntil)).length
      : 0,
    [allActive, dismissals, now, state.prefs.behaviorMode, state.prefs.bubbleEnabled, state.prefs.remindersPausedUntil],
  );
  const primary = queued[0] ?? allActive[0];
  const restingAction: DesktopPetAction = now - lastActivityAt > 20 * 60_000 && (new Date(now).getHours() >= 23 || new Date(now).getHours() < 7) ? "sleep" : "idle";
  const action = interactionAction ?? (primary ? activityAnimation(primary) : restingAction);
  const daysTogether = Math.max(1, Math.floor((now - state.relationship.firstMetAt) / 86_400_000) + 1);
  const personaPhrases = t.personaPhrases[selectedPet?.persona?.tone ?? "calm"];
  const idleTipVisible = shouldShowIdleTip({
    bubbleEnabled: state.prefs.bubbleEnabled,
    behaviorMode: state.prefs.behaviorMode,
    proactiveTipsEnabled: state.prefs.proactiveTipsEnabled,
    remindersPausedUntil: state.prefs.remindersPausedUntil,
    collapsed: state.prefs.collapsed,
    queuedCount: queued.length,
    activeCount: allActive.length,
    now,
    lastActivityAt,
    dismissedUntil: idleDismissedUntil,
  });

  useEffect(() => {
    document.documentElement.dataset.desktopPet = "true";
    const api = window.electronAPI?.pet;
    if (!api) return;
    const applyState = (next: DesktopPetState) => {
      setState(next);
      setActivities((current) => mergeDesktopPetActivities(current, next.activities));
    };
    void api.getState().then(applyState).catch(() => {});
    const offState = api.onStateChanged(applyState);
    const offEvent = api.onEvent((update) => setActivities((current) => {
      setLastActivityAt(Date.now());
      return mergeDesktopPetActivities(current, [update]);
    }));
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { delete document.documentElement.dataset.desktopPet; offState(); offEvent(); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!state.relationshipMoment) return;
    setInteractionAction(state.relationshipMoment === "first_meeting" ? "wake" : "greet");
    const timer = window.setTimeout(() => setInteractionAction(null), 1_400);
    return () => window.clearTimeout(timer);
  }, [state.relationshipMoment]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const pet = window.electronAPI?.pet;
    if (!root || !pet) return;
    const report = () => {
      const rects = [quickTaskRef.current, queueRef.current, stageRef.current].filter((item): item is HTMLDivElement => item !== null).map((item) => item.getBoundingClientRect());
      if (!rects.length) return;
      const left = Math.min(...rects.map((rect) => rect.left)); const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right)); const bottom = Math.max(...rects.map((rect) => rect.bottom));
      void pet.setContentSize({ width: Math.ceil(right - left), height: Math.ceil(bottom - top) });
    };
    const observer = new ResizeObserver(report); observer.observe(root); if (quickTaskRef.current) observer.observe(quickTaskRef.current); if (queueRef.current) observer.observe(queueRef.current); if (stageRef.current) observer.observe(stageRef.current); report();
    return () => observer.disconnect();
  }, [idleTipVisible, queued.length, quickTaskOpen, quickTaskStatus, state.prefs.collapsed, sizeScale]);

  const open = (item = primary) => {
    if (item && item.state !== "running") {
      void window.electronAPI?.pet?.acknowledgeEvent(item.sessionKey, item.runId);
      setActivities((current) => {
        const { [item.sessionKey]: _opened, ...remaining } = current;
        return remaining;
      });
    }
    void window.electronAPI?.pet?.openMainWindow(desktopPetWindowTarget(item));
  };
  const toggle = async () => {
    if (Object.keys(dismissals).length > 0) {
      setDismissals({});
      if (!state.prefs.collapsed) return;
    }
    const next = await window.electronAPI?.pet?.setPrefs({ collapsed: !state.prefs.collapsed });
    if (next) setState(next);
  };
  const beginDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => { if (event.button !== 0) return; dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); void window.electronAPI?.pet?.startDrag({ screenX: event.screenX, screenY: event.screenY }); }, []);
  const moveDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => { const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return; if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 4) { drag.moved = true; setInteractionAction("pickedUp"); void window.electronAPI?.pet?.drag({ screenX: event.screenX, screenY: event.screenY }); } }, []);
  const endDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    void window.electronAPI?.pet?.endDrag();
    if (drag.moved) {
      setInteractionAction("released");
      window.setTimeout(() => setInteractionAction(null), 700);
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
  }, []);
  const handlePetClick = () => {
    if (suppressClickRef.current) return;
    if (primary || !state.prefs.interactionEnabled) {
      open();
      return;
    }
    setInteractionAction("pet");
    setQuickTaskOpen((current) => !current);
    window.setTimeout(() => setInteractionAction(null), 650);
  };
  const submitQuickTask = async (event: FormEvent) => {
    event.preventDefault();
    const message = quickTaskDraft.trim();
    if (!message || quickTaskStatus === "starting" || quickTaskStatus === "running") return;
    setQuickTaskStatus("starting");
    setQuickTaskError(null);
    setQuickTaskClarify(null);
    setInteractionAction("prepare");
    let createdSessionKey = "";
    try {
      await runDesktopPetQuickTask(message, {
        onSession: (sessionKey) => { createdSessionKey = sessionKey; setQuickTaskSessionKey(sessionKey); },
        onStarted: () => { setQuickTaskStatus("running"); setInteractionAction("create"); },
        onTool: () => setInteractionAction("execute"),
        onClarify: (prompt) => { setQuickTaskClarify(prompt); setQuickTaskStatus("waiting"); setInteractionAction("wait"); },
        onCompleted: () => { setQuickTaskStatus("success"); setInteractionAction("success"); if (createdSessionKey) void window.electronAPI?.pet?.recordCompletion(`quick:${createdSessionKey}`); },
        onError: (messageText) => { setQuickTaskError(messageText); setQuickTaskStatus("error"); setInteractionAction("concern"); },
      });
      setQuickTaskDraft("");
    } catch (error) {
      setQuickTaskError(error instanceof Error ? error.message : String(error));
      setQuickTaskStatus("error");
      setInteractionAction("concern");
    }
  };
  const answerClarify = async (answer: string) => {
    if (!quickTaskClarify) return;
    setQuickTaskStatus("running");
    setInteractionAction("create");
    try {
      await answerDesktopPetClarify(quickTaskClarify.requestId, answer);
      setQuickTaskClarify(null);
    } catch (error) {
      setQuickTaskError(error instanceof Error ? error.message : String(error));
      setQuickTaskStatus("error");
      setInteractionAction("concern");
    }
  };
  const openQuickTaskSession = () => {
    if (quickTaskSessionKey) void window.electronAPI?.pet?.openMainWindow(desktopPetWindowTarget({ sessionKey: quickTaskSessionKey }));
  };

  if (!selectedPet) return null;
  const style = { "--desktop-pet-stage-size": `${Math.round(132 * sizeScale)}px`, "--desktop-pet-menu-size": `${Math.round(28 * sizeScale)}px`, "--desktop-pet-menu-left": "0px", "--desktop-pet-menu-bottom": `${Math.round(12 * sizeScale)}px` } as CSSProperties;
  const menuCount = state.prefs.collapsed ? queued.length : hiddenQueueCount;
  return <div ref={rootRef} className="desktop-pet-window" style={style}>
    {quickTaskOpen && !state.prefs.collapsed ? <div ref={quickTaskRef} className="desktop-pet-bubble desktop-pet-quick-task">
      <form onSubmit={(event) => void submitQuickTask(event)}>
        <div className="desktop-pet-quick-task-header"><span><strong>{t.quickTaskTitle}</strong><small>{t.relationshipSummary.replace("{{days}}", String(daysTogether)).replace("{{tasks}}", String(state.relationship.completedTaskCount))}</small></span><button type="button" aria-label={t.closeQuickTask} onClick={() => setQuickTaskOpen(false)}><X size={12} /></button></div>
        {quickTaskStatus === "idle" || quickTaskStatus === "error" ? <div className="desktop-pet-quick-task-composer"><input autoFocus value={quickTaskDraft} maxLength={800} placeholder={t.quickTaskPlaceholder} onChange={(event) => setQuickTaskDraft(event.target.value)} /><button type="submit" disabled={!quickTaskDraft.trim()} aria-label={t.sendQuickTask}><Send size={14} /></button></div> : null}
        {quickTaskStatus === "starting" || quickTaskStatus === "running" ? <p>{t.quickTaskWorking}</p> : null}
        {quickTaskStatus === "waiting" && quickTaskClarify ? <div className="desktop-pet-quick-task-clarify"><p>{quickTaskClarify.question}</p>{quickTaskClarify.choices?.length ? <div>{quickTaskClarify.choices.slice(0, 3).map((choice) => <button type="button" key={choice} onClick={() => void answerClarify(choice)}>{choice}</button>)}</div> : <button type="button" onClick={openQuickTaskSession}>{t.answerInApp}</button>}</div> : null}
        {quickTaskStatus === "success" ? <p>{t.quickTaskDone}</p> : null}
        {quickTaskError ? <p className="desktop-pet-quick-task-error">{quickTaskError}</p> : null}
        {quickTaskSessionKey ? <button type="button" className="desktop-pet-quick-task-open" onClick={openQuickTaskSession}>{t.viewSession}<ExternalLink size={12} /></button> : null}
      </form>
    </div> : null}
    {!quickTaskOpen && !state.prefs.collapsed && queued.length > 0 ? <div ref={queueRef} className="desktop-pet-bubble desktop-pet-queue">{queued.map((item) => {
      const health = activityHealthText(item, now, { longRunning: t.tipLongRunning, stale: t.tipStaleSignal });
      const completion = activityCompletionText(item, t.tipCompleteSummary);
      const reassurance = activityReassuranceText(item, {
        making_progress: t.petReassuranceMakingProgress,
        waiting_safely: t.petReassuranceWaitingSafely,
        completed: t.petReassuranceCompleted,
        work_preserved: t.petReassuranceWorkPreserved,
        details_available: t.petReassuranceDetailsAvailable,
      });
      const fact = completion ?? health ?? reassurance ?? item.action;
      const displayText = joinReaction(
        petReactionText(selectedPet, item, personaPhrases),
        fact,
        Boolean(completion || health || reassurance),
      );
      const cta = activityCtaText(item, { open: t.viewSession, needsInput: t.petCtaNeedsInput, reviewIssue: t.petCtaReviewIssue });
      return <div key={item.sessionKey} className={`desktop-pet-session desktop-pet-session--${item.state}${health ? " desktop-pet-session--health" : ""}`}><button type="button" className="desktop-pet-session-open" onClick={() => open(item)}><span className="desktop-pet-session-dot" /><span className="desktop-pet-session-main"><strong>{item.sessionLabel}</strong><span>{displayText}{completion || health ? "" : activityDetailText(item, now, t.tipTargetSuffix)}</span></span>{cta ? <span className="desktop-pet-session-cta">{cta}</span> : null}</button><button type="button" className="desktop-pet-session-close" aria-label={t.dismissSession} onClick={() => { void window.electronAPI?.pet?.acknowledgeEvent(item.sessionKey, item.runId); setDismissals((current) => ({ ...current, [item.sessionKey]: { runId: item.runId, state: item.state } })); }}><X size={12} /></button></div>;
    })}</div> : null}
    {!quickTaskOpen && idleTipVisible ? <div ref={queueRef} className="desktop-pet-bubble desktop-pet-queue desktop-pet-idle-tip"><div className="desktop-pet-session desktop-pet-session--idle"><button type="button" className="desktop-pet-session-open" onClick={() => open()}><span className="desktop-pet-session-dot" /><span className="desktop-pet-session-main"><strong>{t.idleTipTitle}</strong><span>{stablePhrase(selectedPet.persona?.phrases?.greeting ?? personaPhrases.greeting, { sessionKey: "idle", runId: "idle", sessionLabel: "", sequence: 0, timestamp: lastActivityAt, state: "running", phase: "waiting", action: t.idleTipBody }) ?? t.idleTipBody}</span></span></button><button type="button" className="desktop-pet-session-close" aria-label={t.dismissSession} onClick={() => setIdleDismissedUntil(now + IDLE_COMPANION_COOLDOWN_MS)}><X size={12} /></button></div></div> : null}
    <div ref={stageRef} className="desktop-pet-stage"><button type="button" className="desktop-pet-menu-button" onClick={() => void toggle()} aria-label={t.menu}>{menuCount > 0 ? <span className="desktop-pet-tip-count">{Math.min(99, menuCount)}</span> : <ChevronDown className="desktop-pet-menu-chevron size-4" />}</button><button type="button" className="desktop-pet-hit-area" onClick={handlePetClick} onPointerEnter={() => { if (!primary && state.prefs.interactionEnabled && state.prefs.behaviorMode === "playful") setInteractionAction("greet"); }} onPointerLeave={() => { if (!dragRef.current && quickTaskStatus === "idle") setInteractionAction(null); }} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} title={state.prefs.interactionEnabled ? t.quickTaskTitle : t.openApp}><DesktopPetSprite pet={selectedPet} action={action} reducedMotion={state.prefs.reducedMotion} displayHeight={Math.round(112 * sizeScale)} /></button></div>
  </div>;
}
