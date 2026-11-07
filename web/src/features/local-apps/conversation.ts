export const LOCAL_APP_CODER_SKILL = 'build-xopc-local-app';

export function localAppConversationUrl(conversationId: string, draft?: string): string {
  const params = new URLSearchParams({ skill: LOCAL_APP_CODER_SKILL });
  const trimmedDraft = draft?.trim();
  if (trimmedDraft) params.set('draft', trimmedDraft);
  return `/chat/${encodeURIComponent(conversationId)}?${params.toString()}`;
}
