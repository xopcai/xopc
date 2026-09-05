import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { resetNoteListPagination } from '../infinite-list-sync';
import { queryKeys } from '../keys';

describe('resetNoteListPagination', () => {
  it('restarts cached offset lists after deletion so the next note is not skipped', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const records = Array.from({ length: 25 }, (_, i) => `note-${i + 1}`);
    const key = [...queryKeys.notesAll, 'all', 'all', ''];
    const otherKey = [...queryKeys.notesAll, 'inbox', 'all', ''];
    const options = {
      queryKey: key,
      initialPageParam: 0,
      queryFn: async ({ pageParam }: { pageParam: number }) => ({
        items: records.slice(pageParam, pageParam + 20),
        offset: pageParam,
        limit: 20,
        hasMore: pageParam + 20 < records.length,
      }),
      getNextPageParam: (page: { offset: number; limit: number; hasMore: boolean }) =>
        page.hasMore ? page.offset + page.limit : undefined,
    };
    const first = await client.fetchInfiniteQuery(options);
    client.setQueryData(otherKey, first);
    client.setQueryData(queryKeys.homeRecentNotes, { items: ['note-1'] });
    records.shift();

    await resetNoteListPagination(client);
    expect(client.getQueryData(otherKey)).toBeUndefined();
    expect(client.getQueryData(queryKeys.homeRecentNotes)).toEqual({ items: ['note-1'] });
    const refreshed = await client.fetchInfiniteQuery(options);
    expect(refreshed.pages[0].items.at(-1)).toBe('note-21');
    const next = await options.queryFn({ pageParam: options.getNextPageParam(refreshed.pages[0])! });
    expect([...refreshed.pages[0].items, ...next.items]).toEqual(records);
    client.clear();
  });
});
