import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from './keys';
import { invalidateAttentionFeed } from './workspace-sync';

/** Offset pages become invalid when a note is removed or changes list membership. */
export async function resetNoteListPagination(queryClient: QueryClient): Promise<void> {
  await queryClient.resetQueries({
    queryKey: queryKeys.notesAll,
    predicate: (query) => Boolean(query.state.data && typeof query.state.data === 'object'
      && 'pages' in query.state.data),
  });
  invalidateAttentionFeed(queryClient);
}

/** Reset session-list variants so active views refetch and inactive pages cannot go stale. */
export async function refreshSessionsList(queryClient: QueryClient): Promise<void> {
  await queryClient.resetQueries({ queryKey: queryKeys.sessionsAll });
  invalidateAttentionFeed(queryClient);
}

/** Reset a filtered notes infinite list to the first page and refetch. */
export async function refreshNotesList(
  queryClient: QueryClient,
  listQueryKey: readonly unknown[],
): Promise<void> {
  await queryClient.resetQueries({ queryKey: listQueryKey, exact: true });
  invalidateAttentionFeed(queryClient);
}
