import { storage } from '../../storage/mmkv';
import type { ComposerAttachment } from './composer.types';

const STORAGE_PREFIX = 'xopc.chat.notePrefill:v1:';
const TTL_MS = 5 * 60_000;

export type NoteChatPrefillSnapshot = {
  text: string;
  attachments: ComposerAttachment[];
  expiresAt: number;
  droppedCount?: number;
};

function storageKey(sessionKey: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(sessionKey.trim())}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseComposerAttachment(value: unknown): ComposerAttachment | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const type = value.type;
  const name = value.name;
  const mimeType = value.mimeType;
  const size = value.size;
  const content = value.content;
  if (typeof id !== 'string' || !id.trim()) return null;
  if (type !== 'image' && type !== 'document') return null;
  if (typeof name !== 'string' || !name.trim()) return null;
  if (typeof mimeType !== 'string' || !mimeType.trim()) return null;
  if (typeof size !== 'number' || !Number.isFinite(size)) return null;
  if (typeof content !== 'string') return null;

  const out: ComposerAttachment = {
    id: id.trim(),
    type,
    name: name.trim(),
    mimeType: mimeType.trim(),
    size,
    content,
  };
  if (typeof value.localUri === 'string' && value.localUri.trim()) {
    out.localUri = value.localUri.trim();
  }
  if (typeof value.workspaceRelativePath === 'string' && value.workspaceRelativePath.trim()) {
    out.workspaceRelativePath = value.workspaceRelativePath.trim();
  }
  if (typeof value.durationSeconds === 'number' && Number.isFinite(value.durationSeconds)) {
    out.durationSeconds = value.durationSeconds;
  }
  return out;
}

function parseDroppedCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.trunc(value);
}

function parseSnapshot(raw: unknown): NoteChatPrefillSnapshot | null {
  if (!isRecord(raw)) return null;
  const text = typeof raw.text === 'string' ? raw.text : '';
  const expiresAt = typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt)
    ? raw.expiresAt
    : 0;
  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments.map(parseComposerAttachment).filter(Boolean) as ComposerAttachment[]
    : [];
  if (!text.trim() && attachments.length === 0) return null;
  return {
    text,
    attachments,
    expiresAt,
    droppedCount: parseDroppedCount(raw.droppedCount),
  };
}

export function writeNoteChatPrefill(
  sessionKey: string,
  snapshot: Omit<NoteChatPrefillSnapshot, 'expiresAt'>,
): void {
  const sk = sessionKey.trim();
  if (!sk) return;
  if (!snapshot.text.trim() && snapshot.attachments.length === 0) return;

  const payload: NoteChatPrefillSnapshot = {
    text: snapshot.text,
    attachments: snapshot.attachments,
    expiresAt: Date.now() + TTL_MS,
    ...(snapshot.droppedCount ? { droppedCount: snapshot.droppedCount } : {}),
  };

  try {
    storage.set(storageKey(sk), JSON.stringify({ v: 1, ...payload }));
  } catch {
    /* ignore quota */
  }
}

export function readNoteChatPrefill(sessionKey: string): NoteChatPrefillSnapshot | null {
  const sk = sessionKey.trim();
  if (!sk) return null;
  try {
    const raw = storage.getString(storageKey(sk));
    if (!raw) return null;
    const snap = parseSnapshot(JSON.parse(raw) as unknown);
    if (!snap) return null;
    if (snap.expiresAt > 0 && snap.expiresAt <= Date.now()) {
      clearNoteChatPrefill(sk);
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

export function consumeNoteChatPrefill(sessionKey: string): NoteChatPrefillSnapshot | null {
  const snap = readNoteChatPrefill(sessionKey);
  if (!snap) return null;
  clearNoteChatPrefill(sessionKey);
  return snap;
}

export function clearNoteChatPrefill(sessionKey: string): void {
  const sk = sessionKey.trim();
  if (!sk) return;
  try {
    storage.delete(storageKey(sk));
  } catch {
    /* ignore */
  }
}

/** Test-only: wipe staged note → chat payloads. */
export function resetNoteChatPrefillStorageForTests(): void {
  // MMKV test shim may not expose keys(); delete by known prefix is unnecessary for unit tests
  // that write/read a single session key.
}
