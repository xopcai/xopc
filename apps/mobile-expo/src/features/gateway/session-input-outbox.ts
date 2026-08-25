import { sessionInputFingerprint } from '@xopcai/gateway-contract';
import { randomUUID } from 'expo-crypto';

import type { WireAttachment } from '../chat/composer.types';

import { storage } from '../../storage/mmkv';

export type PendingSessionInput = {
  version: 1;
  sessionKey: string;
  taskId?: string;
  clientMessageId: string;
  fingerprint: string;
  content: string;
  attachments: WireAttachment[];
  createdAt: number;
  attemptCount: number;
};

const MAX_OUTBOX_AGE_MS = 24 * 60 * 60_000;
const OUTBOX_INDEX_KEY = 'session-input-outbox:index';

function key(sessionKey: string): string {
  return `session-input-outbox:${sessionKey}`;
}

function readIndex(): string[] {
  try {
    const value = JSON.parse(storage.getString(OUTBOX_INDEX_KEY) ?? '[]') as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
  } catch {
    return [];
  }
}

function updateIndex(sessionKey: string, present: boolean): void {
  const keys = new Set(readIndex());
  if (present) keys.add(sessionKey);
  else keys.delete(sessionKey);
  if (keys.size > 0) storage.set(OUTBOX_INDEX_KEY, JSON.stringify([...keys]));
  else storage.delete(OUTBOX_INDEX_KEY);
}

function persistentAttachment(attachment: WireAttachment): WireAttachment {
  const persisted: WireAttachment = {
    type: attachment.type,
    mimeType: attachment.mimeType,
    uri: attachment.uri,
    localUri: attachment.localUri,
    name: attachment.name,
    size: attachment.size,
    workspaceRelativePath: attachment.workspaceRelativePath,
    durationSeconds: attachment.durationSeconds,
  };
  if (!persisted.uri && !persisted.localUri && !persisted.workspaceRelativePath) {
    throw new Error(`Attachment is not available for reliable delivery: ${attachment.name ?? 'unnamed'}`);
  }
  return persisted;
}

export function readPendingSessionInput(sessionKey: string): PendingSessionInput | null {
  try {
    const raw = storage.getString(key(sessionKey));
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<PendingSessionInput>;
    if (
      entry.version !== 1 ||
      entry.sessionKey !== sessionKey ||
      typeof entry.clientMessageId !== 'string' ||
      typeof entry.fingerprint !== 'string' ||
      typeof entry.content !== 'string' ||
      !Array.isArray(entry.attachments) ||
      typeof entry.createdAt !== 'number' ||
      typeof entry.attemptCount !== 'number'
    ) {
      storage.delete(key(sessionKey));
      updateIndex(sessionKey, false);
      return null;
    }
    if (Date.now() - entry.createdAt > MAX_OUTBOX_AGE_MS) {
      storage.delete(key(sessionKey));
      updateIndex(sessionKey, false);
      return null;
    }
    updateIndex(sessionKey, true);
    return entry as PendingSessionInput;
  } catch {
    storage.delete(key(sessionKey));
    updateIndex(sessionKey, false);
    return null;
  }
}

export function enqueueSessionInput(
  sessionKey: string,
  content: string,
  attachments: WireAttachment[] = [],
  taskId?: string,
): PendingSessionInput {
  const persistedAttachments = attachments.map(persistentAttachment);
  const fingerprint = sessionInputFingerprint({ content, attachments: persistedAttachments });
  const existing = readPendingSessionInput(sessionKey);
  if (existing?.fingerprint === fingerprint) return existing;
  if (existing) throw new Error('A message is already waiting to be sent');

  const entry: PendingSessionInput = {
    version: 1,
    sessionKey,
    ...(taskId?.trim() ? { taskId: taskId.trim() } : {}),
    clientMessageId: randomUUID(),
    fingerprint,
    content,
    attachments: persistedAttachments,
    createdAt: Date.now(),
    attemptCount: 0,
  };
  storage.set(key(sessionKey), JSON.stringify(entry));
  updateIndex(sessionKey, true);
  return entry;
}

export function markSessionInputAttempt(entry: PendingSessionInput): PendingSessionInput {
  const current = readPendingSessionInput(entry.sessionKey);
  if (!current || current.clientMessageId !== entry.clientMessageId) return entry;
  const updated = { ...current, attemptCount: current.attemptCount + 1 };
  storage.set(key(entry.sessionKey), JSON.stringify(updated));
  return updated;
}

export function completeSessionInput(sessionKey: string, clientMessageId: string): void {
  const entry = readPendingSessionInput(sessionKey);
  if (entry?.clientMessageId === clientMessageId) {
    storage.delete(key(sessionKey));
    updateIndex(sessionKey, false);
  }
}

export function listPendingSessionInputKeys(): string[] {
  return readIndex().filter((sessionKey) => readPendingSessionInput(sessionKey) !== null);
}
