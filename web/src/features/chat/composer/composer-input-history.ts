const MAX_RECENT = 20;
const STORAGE_PREFIX = 'xopc.composer.inputHistory:';

function storageKey(sessionKey: string): string {
  return `${STORAGE_PREFIX}${sessionKey.trim()}`;
}

export function getComposerInputHistory(sessionKey: string | null | undefined): string[] {
  const sk = sessionKey?.trim();
  if (!sk || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(sk));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** Persist latest user-submitted composer text for this session (max 20, dedupe head). */
export function recordComposerInputHistory(sessionKey: string | null | undefined, text: string): void {
  const sk = sessionKey?.trim();
  const t = text.trim();
  if (!sk || !t || typeof localStorage === 'undefined') return;
  try {
    const prev = getComposerInputHistory(sk);
    if (prev[0] === t) return;
    const next = [t, ...prev].slice(0, MAX_RECENT);
    localStorage.setItem(storageKey(sk), JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

export const COMPOSER_INPUT_HISTORY_MAX = MAX_RECENT;
