export function shouldRefreshSidebarForTranscriptUpdate(
  detail: unknown,
  visibleSessionKeys: ReadonlySet<string>,
): boolean {
  if (!detail || typeof detail !== 'object') return true;
  const key = (detail as { key?: unknown; sessionKey?: unknown }).key
    ?? (detail as { sessionKey?: unknown }).sessionKey;
  return typeof key !== 'string' || !key.trim() || !visibleSessionKeys.has(key);
}
