import { useGatewayStore } from '@/stores/gateway-store';
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
import { readLocalSessionDraft } from './local-session-drafts';

/** Gateway source of truth for in-flight webchat runs (Phase 1). */
export async function fetchSessionActiveRun(conversationId: string): Promise<SessionActiveRunPayload> {
  const key = String(conversationId ?? '').trim();
  if (!key) return { active: false };
  if (await readLocalSessionDraft(key)) return { active: false };
  const res = await apiFetch(apiUrl(buildSessionRunPath(key)));
  if (!res.ok) throw new Error(`Active run lookup failed (${res.status})`);
  return normalizeSessionActiveRunResponse(await res.json());
}

/**
 * Resolve run id for realtime resume: gateway first, sessionStorage fallback.
 * Syncs sessionStorage when gateway reports an active run.
 */
export async function resolveResumeRunId(conversationId: string): Promise<string | null> {
  const key = String(conversationId ?? '').trim();
  if (!key) return null;
  const gatewayAtStart = useGatewayStore.getState().conversationId;
  const fallbackAtStart = readPendingAgentRunId(key);

  try {
    const remote = await fetchSessionActiveRun(key);
    if (useGatewayStore.getState().conversationId !== gatewayAtStart) return null;
    const pendingNow = readPendingAgentRunId(key);
    if (pendingNow && pendingNow !== fallbackAtStart) return pendingNow;
    if (remote.active && remote.runId) {
      setPendingAgentRun(key, remote.runId);
      return remote.runId;
    }
    if (fallbackAtStart) clearPendingAgentRunIfMatches(key, fallbackAtStart);
    return null;
  } catch {
    /* gateway may be starting */
  }

  return useGatewayStore.getState().conversationId === gatewayAtStart ? readPendingAgentRunId(key) : null;
}
