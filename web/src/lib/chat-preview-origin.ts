/** Conversation pages that should stay mounted while viewing related products. */
export function isChatPreviewPath(pathname: string): boolean {
  return pathname === '/personal' || pathname === '/chat' || pathname.startsWith('/chat/');
}
