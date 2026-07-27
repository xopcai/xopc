import { useEffect, useRef } from "react";

import {
  type DesktopPetNarrativeLabels,
} from "@/features/desktop-pet/desktop-pet-narrative";
import {
  mapAgentStreamEvent,
  type AgentStreamDetail,
} from "@/features/desktop-pet/desktop-pet-event-mapper";
import { messages } from "@/i18n/messages";
import { isElectron } from "@/lib/electron-env";
import { apiFetch } from "@/lib/fetch";
import { apiUrl } from "@/lib/url";
import { useLocaleStore } from "@/stores/locale-store";
import type { PetSessionUpdate } from "@/types/electron";

function petNarrativeLabels(t: ReturnType<typeof messages>["desktopPet"]): DesktopPetNarrativeLabels {
  return {
    searchedWeb: t.toolActionSearch,
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
    tipAssistantDelta: t.tipAssistantDelta,
    tipCommandDelta: t.tipCommandDelta,
    tipAssistantDone: t.tipAssistantDone,
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
  const titleRef = useRef(new Map<string, Promise<string | undefined>>());
  const pendingRef = useRef(new Map<string, PetSessionUpdate>());
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    const pet = window.electronAPI?.pet;
    if (!isElectron() || !pet) return;
    const flush = () => {
      timerRef.current = null;
      for (const update of pendingRef.current.values()) void pet.sendEvent(update);
      pendingRef.current.clear();
    };
    const titleFor = (sessionKey: string) => {
      const cached = titleRef.current.get(sessionKey);
      if (cached) return cached;
      const pending = apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}?offset=0&limit=1`))
        .then(async (response) => response.ok ? (await response.json() as { session?: { name?: string } }).session?.name?.trim() : undefined)
        .catch(() => undefined);
      void pending.then((title) => {
        if (title) titleRef.current.set(sessionKey, Promise.resolve(title));
      });
      return pending;
    };
    const onStream = async (event: Event) => {
      const detail = (event as CustomEvent<AgentStreamDetail>).detail;
      if (!detail.sessionKey) return;
      const sessionLabel = (await titleFor(detail.sessionKey)) ?? t.fallbackSessionLabel;
      const next = (sequenceRef.current.get(detail.sessionKey ?? "") ?? 0) + 1;
      const update = mapAgentStreamEvent(detail, next, sessionLabel, petNarrativeLabels(t));
      if (!update) return;
      sequenceRef.current.set(update.sessionKey, next);
      pendingRef.current.set(update.sessionKey, update);
      if (update.state === "error" || update.state === "waiting" || update.state === "success") flush();
      else if (timerRef.current === null) timerRef.current = window.setTimeout(flush, 500);
    };
    window.addEventListener("agent-stream-event", onStream);
    return () => { window.removeEventListener("agent-stream-event", onStream); if (timerRef.current !== null) window.clearTimeout(timerRef.current); };
  }, [t]);
  return null;
}
