import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchWorkspaceBrowseEntries, searchWorkspaceFiles, type AtMentionItem } from '@/features/chat/at-mention-api';
import { getRecentAtPaths } from '@/features/chat/at-mention-recent';

const DEBOUNCE_MS = 150;
const MAX_ITEMS = 15;

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

export function isBrowseModeQuery(query: string): boolean {
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

export function useAtMentionPicker(
  value: string,
  cursor: number,
  options: {
    sessionKey: string | null;
    slashPaletteOpen: boolean;
    isComposing?: boolean;
    /** When provided, skips internal `detectAtRange` computation. */
    precomputedAtRange?: AtRange | null;
  },
) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [items, setItems] = useState<AtMentionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

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
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    if (!pickerActive) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setDebouncedQuery('');
      return;
    }
    const q = atRange.query;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setDebouncedQuery(q);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [pickerActive, atRange?.query]);

  useEffect(() => {
    if (!pickerActive) {
      setItems([]);
      setLoading(false);
      setError(null);
      setSelectedIndex(0);
      return;
    }

    const sk = options.sessionKey?.trim();
    if (!sk) {
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }

    const rid = ++requestIdRef.current;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        let next: AtMentionItem[] = [];

        if (isBrowseModeQuery(debouncedQuery)) {
          const dir = browseDirFromQuery(debouncedQuery);
          const entries = await fetchWorkspaceBrowseEntries(dir, { sessionKey: sk });
          let mapped = entries.map((e) => ({
            name: e.name,
            relativePath: e.path,
            isDirectory: e.isDirectory,
          }));
          const browseUp: AtMentionItem = {
            name: '..',
            relativePath: '',
            isDirectory: true,
            isBrowseUp: true,
          };
          next = dir ? [browseUp, ...mapped] : mapped;
        } else {
          const raw = await searchWorkspaceFiles(debouncedQuery, {
            sessionKey: sk,
            limit: MAX_ITEMS,
          });
          const recentPaths = getRecentAtPaths(sk);
          const recentItems: AtMentionItem[] = [];
          const seen = new Set(raw.map((r) => r.relativePath));
          for (const p of recentPaths) {
            if (seen.has(p)) continue;
            seen.add(p);
            const base = p.replace(/\/$/, '').split('/').pop() ?? p;
            recentItems.push({
              name: base,
              relativePath: p,
              isDirectory: p.endsWith('/'),
              isRecent: true,
            });
            if (recentItems.length >= 5) break;
          }
          next = [...recentItems, ...raw];
        }

        if (cancelled || rid !== requestIdRef.current) return;
        setItems(next);
      } catch (e) {
        if (cancelled || rid !== requestIdRef.current) return;
        setItems([]);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled && rid === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pickerActive, debouncedQuery, options.sessionKey]);

  const rangeStart = atRange?.start;
  const rangeEnd = atRange?.end;
  const trackedIndexKeyRef = useRef({ s: rangeStart, e: rangeEnd, q: debouncedQuery });
  if (
    trackedIndexKeyRef.current.s !== rangeStart ||
    trackedIndexKeyRef.current.e !== rangeEnd ||
    trackedIndexKeyRef.current.q !== debouncedQuery
  ) {
    trackedIndexKeyRef.current = { s: rangeStart, e: rangeEnd, q: debouncedQuery };
    setSelectedIndex(0);
  } else if (selectedIndex >= items.length && items.length > 0) {
    setSelectedIndex(items.length - 1);
  } else if (selectedIndex !== 0 && items.length === 0) {
    setSelectedIndex(0);
  }

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
    selectedIndex,
    query: atRange?.query ?? '',
    loading,
    error,
    onNavigate,
    setSelectedIndex,
  };
}
