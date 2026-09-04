import { useEffect, useMemo, useState } from 'react';

import { fetchFileChildren, fetchFileSpaceForContext, searchFiles } from '../../query/files';
import { fetchNotes } from '../../query/notes';
import { detectAtMentionRange } from './at-mention-utils';

export type MobileAtMentionItem =
  | { kind: 'file'; id: string; name: string; relativePath: string; isDirectory: boolean }
  | { kind: 'note'; id: string; name: string; description: string; expectedVersion: string };

export function useAtMentionPicker(text: string, cursor: number, sessionKey: string, slashOpen: boolean) {
  const range = useMemo(
    () => slashOpen ? null : detectAtMentionRange(text, cursor),
    [cursor, slashOpen, text],
  );
  const [items, setItems] = useState<MobileAtMentionItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!range || !sessionKey) {
      setItems([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      const query = range.query.trim();
      void fetchFileSpaceForContext('session', sessionKey).then(async (space) => {
        const filePromise = query.endsWith('/')
          ? fetchFileChildren(space.id, query.replace(/\/+$/, ''))
          : query ? searchFiles(query, space.id) : fetchFileChildren(space.id, '');
        const [files, notes] = await Promise.all([
          filePromise,
          fetchNotes({ search: query || undefined, limit: 8, sortBy: 'updatedAt', sortOrder: 'desc' }).catch(() => null),
        ]);
        if (cancelled) return;
        setItems([
          ...(notes?.items ?? []).filter((note) => note.status !== 'trashed').slice(0, 5).map((note) => ({
            kind: 'note' as const,
            id: note.id,
            name: note.title?.trim() || note.snippet?.trim() || 'Untitled note',
            description: note.snippet?.trim() || '',
            expectedVersion: String(note.updatedAt),
          })),
          ...files.slice(0, 10).map((file) => ({
            kind: 'file' as const,
            id: file.id,
            name: file.name,
            relativePath: file.relativePath,
            isDirectory: file.kind === 'directory',
          })),
        ]);
      }).catch(() => {
        if (!cancelled) setItems([]);
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [range?.query, range?.start, sessionKey]);

  return { open: Boolean(range), range, items, loading, query: range?.query ?? '' };
}
