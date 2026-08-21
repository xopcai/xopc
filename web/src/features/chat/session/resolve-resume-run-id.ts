import {
  buildSessionRunPath,
  normalizeSessionActiveRunResponse,
  type SessionActiveRunPayload,
} from '@xopcai/gateway-contract';

import {
  hasPendingAgentRunForChat,
  pendingAgentRunStorageKey,
  setPendingAgentRun,
} from '@/features/chat/messages/message-sender';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

/** Gateway source of truth for in-flight webchat runs (Phase 1). */
export async function fetchSessionActiveRun(sessionKey: string): Promise<SessionActiveRunPayload> {
  const key = String(sessionKey ?? '').trim();
  if (!key) return { active: false };
  const res = await apiFetch(apiUrl(buildSessionRunPath(key)));
  if (!res.ok) return { active: false };
  try {
    return normalizeSessionActiveRunResponse(await res.json());
  } catch {
    return { active: false };
  }
}

/**
 * Resolve run id for realtime resume: gateway first, sessionStorage fallback.
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
