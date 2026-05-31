/**
 * The URL session param is the single source of truth for which chat is visible.
 * Product contract: docs/web/chat-session-semantics.md
 */
export function resolveViewSessionKey(routeSessionKey: string | null | undefined): string | null {
  const routeKey = String(routeSessionKey ?? '').trim();
  if (!routeKey || routeKey === 'new') return null;
  return routeKey;
}

export function shouldApplyStreamUpdateToView(params: {
  streamSessionKey: string;
  routeSessionKey: string | null | undefined;
}): boolean {
  const streamKey = String(params.streamSessionKey ?? '').trim();
  const viewKey = resolveViewSessionKey(params.routeSessionKey);
  if (!streamKey || !viewKey) return false;
  return streamKey === viewKey;
}

export function shouldRestoreLiveCacheToView(params: {
  cacheSessionKey: string;
  routeSessionKey: string | null | undefined;
}): boolean {
  const viewKey = resolveViewSessionKey(params.routeSessionKey);
  if (!viewKey) return false;
  return params.cacheSessionKey === viewKey;
}

/** True when the routed chat tab is exactly `chatId` (never true on `/chat/new`). */
export function isViewingSession(params: {
  chatId: string;
  routeSessionKey: string | null | undefined;
}): boolean {
  const chatId = String(params.chatId ?? '').trim();
  if (!chatId) return false;
  const viewKey = resolveViewSessionKey(params.routeSessionKey);
  if (!viewKey) return false;
  return viewKey === chatId;
}
