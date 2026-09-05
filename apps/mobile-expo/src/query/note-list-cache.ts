import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import { normalizeNoteIndexEntry } from '../features/notes/note-title';

import { queryKeys } from './keys';
import type { Note, NoteIndexEntry, NotesListResult } from './notes';

const HOME_RECENT_LIMIT = 5;

function prependUnique(items: NoteIndexEntry[], entry: NoteIndexEntry, limit?: number): NoteIndexEntry[] {
  const next = [entry, ...items.filter((item) => item.id !== entry.id)];
  return limit !== undefined ? next.slice(0, limit) : next;
}

function upsertAtFront(items: NoteIndexEntry[], entry: NoteIndexEntry): NoteIndexEntry[] {
  const existing = items.find((item) => item.id === entry.id);
  const merged = existing ? { ...existing, ...entry } : entry;
  return [merged, ...items.filter((item) => item.id !== entry.id)];
}

export function noteToIndexEntry(note: Note): NoteIndexEntry {
  return normalizeNoteIndexEntry({
    id: note.id,
    title: note.title,
    kind: note.kind,
    status: note.status,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    pinned: note.pinned,
    tags: note.tags,
    groupId: note.groupId,
    lastOpenedAt: note.lastOpenedAt,
    taskDone: note.taskMeta?.done,
    taskDueAt: note.taskMeta?.dueAt,
    text: note.text,
  });
}

function noteMatchesListFilters(
  entry: NoteIndexEntry,
  statusFilter: unknown,
  kindFilter: unknown,
): boolean {
  if (typeof statusFilter === 'string' && statusFilter !== 'all' && entry.status !== statusFilter) {
    return false;
  }
  if (typeof kindFilter === 'string' && kindFilter !== 'all' && entry.kind !== kindFilter) {
    return false;
  }
  return true;
}

/** Insert or bump a note in the home recent-notes + filtered list caches. */
export function upsertNoteInListCaches(queryClient: QueryClient, entry: NoteIndexEntry): void {
  // Remove first so entries that no longer match a cached filter do not remain stale.
  removeNoteFromListCachesInternal(queryClient, entry.id);

  queryClient.setQueriesData<NotesListResult>(
    {
      queryKey: queryKeys.notesAll,
      predicate: (query) => query.queryKey[1] === queryKeys.homeRecentNotes[1],
    },
    (prev) => {
      if (!prev?.items) return prev;
      const hadEntry = prev.items.some((item) => item.id === entry.id);
      return {
        ...prev,
        items: prependUnique(prev.items, entry, HOME_RECENT_LIMIT),
        total: hadEntry ? prev.total : prev.total + 1,
      };
    },
  );

  queryClient.setQueriesData<InfiniteData<NotesListResult>>(
    {
      queryKey: queryKeys.notesAll,
      predicate: (query) => {
        const key = query.queryKey;
        if (key[1] === queryKeys.homeRecentNotes[1] || key[1] === queryKeys.homeInboxCount[1]) return false;
        if (key.length < 3) return true;
        return noteMatchesListFilters(entry, key[1], key[2]);
      },
    },
    (prev) => {
      if (!prev?.pages?.length) return prev;
      const [first, ...rest] = prev.pages;
      const items = first.items ?? [];
      const hadEntry = items.some((item) => item.id === entry.id);
      return {
        ...prev,
        pages: [
          {
            ...first,
            items: upsertAtFront(items, entry),
            total: hadEntry ? first.total : first.total + 1,
          },
          ...rest,
        ],
      };
    },
  );

  void queryClient.invalidateQueries({ queryKey: queryKeys.homeInboxCount });
}

function removeFromItems(items: NoteIndexEntry[], noteId: string): {
  items: NoteIndexEntry[];
  removed: NoteIndexEntry | null;
  hadEntry: boolean;
} {
  const removed = items.find((item) => item.id === noteId) ?? null;
  if (!removed) {
    return { items, removed: null, hadEntry: false };
  }
  return {
    items: items.filter((item) => item.id !== noteId),
    removed,
    hadEntry: true,
  };
}

/** Optimistically remove a note from list caches; returns removed entry for undo. */
function removeNoteFromListCachesInternal(queryClient: QueryClient, noteId: string): NoteIndexEntry | null {
  let removedEntry: NoteIndexEntry | null = null;

  queryClient.setQueriesData<NotesListResult>(
    { queryKey: queryKeys.notesAll },
    (prev) => {
      if (!prev?.items) return prev;
      const { items, removed, hadEntry } = removeFromItems(prev.items, noteId);
      if (removed && !removedEntry) removedEntry = removed;
      if (!hadEntry) return prev;
      return {
        ...prev,
        items,
        total: Math.max(0, prev.total - 1),
      };
    },
  );

  queryClient.setQueriesData<InfiniteData<NotesListResult>>(
    { queryKey: queryKeys.notesAll },
    (prev) => {
      if (!prev?.pages?.length) return prev;
      let changed = false;
      const pages = prev.pages.map((page) => {
        const { items, removed, hadEntry } = removeFromItems(page.items ?? [], noteId);
        if (!hadEntry) return page;
        if (removed && !removedEntry) removedEntry = removed;
        changed = true;
        return {
          ...page,
          items,
          total: Math.max(0, page.total - 1),
        };
      });
      return changed ? { ...prev, pages } : prev;
    },
  );

  return removedEntry;
}

/** Optimistically remove a note from every list cache; returns the removed entry for undo. */
export function removeNoteFromListCaches(queryClient: QueryClient, noteId: string): NoteIndexEntry | null {
  const removed = removeNoteFromListCachesInternal(queryClient, noteId);
  void queryClient.invalidateQueries({ queryKey: queryKeys.homeInboxCount });
  return removed;
}
