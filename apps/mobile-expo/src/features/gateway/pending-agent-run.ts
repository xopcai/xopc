import { pendingRunStorageKey, storage } from '../../storage/mmkv';

import { emitGatewayEvent, subscribeGatewayEvent } from './gateway-event-bus';

export const PENDING_AGENT_RUN_CHANGED = 'pending-agent-run-changed';
type PendingAgentRun = { runId?: unknown; lastSeq?: unknown };

export function setPendingAgentRun(conversationId: string, runId: string): void {
  const id = runId.trim();
  if (!id || !conversationId) return;
  const key = pendingRunStorageKey(conversationId);
  let lastSeq = 0;
  try {
    const previous = JSON.parse(storage.getString(key) ?? '{}') as PendingAgentRun;
    if (previous.runId === id && typeof previous.lastSeq === 'number') lastSeq = previous.lastSeq;
  } catch {
    /* replace an unreadable entry */
  }
  storage.set(key, JSON.stringify({ runId: id, lastSeq }));
  emitGatewayEvent(PENDING_AGENT_RUN_CHANGED, { conversationId });
}

export function clearPendingAgentRun(conversationId: string): void {
  if (!conversationId) return;
  try {
    storage.delete(pendingRunStorageKey(conversationId));
    emitGatewayEvent(PENDING_AGENT_RUN_CHANGED, { conversationId });
  } catch {
    /* ignore */
  }
}

export function hasPendingAgentRunForSession(conversationId: string): boolean {
  try {
    const raw = storage.getString(pendingRunStorageKey(conversationId));
    if (!raw) return false;
    const pr = JSON.parse(raw) as PendingAgentRun;
    return typeof pr.runId === 'string' && pr.runId.trim().length > 0;
  } catch {
    return false;
  }
}

export function readPendingAgentRunId(conversationId: string): string | null {
  try {
    const raw = storage.getString(pendingRunStorageKey(conversationId));
    if (!raw) return null;
    const pr = JSON.parse(raw) as PendingAgentRun;
    return typeof pr.runId === 'string' && pr.runId.trim() ? pr.runId.trim() : null;
  } catch {
    return null;
  }
}

export function readPendingAgentRunCursor(conversationId: string, runId: string): number {
  try {
    const raw = storage.getString(pendingRunStorageKey(conversationId));
    if (!raw) return 0;
    const pending = JSON.parse(raw) as PendingAgentRun;
    return pending.runId === runId && typeof pending.lastSeq === 'number' ? pending.lastSeq : 0;
  } catch {
    return 0;
  }
}

export function advancePendingAgentRunCursor(conversationId: string, runId: string, seq: number): void {
  if (!Number.isInteger(seq) || seq < 1) return;
  try {
    const key = pendingRunStorageKey(conversationId);
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

/** The cursor must describe the current UI projection, including a partial rebuild. */
export function resetPendingAgentRunCursor(conversationId: string, runId: string): void {
  try {
    const key = pendingRunStorageKey(conversationId);
    const pending = JSON.parse(storage.getString(key) ?? '{}') as PendingAgentRun;
    if (pending.runId === runId) storage.set(key, JSON.stringify({ runId, lastSeq: 0 }));
  } catch {
    /* An unreadable entry falls back to a full replay. */
  }
}

export function subscribePendingAgentRunChanged(
  listener: (detail: { conversationId?: string }) => void,
): () => void {
  return subscribeGatewayEvent(PENDING_AGENT_RUN_CHANGED, (detail) => {
    listener(detail as { conversationId?: string });
  });
}
