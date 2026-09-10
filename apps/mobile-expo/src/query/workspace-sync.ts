import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from './keys';

/** Invalidate the aggregated attention feed. */
export function invalidateAttentionFeed(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.home });
}

/** Invalidate session lists used by the chat drawer.
 *  Uses refetchType 'none' so the list only refreshes on user pull-to-refresh,
 *  not on every chat message or gateway event. */
export function invalidateSessionLists(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.sessionsAll, refetchType: 'none' });
  invalidateAttentionFeed(queryClient);
}

/** Invalidate note and inbox lists after local workspace changes.
 *  Uses refetchType 'none' so the list only refreshes on user pull-to-refresh,
 *  not on every chat message or gateway event. */
export function invalidateNoteLists(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll, refetchType: 'none' });
  invalidateAttentionFeed(queryClient);
}
