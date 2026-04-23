import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { searchWorkspaceFiles, type AtMentionItem } from '@/features/chat/at-mention-api';

const DEBOUNCE_MS = 150;
const MAX_ITEMS = 15;

export interface AtRange {
  start: number;
  end: number;
  query: string;
}

/**
 * Active `@…` mention for file picker: last `@` before caret, query is non-whitespace tail, not an email
 * fragment and not inside a serialized `@file:` token.
 */
export function detectAtRange(text: string, cursor: number): AtRange | null {
  const len = text.length;
  let c = Math.min(Math.max(cursor, 0), len);
  if (c < 1) return null;
  const before = text.slice(0, c);
  const match = before.match(/@([^\s]*)$/);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  if (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1]!)) {
    return null;
  }
  const tail = before.slice(start);
  if (tail.startsWith('@file:')) {
    return null;
  }
  return {
    start,
    end: c,
    query: match[1] ?? '',
  };
}

export function useAtMentionPicker(
  value: string,
  cursor: number,
  options: { sessionKey: string | null; slashPaletteOpen: boolean },
) {
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
  const debouncedQueryRef = useRef('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    if (!pickerActive) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      debouncedQueryRef.current = '';
      setDebouncedQuery('');
      return;
    }
    const q = atRange.query;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      debouncedQueryRef.current = q;
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
        const next = await searchWorkspaceFiles(debouncedQuery, {
          sessionKey: sk,
          limit: MAX_ITEMS,
        });
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

  useEffect(() => {
    setSelectedIndex(0);
  }, [atRange?.start, atRange?.end, debouncedQuery]);

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
    items,
    selectedIndex,
    query: atRange?.query ?? '',
    loading,
    error,
    onNavigate,
    setSelectedIndex,
  };
}
