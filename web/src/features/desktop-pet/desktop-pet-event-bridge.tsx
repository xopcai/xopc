import { useEffect, useRef } from "react";

import {
  type DesktopPetNarrativeLabels,
} from "@/features/desktop-pet/desktop-pet-narrative";
import {
  mapAgentStreamEvent,
  type AgentStreamDetail,
} from "@/features/desktop-pet/desktop-pet-event-mapper";
import { AGENT_STREAM_EVENT } from "@/features/gateway/agent-run-stream-event-bridge";
import { messages } from "@/i18n/messages";
import { isElectron } from "@/lib/electron-env";
import { apiFetch } from "@/lib/fetch";
import { apiUrl } from "@/lib/url";
import { useLocaleStore } from "@/stores/locale-store";
import type { PetSessionUpdate } from "@/types/electron";

function petNarrativeLabels(t: ReturnType<typeof messages>["desktopPet"]): DesktopPetNarrativeLabels {
  return {
    searchedWeb: t.toolActionSearch,
    searchedMemory: t.toolActionSearchMemory,
    searchedCode: t.toolActionSearchCode,
    searched: t.toolActionSearchGeneric,
    readFile: t.toolActionReadFile,
    runCommand: t.toolActionRunCommand,
    updatePlan: t.toolActionUpdatePlan,
    listDirectory: t.toolActionListDirectory,
    writeFile: t.toolActionWriteFile,
    editFile: t.toolActionEditFile,
    openUrl: t.toolActionOpenUrl,
    fetchUrl: t.toolActionFetchUrl,
    unknownTool: t.toolActionUnknownNamed,
    tipRunStart: t.tipRunStart,
    tipTool: t.tipTool,
    tipProgress: t.tipProgress,
    tipValidate: t.tipValidate,
    tipWaiting: t.tipWaiting,
    tipThinking: t.tipThinking,
    tipAssistantDelta: t.tipAssistantDelta,
    tipCommandDelta: t.tipCommandDelta,
    tipAssistantNarrationDone: t.tipAssistantNarrationDone,
    tipAssistantAnswerDone: t.tipAssistantAnswerDone,
    tipReview: t.tipReview,
    tipComplete: t.tipComplete,
    tipError: t.tipError,
    targetSuffix: t.tipTargetSuffix,
    progressSuffix: t.tipProgressSuffix,
  };
}

export function DesktopPetEventBridge() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).desktopPet;
  const sequenceRef = useRef(new Map<string, number>());
  const titleRef = useRef(new Map<string, string>());
  const titleLoadingRef = useRef(new Set<string>());
  const pendingRef = useRef(new Map<string, PetSessionUpdate>());
  const lastSentRef = useRef(new Map<string, PetSessionUpdate>());
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    const pet = window.electronAPI?.pet;
    if (!isElectron() || !pet) return;
    const send = (update: PetSessionUpdate) => {
      lastSentRef.current.set(update.sessionKey, update);
      void pet.sendEvent(update).catch(() => {});
    };
    const flush = () => {
      timerRef.current = null;
      for (const update of pendingRef.current.values()) send(update);
      pendingRef.current.clear();
    };
    const titleFor = (sessionKey: string) => {
      const cached = titleRef.current.get(sessionKey);
      if (!cached && !titleLoadingRef.current.has(sessionKey)) {
        titleLoadingRef.current.add(sessionKey);
        void apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}?offset=0&limit=1`))
          .then(async (response) => response.ok ? (await response.json() as { session?: { name?: string } }).session?.name?.trim() : undefined)
          .then((title) => {
            if (title) titleRef.current.set(sessionKey, title);
          })
          .catch(() => undefined)
          .finally(() => titleLoadingRef.current.delete(sessionKey));
      }
      return cached ?? t.fallbackSessionLabel;
    };
    const onStream = (event: Event) => {
      const detail = (event as CustomEvent<AgentStreamDetail>).detail;
      if (!detail.sessionKey) return;
      const sessionLabel = titleFor(detail.sessionKey);
      const next = (sequenceRef.current.get(detail.sessionKey ?? "") ?? 0) + 1;
      const update = mapAgentStreamEvent(detail, next, sessionLabel, petNarrativeLabels(t));
      if (!update) return;
      sequenceRef.current.set(update.sessionKey, next);
      const baseline = pendingRef.current.get(update.sessionKey) ?? lastSentRef.current.get(update.sessionKey);
      const terminal = update.state === "error" || update.state === "waiting" || update.state === "success";
      const animationChanged = !baseline
        || baseline.runId !== update.runId
        || baseline.state !== update.state
        || baseline.phase !== update.phase
        || baseline.animation !== update.animation
        || baseline.action !== update.action;
      if (terminal || animationChanged) {
        pendingRef.current.delete(update.sessionKey);
        send(update);
        return;
      }
      pendingRef.current.set(update.sessionKey, update);
      if (timerRef.current === null) timerRef.current = window.setTimeout(flush, 500);
    };
    window.addEventListener(AGENT_STREAM_EVENT, onStream);
    return () => {
      window.removeEventListener(AGENT_STREAM_EVENT, onStream);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingRef.current.clear();
    };
  }, [t]);
  return null;
}
