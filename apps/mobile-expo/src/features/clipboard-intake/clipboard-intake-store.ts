import { KEYS, storage } from '../../storage/mmkv';

const MAX_HANDLED_HASHES = 100;

type ClipboardHandledHashEntry = {
  hash: string;
  at: number;
};

function readHandledHashes(): ClipboardHandledHashEntry[] {
  const raw = storage.getString(KEYS.clipboardHandledHashes);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is ClipboardHandledHashEntry => (
        Boolean(entry)
        && typeof entry === 'object'
        && typeof (entry as ClipboardHandledHashEntry).hash === 'string'
        && typeof (entry as ClipboardHandledHashEntry).at === 'number'
      ))
      .slice(0, MAX_HANDLED_HASHES);
  } catch {
    return [];
  }
}

function writeHandledHashes(entries: ClipboardHandledHashEntry[]): void {
  storage.set(KEYS.clipboardHandledHashes, JSON.stringify(entries.slice(0, MAX_HANDLED_HASHES)));
}

export function isClipboardHashHandled(hash: string): boolean {
  if (!hash) return false;
  return readHandledHashes().some((entry) => entry.hash === hash);
}

export function rememberClipboardHashHandled(hash: string, at = Date.now()): void {
  if (!hash) return;
  const entries = readHandledHashes().filter((entry) => entry.hash !== hash);
  writeHandledHashes([{ hash, at }, ...entries]);
}

export function rememberLatestAppClipboardHash(hash: string | null): void {
  if (hash) storage.set(KEYS.clipboardLatestAppHash, hash);
  else storage.delete(KEYS.clipboardLatestAppHash);
}

export function getLatestAppClipboardHash(): string | null {
  return storage.getString(KEYS.clipboardLatestAppHash) ?? null;
}

export function isStoredLatestAppClipboardHash(hash: string): boolean {
  return Boolean(hash) && getLatestAppClipboardHash() === hash;
}

export function clearClipboardIntakeMemory(): void {
  storage.delete(KEYS.clipboardHandledHashes);
  storage.delete(KEYS.clipboardLatestAppHash);
}

export const CLIPBOARD_HANDLED_HASH_LIMIT = MAX_HANDLED_HASHES;
