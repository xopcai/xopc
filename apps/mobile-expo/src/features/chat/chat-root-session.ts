import type { SessionListItem } from '../../query/sessions';

export function resumableRootChatSessions(items: SessionListItem[]): SessionListItem[] {
  return items.filter((item) => (
    item.status !== 'archived'
    && item.sourceChannel === 'webchat'
  ));
}

export function rootChatResumeKey(items: SessionListItem[]): string {
  return resumableRootChatSessions(items)[0]?.key ?? '';
}
