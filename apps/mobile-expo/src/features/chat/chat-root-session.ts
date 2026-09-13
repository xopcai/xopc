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

/** Placeholder and failed queries must never decide which chat to open or create. */
export function rootChatLookupComplete(query: {
  isSuccess: boolean;
  isPlaceholderData: boolean;
  isFetchedAfterMount: boolean;
  isFetching: boolean;
}): boolean {
  return query.isSuccess && !query.isPlaceholderData && query.isFetchedAfterMount && !query.isFetching;
}
