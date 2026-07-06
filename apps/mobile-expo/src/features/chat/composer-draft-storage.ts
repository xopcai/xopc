import { storage } from '../../storage/mmkv';

const STORAGE_PREFIX = 'xopc.chat.composerDraft:v1:';
const MAX_DRAFT_LENGTH = 20_000;

export type ComposerDraftSnapshot = {
  text: string;
  cursorPos: number;
};

function storageKey(sessionKey: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(sessionKey.trim())}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCursorPos(cursorPos: unknown, textLength: number): number {
  if (typeof cursorPos !== 'number' || !Number.isFinite(cursorPos)) {
    return textLength;
  }
  return Math.min(Math.max(Math.trunc(cursorPos), 0), textLength);
}

export function readComposerDraftSnapshot(sessionKey: string): ComposerDraftSnapshot | null {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) return null;

  try {
    const raw = storage.getString(storageKey(normalizedSessionKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || typeof parsed.text !== 'string') return null;

    const text = parsed.text.slice(0, MAX_DRAFT_LENGTH);
    if (!text.trim()) return null;

    return {
      text,
      cursorPos: normalizeCursorPos(parsed.cursorPos, text.length),
    };
  } catch {
    return null;
  }
}

export function writeComposerDraftSnapshot(
  sessionKey: string,
  snapshot: ComposerDraftSnapshot,
): void {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) return;

  const text = snapshot.text.slice(0, MAX_DRAFT_LENGTH);
  if (!text.trim()) {
    clearComposerDraftSnapshot(normalizedSessionKey);
    return;
  }

  const payload: ComposerDraftSnapshot = {
    text,
    cursorPos: normalizeCursorPos(snapshot.cursorPos, text.length),
  };

  try {
    storage.set(storageKey(normalizedSessionKey), JSON.stringify({ v: 1, ...payload }));
  } catch {
    /* ignore quota */
  }
}

export function clearComposerDraftSnapshot(sessionKey: string): void {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) return;

  try {
    storage.delete(storageKey(normalizedSessionKey));
  } catch {
    /* ignore */
  }
}
