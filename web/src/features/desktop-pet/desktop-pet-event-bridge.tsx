import { useEffect, useRef } from "react";

import { activityForProgress, activityForTool } from "@/features/desktop-pet/desktop-pet-activity";
import { getFriendlyToolTitle } from "@/features/chat/messages/tool-friendly-title";
import { isElectron } from "@/lib/electron-env";
import { apiFetch } from "@/lib/fetch";
import { apiUrl } from "@/lib/url";
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

const toolLabels = { searchedWeb: "搜索网页", readFile: "读取文件", runCommand: "运行命令", updatePlan: "更新计划", listDirectory: "查看目录", writeFile: "写入文件", editFile: "修改文件", openUrl: "打开链接", fetchUrl: "获取网页", unknownTool: "使用 {{name}}" };

export function mapAgentStreamEvent(detail: AgentStreamDetail, sequence: number, sessionLabel: string): PetSessionUpdate | null {
  if (!detail.sessionKey) return null;
  const event = record(detail.event);
  const payload = record(event.payload);
  const type = text(event.type);
  if (!type) return null;
  const runId = text(event.runId) ?? "active";
  const base = { sessionKey: detail.sessionKey, runId, sessionLabel, sequence, timestamp: Date.now() };
  if (type === "run_start") return { ...base, state: "running", phase: "preparing", action: "正在准备工作" };
  if (type === "tool_start" || type === "tool_update") {
    const toolName = text(event.toolName) ?? text(payload.toolName) ?? "tool";
    const activity = activityForTool(toolName, payload.args);
    return { ...base, state: "running", phase: activity.phase ?? "running", action: `正在${getFriendlyToolTitle(toolName, toolLabels)}`, detail: activity.detail };
  }
  if (type === "progress" || type === "compaction") {
    const activity = type === "compaction" ? { phase: "compacting" as const } : activityForProgress(payload);
    return { ...base, state: "running", phase: activity.phase ?? "preparing", action: activity.phase === "running" ? "正在验证" : "任务仍在推进", progress: typeof activity.completed === "number" && typeof activity.total === "number" ? { completed: activity.completed, total: activity.total } : undefined };
  }
  if (type === "clarify_request") return { ...base, state: "waiting", phase: "waiting", action: "等待你的确认", outputTail: safeTail(payload.question) };
  if (type === "assistant_delta" || type === "command_output_delta") return { ...base, state: "running", phase: "running", action: "正在处理", outputTail: safeTail(payload.delta ?? event.delta) };
  if (type === "assistant_message_end") return { ...base, state: "running", phase: "running", action: "正在整理结果", outputLines: safeLines(payload.content ?? event.content) };
  if (type === "run_end") return { ...base, state: "success", phase: "running", action: "已完成" };
  if (type === "error") return { ...base, state: "error", phase: "waiting", action: "需要处理", outputTail: safeTail(payload.message ?? event.message) };
  return null;
}

export function DesktopPetEventBridge() {
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
      const sessionLabel = (await titleFor(detail.sessionKey)) ?? "新对话";
      const next = (sequenceRef.current.get(detail.sessionKey ?? "") ?? 0) + 1;
      const update = mapAgentStreamEvent(detail, next, sessionLabel);
      if (!update) return;
      sequenceRef.current.set(update.sessionKey, next);
      pendingRef.current.set(update.sessionKey, update);
      if (update.state === "error" || update.state === "waiting" || update.state === "success") flush();
      else if (timerRef.current === null) timerRef.current = window.setTimeout(flush, 500);
    };
    window.addEventListener("agent-stream-event", onStream);
    return () => { window.removeEventListener("agent-stream-event", onStream); if (timerRef.current !== null) window.clearTimeout(timerRef.current); };
  }, []);
  return null;
}
