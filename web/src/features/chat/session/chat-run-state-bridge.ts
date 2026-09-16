import type { AgentStreamRunStatus } from '@xopcai/gateway-contract';

import {
  clearPendingAgentRunIfMatches,
  listPendingAgentRuns,
  readPendingAgentRunId,
  setPendingAgentRun,
} from '@/features/chat/messages/message-sender';
import { chatRunManager } from '@/features/chat/session/chat-run-manager';
import {
  clearChatRunPresence,
  markChatRunCompleted,
  markChatRunFailed,
  markChatRunRunning,
  markChatRunWaiting,
} from '@/features/chat/session/chat-run-presence-store';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

type SessionRun = { conversationId: string; runId: string };
type CompletedSessionRun = SessionRun & { status: AgentStreamRunStatus };

const RECONCILE_INTERVAL_MS = 4_000;

function parseSessionRun(value: unknown): SessionRun | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const conversationId = typeof row.conversationId === 'string' ? row.conversationId.trim() : '';
  const runId = typeof row.runId === 'string' ? row.runId.trim() : '';
  return conversationId && runId ? { conversationId, runId } : null;
}

function parseCompletedSessionRun(value: unknown): CompletedSessionRun | null {
  const run = parseSessionRun(value);
  if (!run || !value || typeof value !== 'object') return null;
  const status = (value as Record<string, unknown>).status;
  if (status !== 'success' && status !== 'error' && status !== 'cancelled' && status !== 'suspended') return null;
  return { ...run, status };
}

async function fetchActiveSessionRuns(): Promise<SessionRun[]> {
  const response = await apiFetch(apiUrl('/api/session-runs'));
  if (!response.ok) throw new Error(`Active session runs failed (${response.status})`);
  const body = await response.json() as { payload?: { runs?: unknown } };
  if (!Array.isArray(body.payload?.runs)) throw new Error('Active session runs response is invalid');
  return body.payload.runs.map(parseSessionRun).filter((run): run is SessionRun => Boolean(run));
}

function dispatchTranscriptRefresh(conversationId: string): void {
  window.dispatchEvent(new CustomEvent('session-transcript-updated', { detail: { key: conversationId } }));
}

/**
 * Makes the low-volume sessions topic and REST snapshot authoritative over
 * per-run streaming state. The periodic check runs only while pending runs
 * exist, so a lost terminal event always converges without a page refresh.
 */
export function startChatRunStateBridge(): () => void {
  let disposed = false;
  let timer: number | undefined;
  let reconcilePromise: Promise<void> | undefined;
  const terminalRuns = new Map<string, number>();

  const runKey = ({ conversationId, runId }: SessionRun) => `${conversationId}\u0000${runId}`;

  const recordStarted = ({ conversationId, runId }: SessionRun, dispatch = false) => {
    if (terminalRuns.has(runKey({ conversationId, runId }))) return;
    if (readPendingAgentRunId(conversationId) !== runId) setPendingAgentRun(conversationId, runId);
    chatRunManager.setResumeRunId(conversationId, runId);
    markChatRunRunning(conversationId);
    if (dispatch) {
      window.dispatchEvent(new CustomEvent('run-started', { detail: { conversationId, runId } }));
    }
  };

  const recordInactive = ({ conversationId, runId }: SessionRun) => {
    const handled = chatRunManager.reconcileInactive(conversationId, runId);
    const cleared = clearPendingAgentRunIfMatches(conversationId, runId);
    if (!handled && cleared) useChatSessionStore.getState().clearStreamingState(conversationId);
    if (handled || cleared) {
      clearChatRunPresence(conversationId);
      dispatchTranscriptRefresh(conversationId);
    }
  };

  const recordCompleted = ({ conversationId, runId, status }: CompletedSessionRun) => {
    terminalRuns.set(runKey({ conversationId, runId }), Date.now());
    const handled = chatRunManager.reconcileTerminal(conversationId, runId, status);
    const cleared = clearPendingAgentRunIfMatches(conversationId, runId);
    if (!handled && cleared) {
      useChatSessionStore.getState().clearStreamingState(conversationId);
      const visible = useChatSessionStore.getState().focusedConversationId === conversationId;
      if (status === 'error') markChatRunFailed(conversationId, !visible);
      else if (status === 'suspended') markChatRunWaiting(conversationId);
      else if (status === 'success') markChatRunCompleted(conversationId, !visible);
      else clearChatRunPresence(conversationId);
      dispatchTranscriptRefresh(conversationId);
    }
  };

  const schedule = () => {
    if (disposed || timer !== undefined || listPendingAgentRuns().length === 0) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      void reconcile();
    }, RECONCILE_INTERVAL_MS);
  };

  const reconcile = (): Promise<void> => {
    if (reconcilePromise) return reconcilePromise;
    const pendingAtStart = listPendingAgentRuns();
    reconcilePromise = fetchActiveSessionRuns()
      .then((activeRuns) => {
        if (disposed) return;
        const terminalCutoff = Date.now() - 10 * 60_000;
        for (const [key, completedAt] of terminalRuns) {
          if (completedAt < terminalCutoff) terminalRuns.delete(key);
        }
        const activeBySession = new Map(activeRuns.map((run) => [run.conversationId, run.runId]));
        const pendingAtStartBySession = new Map(
          pendingAtStart.map((run) => [run.conversationId, run.runId]),
        );
        for (const run of activeRuns) {
          const pendingNow = readPendingAgentRunId(run.conversationId);
          const pendingBefore = pendingAtStartBySession.get(run.conversationId);
          if (pendingNow && pendingNow !== pendingBefore && pendingNow !== run.runId) continue;
          recordStarted(run, true);
        }
        for (const pending of pendingAtStart) {
          if (activeBySession.get(pending.conversationId) !== pending.runId) recordInactive(pending);
        }
      })
      .catch(() => {
        /* Keep local state when the authoritative snapshot is unavailable. */
      })
      .finally(() => {
        reconcilePromise = undefined;
        schedule();
      });
    return reconcilePromise;
  };

  const onStarted = (event: Event) => {
    const run = parseSessionRun((event as CustomEvent<unknown>).detail);
    if (!run) return;
    recordStarted(run);
    schedule();
  };
  const onCompleted = (event: Event) => {
    const run = parseCompletedSessionRun((event as CustomEvent<unknown>).detail);
    if (run) recordCompleted(run);
  };
  const onConnected = () => void reconcile();

  window.addEventListener('run-started', onStarted);
  window.addEventListener('run-completed', onCompleted);
  window.addEventListener('agent-run-ended', onCompleted);
  window.addEventListener('gateway-realtime-connected', onConnected);
  void reconcile();

  return () => {
    disposed = true;
    if (timer !== undefined) window.clearTimeout(timer);
    window.removeEventListener('run-started', onStarted);
    window.removeEventListener('run-completed', onCompleted);
    window.removeEventListener('agent-run-ended', onCompleted);
    window.removeEventListener('gateway-realtime-connected', onConnected);
  };
}
