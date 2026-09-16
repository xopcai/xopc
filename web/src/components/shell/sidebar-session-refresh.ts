export function shouldRefreshSidebarForTranscriptUpdate(
  detail: unknown,
  visibleConversationIds: ReadonlySet<string>,
): boolean {
  if (!detail || typeof detail !== 'object') return true;
  const key = (detail as { key?: unknown; conversationId?: unknown }).key
    ?? (detail as { conversationId?: unknown }).conversationId;
  return typeof key !== 'string' || !key.trim() || !visibleConversationIds.has(key);
}
