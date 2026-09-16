/**
 * The URL session param is the single source of truth for which chat is visible.
 * Product contract: docs/web/chat-session-semantics.md
 */
export function resolveViewConversationId(routeConversationId: string | null | undefined): string | null {
  const routeKey = String(routeConversationId ?? '').trim();
  if (!routeKey || routeKey === 'new') return null;
  return routeKey;
}

export function shouldApplyStreamUpdateToView(params: {
  streamConversationId: string;
  routeConversationId: string | null | undefined;
}): boolean {
  const streamKey = String(params.streamConversationId ?? '').trim();
  const viewKey = resolveViewConversationId(params.routeConversationId);
  if (!streamKey || !viewKey) return false;
  return streamKey === viewKey;
}

export function shouldRestoreLiveCacheToView(params: {
  cacheConversationId: string;
  routeConversationId: string | null | undefined;
}): boolean {
  const viewKey = resolveViewConversationId(params.routeConversationId);
  if (!viewKey) return false;
  return params.cacheConversationId === viewKey;
}

/** True when the routed chat tab is exactly `chatId` (never true on `/chat/new`). */
export function isViewingSession(params: {
  chatId: string;
  routeConversationId: string | null | undefined;
}): boolean {
  const chatId = String(params.chatId ?? '').trim();
  if (!chatId) return false;
  const viewKey = resolveViewConversationId(params.routeConversationId);
  if (!viewKey) return false;
  return viewKey === chatId;
}
