import type { PendingFollowUp, PendingFollowUpAttachment } from './pending-follow-up.types';
import { storage } from '../../storage/mmkv';

const STORAGE_PREFIX = 'xopc.chat.followUpQueue:v1:';

export type FollowUpQueueSnapshot = {
  pending: PendingFollowUp[];
  editingId: string | null;
};

function storageKey(sessionKey: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(sessionKey.trim())}`;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function parseAttachment(x: unknown): PendingFollowUpAttachment | null {
  if (!isRecord(x)) return null;
  const type = x.type;
  if (typeof type !== 'string' || !type.trim()) return null;
  const out: PendingFollowUpAttachment = { type: type.trim() };
  if (typeof x.mimeType === 'string') out.mimeType = x.mimeType;
  if (typeof x.name === 'string') out.name = x.name;
  if (typeof x.size === 'number' && Number.isFinite(x.size)) out.size = x.size;
  if (typeof x.workspaceRelativePath === 'string') out.workspaceRelativePath = x.workspaceRelativePath;
  if (typeof x.durationSeconds === 'number' && Number.isFinite(x.durationSeconds)) {
    out.durationSeconds = x.durationSeconds;
  }
  return out;
}

function parsePendingFollowUps(raw: unknown): PendingFollowUp[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingFollowUp[] = [];
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const id = row.id;
    const text = row.text;
    if (typeof id !== 'string' || !id.trim()) continue;
    if (typeof text !== 'string') continue;
    const item: PendingFollowUp = { id: id.trim(), text };
    if (typeof row.thinkingLevel === 'string' && row.thinkingLevel.trim()) {
      item.thinkingLevel = row.thinkingLevel.trim();
    }
    if (Array.isArray(row.attachments)) {
      const atts = row.attachments.map(parseAttachment).filter(Boolean) as PendingFollowUpAttachment[];
      if (atts.length) item.attachments = atts;
    }
    out.push(item);
    if (out.length >= 50) break;
  }
  return out;
}

function snapshotIsEmpty(snap: FollowUpQueueSnapshot): boolean {
  return snap.pending.length === 0 && snap.editingId == null;
}

/**
 * Shape safe for persistence: never persist inline `data` (base64).
 * Rows may still carry `workspaceRelativePath` / metadata so session-backed files survive refresh.
 */
export function sanitizeFollowUpQueueSnapshot(snap: FollowUpQueueSnapshot): FollowUpQueueSnapshot {
  return {
    editingId: snap.editingId,
    pending: snap.pending.map((row) => ({
      ...row,
      attachments: row.attachments?.map((a) => {
        const { data, ...rest } = a;
        void data;
        return rest;
      }),
    })),
  };
}

export function readFollowUpQueueSnapshot(sessionKey: string): FollowUpQueueSnapshot | null {
  const sk = sessionKey?.trim();
  if (!sk) return null;
  try {
    const raw = storage.getString(storageKey(sk));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const pending = parsePendingFollowUps(parsed.pending);
    const editingId =
      parsed.editingId === null
        ? null
        : typeof parsed.editingId === 'string' && parsed.editingId.trim()
          ? parsed.editingId.trim()
          : null;

    const snap: FollowUpQueueSnapshot = { pending, editingId };
    if (snapshotIsEmpty(snap)) return null;
    return snap;
  } catch {
    return null;
  }
}

export function writeFollowUpQueueSnapshot(sessionKey: string, snap: FollowUpQueueSnapshot): void {
  const sk = sessionKey?.trim();
  if (!sk) return;
  const sanitized = sanitizeFollowUpQueueSnapshot(snap);
  if (snapshotIsEmpty(sanitized)) {
    clearFollowUpQueueSnapshot(sk);
    return;
  }
  try {
    storage.set(storageKey(sk), JSON.stringify({ v: 3, ...sanitized }));
  } catch {
    /* ignore quota */
  }
}

export function clearFollowUpQueueSnapshot(sessionKey: string): void {
  const sk = sessionKey?.trim();
  if (!sk) return;
  try {
    storage.delete(storageKey(sk));
  } catch {
    /* ignore */
  }
}
