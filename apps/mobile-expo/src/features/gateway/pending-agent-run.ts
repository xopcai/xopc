import { pendingRunStorageKey, storage } from '../../storage/mmkv';

import { emitGatewayEvent, subscribeGatewayEvent } from './gateway-event-bus';

export const PENDING_AGENT_RUN_CHANGED = 'pending-agent-run-changed';

export function setPendingAgentRun(sessionKey: string, runId: string): void {
  const id = runId.trim();
  if (!id || !sessionKey) return;
  storage.set(pendingRunStorageKey(sessionKey), JSON.stringify({ runId: id }));
  emitGatewayEvent(PENDING_AGENT_RUN_CHANGED, { sessionKey });
}

export function clearPendingAgentRun(sessionKey: string): void {
  if (!sessionKey) return;
  try {
    storage.delete(pendingRunStorageKey(sessionKey));
    emitGatewayEvent(PENDING_AGENT_RUN_CHANGED, { sessionKey });
  } catch {
    /* ignore */
  }
}

export function hasPendingAgentRunForSession(sessionKey: string): boolean {
  try {
    const raw = storage.getString(pendingRunStorageKey(sessionKey));
    if (!raw) return false;
    const pr = JSON.parse(raw) as { runId?: unknown };
    return typeof pr.runId === 'string' && pr.runId.trim().length > 0;
  } catch {
    return false;
  }
}

export function readPendingAgentRunId(sessionKey: string): string | null {
  try {
    const raw = storage.getString(pendingRunStorageKey(sessionKey));
    if (!raw) return null;
    const pr = JSON.parse(raw) as { runId?: unknown };
    return typeof pr.runId === 'string' && pr.runId.trim() ? pr.runId.trim() : null;
  } catch {
    return null;
  }
}

export function subscribePendingAgentRunChanged(
  listener: (detail: { sessionKey?: string }) => void,
): () => void {
  return subscribeGatewayEvent(PENDING_AGENT_RUN_CHANGED, (detail) => {
    listener(detail as { sessionKey?: string });
  });
}
