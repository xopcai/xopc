import {
  hasPendingAgentRunForChat,
  pendingAgentRunStorageKey,
  setPendingAgentRun,
} from '@/features/chat/messages/message-sender';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type SessionActiveRunPayload = {
  active: boolean;
  runId?: string;
};

/** Gateway source of truth for in-flight webchat runs (Phase 1). */
export async function fetchSessionActiveRun(sessionKey: string): Promise<SessionActiveRunPayload> {
  const key = String(sessionKey ?? '').trim();
  if (!key) return { active: false };
  const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/run`));
  if (!res.ok) return { active: false };
  const data = (await res.json()) as { payload?: SessionActiveRunPayload };
  const payload = data.payload;
  if (!payload?.active || typeof payload.runId !== 'string' || !payload.runId.trim()) {
    return { active: false };
  }
  return { active: true, runId: payload.runId.trim() };
}

/**
 * Resolve run id for SSE resume: gateway first, sessionStorage fallback.
 * Syncs sessionStorage when gateway reports an active run.
 */
export async function resolveResumeRunId(sessionKey: string): Promise<string | null> {
  const key = String(sessionKey ?? '').trim();
  if (!key) return null;

  try {
    const remote = await fetchSessionActiveRun(key);
    if (remote.active && remote.runId) {
      setPendingAgentRun(key, remote.runId);
      return remote.runId;
    }
  } catch {
    /* gateway may be starting */
  }

  if (!hasPendingAgentRunForChat(key)) return null;
  try {
    const raw = sessionStorage.getItem(pendingAgentRunStorageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { runId?: unknown };
    const runId = typeof parsed.runId === 'string' ? parsed.runId.trim() : '';
    return runId || null;
  } catch {
    return null;
  }
}
