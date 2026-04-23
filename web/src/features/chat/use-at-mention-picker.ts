import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchWorkspaceBrowseEntries,
  isValidHttpUrl,
  searchWorkspaceFiles,
  searchWorkspaceSymbols,
  urlMentionItem,
  type AtCategory,
  type AtMentionItem,
  type AtPickKind,
} from '@/features/chat/at-mention-api';
import { getRecentAtPaths } from '@/features/chat/at-mention-recent';

const DEBOUNCE_MS = 150;
const MAX_ITEMS = 15;
const CATEGORY_KEY = 'xopc.atMention.category';

function loadStoredCategory(): AtCategory {
  if (typeof sessionStorage === 'undefined') return 'files';
  const v = sessionStorage.getItem(CATEGORY_KEY);
  if (v === 'docs' || v === 'symbols' || v === 'urls' || v === 'files') return v;
  return 'files';
}

function saveCategory(c: AtCategory): void {
  try {
    sessionStorage.setItem(CATEGORY_KEY, c);
  } catch {
    /* ignore */
  }
}

export interface AtRange {
  start: number;
  end: number;
  query: string;
}

/**
 * Active `@…` mention for context picker: last `@` before caret, query is non-whitespace tail, not an email
 * fragment and not inside a serialized `@(file|doc|url|symbol):` token.
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

export function isBrowseModeQuery(query: string, category: AtCategory): boolean {
  if (category !== 'files' && category !== 'docs') return false;
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
  options: { sessionKey: string | null; slashPaletteOpen: boolean },
) {
  const [category, setCategoryState] = useState<AtCategory>(() => loadStoredCategory());
  const setCategory = useCallback((next: AtCategory) => {
    setCategoryState(next);
    saveCategory(next);
  }, []);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [items, setItems] = useState<AtMentionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const atRange = useMemo(() => {
    if (options.slashPaletteOpen) return null;
    return detectAtRange(value, cursor);
  }, [value, cursor, options.slashPaletteOpen]);

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

        if (category === 'urls') {
          const q = debouncedQuery.trim();
          if (isValidHttpUrl(q)) {
            next = [urlMentionItem(q)];
          }
        } else if (category === 'symbols') {
          if (debouncedQuery.trim()) {
            next = await searchWorkspaceSymbols(debouncedQuery, { sessionKey: sk, limit: MAX_ITEMS });
          }
        } else if (isBrowseModeQuery(debouncedQuery, category)) {
          const dir = browseDirFromQuery(debouncedQuery);
          const entries = await fetchWorkspaceBrowseEntries(dir, { sessionKey: sk });
          const browsePick: AtPickKind = category === 'docs' ? 'doc' : 'file';
          let mapped = entries.map((e) => ({
            pickKind: browsePick,
            name: e.name,
            relativePath: e.path,
            isDirectory: e.isDirectory,
          }));
          if (category === 'docs') {
            mapped = mapped.filter((e) => e.isDirectory || e.name.toLowerCase().endsWith('.md'));
          }
          const browseUp: AtMentionItem = {
            pickKind: browsePick,
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
            onlyMarkdown: category === 'docs',
          });
          const recentPaths = getRecentAtPaths(sk);
          const recentItems: AtMentionItem[] = [];
          const seen = new Set(raw.map((r) => r.relativePath));
          for (const p of recentPaths) {
            if (category === 'docs' && !p.toLowerCase().endsWith('.md')) continue;
            if (seen.has(p)) continue;
            seen.add(p);
            const base = p.replace(/\/$/, '').split('/').pop() ?? p;
            recentItems.push({
              pickKind: category === 'docs' ? 'doc' : 'file',
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
  }, [pickerActive, debouncedQuery, options.sessionKey, category]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [atRange?.start, atRange?.end, debouncedQuery, category]);

  useEffect(() => {
    if (selectedIndex >= items.length) {
      setSelectedIndex(Math.max(0, items.length - 1));
    }
  }, [items.length, selectedIndex]);

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
    category,
    setCategory,
    items,
    selectedIndex,
    query: atRange?.query ?? '',
    loading,
    error,
    onNavigate,
    setSelectedIndex,
  };
}
