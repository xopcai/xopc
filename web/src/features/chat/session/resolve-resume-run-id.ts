import {
  buildSessionRunPath,
  normalizeSessionActiveRunResponse,
  type SessionActiveRunPayload,
} from '@xopcai/gateway-contract';

import {
  clearPendingAgentRunIfMatches,
  readPendingAgentRunId,
  setPendingAgentRun,
} from '@/features/chat/messages/message-sender';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

/** Gateway source of truth for in-flight webchat runs (Phase 1). */
export async function fetchSessionActiveRun(sessionKey: string): Promise<SessionActiveRunPayload> {
  const key = String(sessionKey ?? '').trim();
  if (!key) return { active: false };
  const res = await apiFetch(apiUrl(buildSessionRunPath(key)));
  if (!res.ok) throw new Error(`Active run lookup failed (${res.status})`);
  return normalizeSessionActiveRunResponse(await res.json());
}

/**
 * Resolve run id for realtime resume: gateway first, sessionStorage fallback.
 * Syncs sessionStorage when gateway reports an active run.
 */
export async function resolveResumeRunId(sessionKey: string): Promise<string | null> {
  const key = String(sessionKey ?? '').trim();
  if (!key) return null;
  const fallbackAtStart = readPendingAgentRunId(key);

  try {
    const remote = await fetchSessionActiveRun(key);
    if (remote.active && remote.runId) {
      setPendingAgentRun(key, remote.runId);
      return remote.runId;
    }
    if (fallbackAtStart) clearPendingAgentRunIfMatches(key, fallbackAtStart);
    return null;
  } catch {
    /* gateway may be starting */
  }

  return readPendingAgentRunId(key);
}
