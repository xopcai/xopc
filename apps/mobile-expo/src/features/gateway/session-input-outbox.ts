import { sessionInputFingerprint } from '@xopcai/gateway-contract';
import { randomUUID } from 'expo-crypto';

import type { WireAttachment } from '../chat/composer.types';
import { storage } from '../../storage/mmkv';
import { useGatewayStore } from '../../stores/gateway-store';
import { readCachedSessionDetail } from './session-detail-cache';
import { emitGatewayEvent } from './gateway-event-bus';

export type PendingSessionInput = {
  version: 2;
  gatewayId: string;
  sessionKey: string;
  expectedSessionId?: string;
  needsReview?: boolean;
  taskId?: string;
  clientMessageId: string;
  fingerprint: string;
  content: string;
  attachments: WireAttachment[];
  createdAt: number;
  attemptCount: number;
};
const MAX_OUTBOX_AGE_MS = 24 * 60 * 60_000;
const INDEX = 'session-input-outbox:v2:index';
export const OUTBOX_CHANGED = 'session-input-outbox-changed';
const host = () => useGatewayStore.getState().activeGatewayId ?? '';
const key = (session: string, gatewayId: string) => `session-input-outbox:v2:${encodeURIComponent(gatewayId)}:${encodeURIComponent(session)}`;
function index(): string[] {
  try { const value: unknown = JSON.parse(storage.getString(INDEX) ?? '[]'); return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []; }
  catch { return []; }
}
function save(entry: PendingSessionInput): PendingSessionInput {
  const id = key(entry.sessionKey, entry.gatewayId);
  storage.set(id, JSON.stringify(entry));
  storage.set(INDEX, JSON.stringify([...new Set([...index(), id])]));
  emitGatewayEvent(OUTBOX_CHANGED, { gatewayId: entry.gatewayId, sessionKey: entry.sessionKey });
  return entry;
}
export function readPendingSessionInput(sessionKey: string, gatewayId = host()): PendingSessionInput | null {
  try {
    const value = JSON.parse(storage.getString(key(sessionKey, gatewayId)) ?? 'null') as PendingSessionInput | null;
    if (!value || value.version !== 2 || value.gatewayId !== gatewayId || value.sessionKey !== sessionKey
      || typeof value.clientMessageId !== 'string' || typeof value.content !== 'string' || !Array.isArray(value.attachments)) return null;
    // Retain expired content for explicit review; never silently discard work.
    return Date.now() - value.createdAt > MAX_OUTBOX_AGE_MS ? { ...value, needsReview: true } : value;
  } catch { return null; }
}
export function enqueueSessionInput(sessionKey: string, content: string, attachments: WireAttachment[] = [], taskId?: string): PendingSessionInput {
  const gatewayId = host();
  if (!gatewayId) throw new Error('No work computer selected');
  const fingerprint = sessionInputFingerprint({ content, attachments });
  const existing = readPendingSessionInput(sessionKey, gatewayId);
  if (existing?.fingerprint === fingerprint) return existing;
  if (existing) throw new Error('A message is already waiting to be sent');
  const persistent = attachments.map(({ data: _data, ...attachment }) => {
    if (!attachment.uri && !attachment.localUri && !attachment.workspaceRelativePath) throw new Error('Attachment is unavailable');
    return attachment;
  });
  return save({ version: 2, gatewayId, sessionKey, expectedSessionId: readCachedSessionDetail(gatewayId, sessionKey)?.sessionId,
    ...(taskId?.trim() ? { taskId: taskId.trim() } : {}), clientMessageId: randomUUID(), fingerprint,
    content, attachments: persistent, createdAt: Date.now(), attemptCount: 0 });
}
export function markSessionInputAttempt(entry: PendingSessionInput): PendingSessionInput {
  const current = readPendingSessionInput(entry.sessionKey, entry.gatewayId);
  if (!current || current.clientMessageId !== entry.clientMessageId) return entry;
  return save({ ...current, attemptCount: current.attemptCount + 1 });
}
export function updatePendingSessionInput(entry: PendingSessionInput, patch: Partial<Pick<PendingSessionInput, 'attachments' | 'expectedSessionId' | 'needsReview' | 'createdAt'>>): PendingSessionInput {
  const current = readPendingSessionInput(entry.sessionKey, entry.gatewayId);
  return current?.clientMessageId === entry.clientMessageId ? save({ ...current, ...patch }) : entry;
}
export function completeSessionInput(sessionKey: string, clientMessageId: string, gatewayId = host()): void {
  const entry = readPendingSessionInput(sessionKey, gatewayId);
  if (entry?.clientMessageId !== clientMessageId) return;
  const id = key(sessionKey, gatewayId);
  storage.delete(id);
  storage.set(INDEX, JSON.stringify(index().filter(k => k !== id)));
  emitGatewayEvent(OUTBOX_CHANGED, { gatewayId, sessionKey });
}
export function listPendingSessionInputKeys(): string[] {
  return index().flatMap(id => {
    try {
      const entry = JSON.parse(storage.getString(id) ?? 'null') as PendingSessionInput | null;
      return entry?.gatewayId === host() && readPendingSessionInput(entry.sessionKey) ? [entry.sessionKey] : [];
    } catch { return []; }
  });
}
/** Legacy records have no reliable computer identity. They are recoverable drafts only. */
export function readLegacySessionInput(sessionKey: string): { content: string; attachments: WireAttachment[] } | null {
  try {
    const entry = JSON.parse(storage.getString(`session-input-outbox:${sessionKey}`) ?? 'null');
    return entry?.version === 1 && typeof entry.content === 'string' && Array.isArray(entry.attachments) ? entry : null;
  } catch { return null; }
}
