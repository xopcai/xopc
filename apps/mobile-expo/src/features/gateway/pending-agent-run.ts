import { pendingRunStorageKey, storage } from '../../storage/mmkv';

import { emitGatewayEvent, subscribeGatewayEvent } from './gateway-event-bus';

export const PENDING_AGENT_RUN_CHANGED = 'pending-agent-run-changed';
type PendingAgentRun = { runId?: unknown; lastSeq?: unknown };

export function setPendingAgentRun(sessionKey: string, runId: string): void {
  const id = runId.trim();
  if (!id || !sessionKey) return;
  const key = pendingRunStorageKey(sessionKey);
  let lastSeq = 0;
  try {
    const previous = JSON.parse(storage.getString(key) ?? '{}') as PendingAgentRun;
    if (previous.runId === id && typeof previous.lastSeq === 'number') lastSeq = previous.lastSeq;
  } catch {
    /* replace an unreadable entry */
  }
  storage.set(key, JSON.stringify({ runId: id, lastSeq }));
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
    const pr = JSON.parse(raw) as PendingAgentRun;
    return typeof pr.runId === 'string' && pr.runId.trim().length > 0;
  } catch {
    return false;
  }
}

export function readPendingAgentRunId(sessionKey: string): string | null {
  try {
    const raw = storage.getString(pendingRunStorageKey(sessionKey));
    if (!raw) return null;
    const pr = JSON.parse(raw) as PendingAgentRun;
    return typeof pr.runId === 'string' && pr.runId.trim() ? pr.runId.trim() : null;
  } catch {
    return null;
  }
}

export function readPendingAgentRunCursor(sessionKey: string, runId: string): number {
  try {
    const raw = storage.getString(pendingRunStorageKey(sessionKey));
    if (!raw) return 0;
    const pending = JSON.parse(raw) as PendingAgentRun;
    return pending.runId === runId && typeof pending.lastSeq === 'number' ? pending.lastSeq : 0;
  } catch {
    return 0;
  }
}

export function advancePendingAgentRunCursor(sessionKey: string, runId: string, seq: number): void {
  if (!Number.isInteger(seq) || seq < 1) return;
  try {
    const key = pendingRunStorageKey(sessionKey);
    const raw = storage.getString(key);
    if (!raw) return;
    const pending = JSON.parse(raw) as PendingAgentRun;
    if (pending.runId !== runId) return;
    const current = typeof pending.lastSeq === 'number' ? pending.lastSeq : 0;
    if (seq <= current) return;
    storage.set(key, JSON.stringify({ runId, lastSeq: seq }));
  } catch {
    /* ignore */
  }
}

export function subscribePendingAgentRunChanged(
  listener: (detail: { sessionKey?: string }) => void,
): () => void {
  return subscribeGatewayEvent(PENDING_AGENT_RUN_CHANGED, (detail) => {
    listener(detail as { sessionKey?: string });
  });
}
