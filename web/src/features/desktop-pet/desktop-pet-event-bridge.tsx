import { useEffect, useRef } from "react";

import { activityForProgress, activityForTool } from "@/features/desktop-pet/desktop-pet-activity";
import {
  progressNarrative,
  toolNarrative,
  type DesktopPetNarrativeLabels,
} from "@/features/desktop-pet/desktop-pet-narrative";
import { messages } from "@/i18n/messages";
import { isElectron } from "@/lib/electron-env";
import { apiFetch } from "@/lib/fetch";
import { apiUrl } from "@/lib/url";
import { useLocaleStore } from "@/stores/locale-store";
import type { PetSessionUpdate } from "@/types/electron";

type AgentStreamDetail = { sessionKey?: string; event?: unknown };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeTail(value: unknown): string | undefined {
  const tail = text(value)?.split(/\r?\n/).at(-1)?.replace(/(?:token|authorization|api[_-]?key)\s*[:=].*/i, "[redacted]").trim();
  return tail ? tail.slice(0, 96) : undefined;
}

function safeLines(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const lines = value.split(/\r?\n/).map((line) => safeTail(line)).filter((line): line is string => Boolean(line));
  return lines.length ? lines.slice(0, 12) : undefined;
}

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

export function mapAgentStreamEvent(
  detail: AgentStreamDetail,
  sequence: number,
  sessionLabel: string,
  labels: DesktopPetNarrativeLabels,
): PetSessionUpdate | null {
  if (!detail.sessionKey) return null;
  const event = record(detail.event);
  const payload = record(event.payload);
  const type = text(event.type);
  if (!type) return null;
  const runId = text(event.runId) ?? "active";
  const base = { sessionKey: detail.sessionKey, runId, sessionLabel, sequence, timestamp: Date.now() };
  if (type === "run_start") return { ...base, state: "running", phase: "preparing", action: labels.tipRunStart, animation: "toolbox", priority: "low" };
  if (type === "tool_start" || type === "tool_update") {
    const toolName = text(event.toolName) ?? text(payload.toolName) ?? "tool";
    const activity = activityForTool(toolName, payload.args);
    const phase = activity.phase ?? "running";
    const narrative = toolNarrative(labels, toolName, phase, activity.detail);
    return { ...base, state: "running", phase, ...narrative, detail: activity.detail };
  }
  if (type === "progress" || type === "compaction") {
    const activity = type === "compaction" ? { phase: "compacting" as const } : activityForProgress(payload);
    const phase = activity.phase ?? "preparing";
    const narrative = progressNarrative(labels, phase, activity.completed, activity.total);
    return { ...base, state: "running", phase, ...narrative, progress: typeof activity.completed === "number" && typeof activity.total === "number" ? { completed: activity.completed, total: activity.total } : undefined };
  }
  if (type === "clarify_request") return { ...base, state: "waiting", phase: "waiting", action: labels.tipWaiting, animation: "typing", priority: "high", outputTail: safeTail(payload.question) };
  if (type === "assistant_delta") return { ...base, state: "running", phase: "running", action: labels.tipAssistantDelta, animation: "typing", priority: "low", outputTail: safeTail(payload.delta ?? event.delta) };
  if (type === "command_output_delta") return { ...base, state: "running", phase: "running", action: labels.tipCommandDelta, animation: "terminal", priority: "low", outputTail: safeTail(payload.delta ?? event.delta) };
  if (type === "assistant_message_end") return { ...base, state: "running", phase: "running", action: labels.tipAssistantDone, animation: "typing", priority: "normal", outputLines: safeLines(payload.content ?? event.content) };
  if (type === "run_end") return { ...base, state: "success", phase: "running", action: labels.tipComplete, animation: "success", priority: "high" };
  if (type === "error") return { ...base, state: "error", phase: "waiting", action: labels.tipError, animation: "error", priority: "high", outputTail: safeTail(payload.message ?? event.message) };
  return null;
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
