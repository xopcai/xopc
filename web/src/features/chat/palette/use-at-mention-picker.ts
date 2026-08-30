import { useCallback, useMemo, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';

import { fetchWorkspaceBrowseEntries, searchWorkspaceFiles, type AtMentionItem } from '@/features/chat/palette/at-mention-api';
import { getRecentAtPaths } from '@/features/chat/palette/at-mention-recent';
import { listNotes } from '@/features/notes/notes-api';
import { messages } from '@/i18n/messages';
import { useAsyncResource } from '@/lib/use-async-resource';
import { useLocaleStore } from '@/stores/locale-store';

const DEBOUNCE_MS = 150;
const MAX_FILE_ITEMS = 10;
const MAX_NOTE_ITEMS = 5;

export interface AtRange {
  start: number;
  end: number;
  query: string;
}

/**
 * Active `@…` mention for file picker: last `@` before caret, query is non-whitespace tail, not an email
 * local-part character (ASCII alnum+_) right before `@`, and not already inside a serialized
 * `@(file|doc|url|symbol):` token. The composer always suppresses the `/` (slash) palette while this
 * range is active so path queries like `sub/dir` never open both menus.
 */
export function detectAtRange(text: string, cursor: number): AtRange | null {
  const len = text.length;
  let c = Math.min(Math.max(cursor, 0), len);
  if (c < 1) return null;
  const before = text.slice(0, c);
  const match = before.match(/@([^\s]*)$/);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  if (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) {
    return null;
  }
  const tail = before.slice(start);
  if (/^@(file|doc|url|symbol):/.test(tail)) {
    return null;
  }
  return {
    start,
    end: c,
    query: match[1] ?? '',
  };
}

function isBrowseModeQuery(query: string): boolean {
  const q = query.trim();
  return q.length > 0 && q.endsWith('/') && !/^https?:\/\//i.test(q);
}

export function browseDirFromQuery(query: string): string {
  return query.replace(/\/+$/, '').trim();
}

export function browseParentDir(dir: string): string {
  const d = dir.replace(/\/+$/, '');
  if (!d) return '';
  const i = d.lastIndexOf('/');
  return i <= 0 ? '' : d.slice(0, i);
}

function clampPaletteIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.min(index, length - 1);
}

export function useAtMentionPicker(
  value: string,
  cursor: number,
  options: {
    sessionKey: string | null;
    slashPaletteOpen: boolean;
    isComposing?: boolean;
    selectedNoteIds?: ReadonlySet<string>;
    /** When provided, skips internal `detectAtRange` computation. */
    precomputedAtRange?: AtRange | null;
  },
) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const language = useLocaleStore((s) => s.language);

  const atRange = useMemo(() => {
    if (options.precomputedAtRange !== undefined) {
      if (options.isComposing) return null;
      if (options.slashPaletteOpen) return null;
      return options.precomputedAtRange;
    }
    if (options.isComposing) return null;
    if (options.slashPaletteOpen) return null;
    return detectAtRange(value, cursor);
  }, [value, cursor, options.slashPaletteOpen, options.isComposing, options.precomputedAtRange]);

  const pickerActive = atRange !== null;
  const rawQuery = pickerActive ? (atRange?.query ?? '') : '';
  const [debouncedQueryRaw] = useDebounce(rawQuery, DEBOUNCE_MS);
  const debouncedQuery = pickerActive ? debouncedQueryRaw : '';

  const sessionKey = options.sessionKey?.trim() ?? '';
  const selectedNoteIdsKey = [...(options.selectedNoteIds ?? [])].sort().join('\0');
  const itemsResource = useAsyncResource(
    async () => {
      if (!sessionKey) {
        return [] as AtMentionItem[];
      }

      if (isBrowseModeQuery(debouncedQuery)) {
        const dir = browseDirFromQuery(debouncedQuery);
        const entries = await fetchWorkspaceBrowseEntries(dir, { sessionKey });
        const mapped = entries.map((e) => ({
          kind: 'file' as const,
          name: e.name,
          relativePath: e.path,
          isDirectory: e.isDirectory,
        }));
        const browseUp: AtMentionItem = {
          kind: 'file',
          name: '..',
          relativePath: '',
          isDirectory: true,
          isBrowseUp: true,
        };
        return dir ? [browseUp, ...mapped] : mapped;
      }

      const [raw, notesPayload] = await Promise.all([
        searchWorkspaceFiles(debouncedQuery, {
          sessionKey,
          limit: MAX_FILE_ITEMS,
        }),
        listNotes({
          ...(debouncedQuery.trim() ? { search: debouncedQuery.trim() } : {}),
          limit: MAX_NOTE_ITEMS,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
        }).catch(() => ({ items: [], total: 0 })),
      ]);
      const recentPaths = getRecentAtPaths(sessionKey);
      const recentItems: AtMentionItem[] = [];
      const seen = new Set(raw.map((r) => r.relativePath));
      for (const p of recentPaths) {
        if (seen.has(p)) continue;
        seen.add(p);
        const base = p.replace(/\/$/, '').split('/').pop() ?? p;
        recentItems.push({
          kind: 'file',
          name: base,
          relativePath: p,
          isDirectory: p.endsWith('/'),
          isRecent: true,
        });
        if (recentItems.length >= 5) break;
      }
      const selectedNoteIds = options.selectedNoteIds ?? new Set<string>();
      const noteItems: AtMentionItem[] = notesPayload.items
        .filter((note) => note.status !== 'trashed' && !selectedNoteIds.has(note.id))
        .map((note) => ({
          kind: 'note',
          name: note.title?.trim() || note.snippet?.trim() || messages(language).chat.commandPalette.untitledNote,
          description: note.snippet?.trim() || '',
          noteRef: { sourceId: note.id, expectedVersion: String(note.updatedAt) },
        }));
      return [...noteItems, ...recentItems, ...raw];
    },
    [debouncedQuery, language, selectedNoteIdsKey, sessionKey],
    {
      enabled: pickerActive && Boolean(sessionKey),
      initial: [] as AtMentionItem[],
      errorData: [] as AtMentionItem[],
    },
  );

  const items = pickerActive ? itemsResource.data : [];
  const loading = pickerActive ? itemsResource.loading : false;
  const error =
    pickerActive && itemsResource.error != null
      ? itemsResource.error instanceof Error
        ? itemsResource.error.message
        : String(itemsResource.error)
      : null;

  const rangeStart = atRange?.start;
  const rangeEnd = atRange?.end;
  const selectionKey = `${rangeStart ?? ''}:${rangeEnd ?? ''}:${debouncedQuery}`;
  const trackedSelectionKeyRef = useRef(selectionKey);
  if (trackedSelectionKeyRef.current !== selectionKey) {
    trackedSelectionKeyRef.current = selectionKey;
    if (selectedIndex !== 0) {
      setSelectedIndex(0);
    }
  }
  const resolvedSelectedIndex = clampPaletteIndex(selectedIndex, items.length);

  const onNavigate = useCallback(
    (dir: 'up' | 'down') => {
      if (items.length === 0) return;
      setSelectedIndex((i) => {
        if (dir === 'down') return (i + 1) % items.length;
        return (i - 1 + items.length) % items.length;
      });
    },
    [items.length],
  );

  return {
    open: pickerActive,
    atRange,
    items,
    selectedIndex: resolvedSelectedIndex,
    query: atRange?.query ?? '',
    loading,
    error,
    onNavigate,
    setSelectedIndex,
  };
}
