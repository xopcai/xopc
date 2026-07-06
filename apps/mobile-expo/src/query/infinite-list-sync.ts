import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from './keys';
import { invalidateHomeFeed } from './workspace-sync';

/** Reset an infinite list to the first page and refetch (user-initiated refresh). */
export async function refreshSessionsList(queryClient: QueryClient): Promise<void> {
  await queryClient.resetQueries({ queryKey: queryKeys.sessionsAll, exact: true });
  invalidateHomeFeed(queryClient);
}

/** Reset a filtered notes infinite list to the first page and refetch. */
export async function refreshNotesList(
  queryClient: QueryClient,
  listQueryKey: readonly unknown[],
): Promise<void> {
  await queryClient.resetQueries({ queryKey: listQueryKey, exact: true });
  invalidateHomeFeed(queryClient);
}
