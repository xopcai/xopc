import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { queryKeys } from '../keys';
import {
  noteToIndexEntry,
  upsertNoteInListCaches,
} from '../note-list-cache';
import type { Note, NoteIndexEntry } from '../notes';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    kind: 'thought',
    status: 'processed',
    createdAt: 1,
    updatedAt: 2,
    capturedVia: { channel: 'app' },
    markdown: '',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<NoteIndexEntry> = {}): NoteIndexEntry {
  return {
    id: 'note-old',
    kind: 'thought',
    status: 'processed',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('upsertNoteInListCaches', () => {
  it('prepends a note to home recentlyOpened', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.home, {
      recentlyOpened: [makeEntry({ id: 'note-old' })],
      inboxCount: 0,
      pendingTasks: [],
      pendingTaskCount: 0,
      recentSessions: [],
    });

    upsertNoteInListCaches(queryClient, noteToIndexEntry(makeNote({ id: 'note-new' })));

    const home = queryClient.getQueryData<{
      recentlyOpened: NoteIndexEntry[];
    }>(queryKeys.home);
    expect(home?.recentlyOpened.map((item) => item.id)).toEqual(['note-new', 'note-old']);
  });

  it('bumps an existing note to the front with merged fields', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.home, {
      recentlyOpened: [
        makeEntry({ id: 'note-b', title: 'B' }),
        makeEntry({ id: 'note-a', title: 'Old title' }),
      ],
      inboxCount: 0,
      pendingTasks: [],
      pendingTaskCount: 0,
      recentSessions: [],
    });

    upsertNoteInListCaches(
      queryClient,
      noteToIndexEntry(makeNote({ id: 'note-a', title: 'New title', updatedAt: 99 })),
    );

    const home = queryClient.getQueryData<{
      recentlyOpened: NoteIndexEntry[];
    }>(queryKeys.home);
    expect(home?.recentlyOpened.map((item) => item.id)).toEqual(['note-a', 'note-b']);
    expect(home?.recentlyOpened[0]?.title).toBe('New title');
    expect(home?.recentlyOpened[0]?.updatedAt).toBe(99);
  });

  it('prepends matching notes infinite lists only when filters match', () => {
    const queryClient = new QueryClient();
    const allListKey = [...queryKeys.notesAll, 'all', 'all'] as const;
    const inboxListKey = [...queryKeys.notesAll, 'inbox', 'all'] as const;

    queryClient.setQueryData(allListKey, {
      pages: [
        {
          items: [makeEntry({ id: 'note-old' })],
          total: 1,
          limit: 20,
          offset: 0,
          hasMore: false,
        },
      ],
      pageParams: [0],
    });
    queryClient.setQueryData(inboxListKey, {
      pages: [
        {
          items: [makeEntry({ id: 'inbox-note', status: 'inbox' })],
          total: 1,
          limit: 20,
          offset: 0,
          hasMore: false,
        },
      ],
      pageParams: [0],
    });

    upsertNoteInListCaches(queryClient, noteToIndexEntry(makeNote({ id: 'note-new' })));

    const allList = queryClient.getQueryData<{ pages: Array<{ items: NoteIndexEntry[]; total: number }> }>(
      allListKey,
    );
    const inboxList = queryClient.getQueryData<{ pages: Array<{ items: NoteIndexEntry[] }> }>(inboxListKey);

    expect(allList?.pages[0]?.items.map((item) => item.id)).toEqual(['note-new', 'note-old']);
    expect(allList?.pages[0]?.total).toBe(2);
    expect(inboxList?.pages[0]?.items.map((item) => item.id)).toEqual(['inbox-note']);
  });

  it('no-ops when matching note queries have no cached data yet', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.home, {
      recentlyOpened: [],
      inboxCount: 0,
      pendingTasks: [],
      pendingTaskCount: 0,
      recentSessions: [],
    });
    queryClient.getQueryCache().build(queryClient, {
      queryKey: [...queryKeys.notesAll, 'all', 'all'],
    });

    expect(() => {
      upsertNoteInListCaches(queryClient, noteToIndexEntry(makeNote({ id: 'note-new' })));
    }).not.toThrow();

    const home = queryClient.getQueryData<{ recentlyOpened: NoteIndexEntry[] }>(queryKeys.home);
    expect(home?.recentlyOpened.map((item) => item.id)).toEqual(['note-new']);
  });
});
