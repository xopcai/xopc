/**
 * The chat surface has one visual state at a time. Keeping this decision in
 * one place prevents the page shell and message list from briefly choosing
 * different loading UIs during route transitions.
 */
export type ChatConversationPhase =
  | 'creating-session'
  | 'loading-history'
  | 'ready-empty'
  | 'ready-conversation';

export function resolveChatConversationPhase(params: {
  isNewRoute: boolean;
  sessionRoutePending: boolean;
  showSessionLoading: boolean;
  sessionContentLoading: boolean;
  messageCount: number;
}): ChatConversationPhase {
  if (params.isNewRoute) return 'creating-session';

  if (
    params.sessionRoutePending ||
    params.showSessionLoading ||
    params.sessionContentLoading
  ) {
    return 'loading-history';
  }

  return params.messageCount === 0 ? 'ready-empty' : 'ready-conversation';
}
