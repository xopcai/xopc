const MAX_RECENT = 20;
const STORAGE_PREFIX = 'xopc.atMention.recent:';

function storageKey(conversationId: string): string {
  return `${STORAGE_PREFIX}${conversationId.trim()}`;
}

export function getRecentAtPaths(conversationId: string | null | undefined): string[] {
  const sk = conversationId?.trim();
  if (!sk || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(sk));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** Remember a picked workspace-relative path for the @ picker (files / docs). */
export function recordRecentAtPath(conversationId: string | null | undefined, relativePath: string): void {
  const sk = conversationId?.trim();
  const path = relativePath.trim();
  if (!sk || !path || typeof localStorage === 'undefined') return;
  try {
    const prev = getRecentAtPaths(sk).filter((p) => p !== path);
    const next = [path, ...prev].slice(0, MAX_RECENT);
    localStorage.setItem(storageKey(sk), JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}
