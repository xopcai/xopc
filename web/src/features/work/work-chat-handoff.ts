export function buildWorkChatHandoffUrl(intent: string): string {
  const draft = intent.trim();
  if (!draft) return '/chat/new';
  const search = new URLSearchParams({ draft, autoSend: '1' });
  return `/chat/new?${search.toString()}`;
}
