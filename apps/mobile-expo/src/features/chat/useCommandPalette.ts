/**
 * Hook for the `/` command palette — detects slash input, fetches items, filters by query.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchAllPaletteItems } from './command-palette-api';
import type { PaletteItem, SlashRange } from './command-palette.types';
import { detectSlashRange, paletteItemMatchRank } from './command-palette-utils';

// Re-export pure utils for consumers that need them directly
export { detectSlashRange, paletteItemMatchRank } from './command-palette-utils';

/** Max items shown in the filtered list. */
const MAX_FILTERED_ITEMS = 12;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface CommandPaletteState {
  /** Whether the palette popup is open */
  open: boolean;
  /** Filtered & ranked items to display */
  items: PaletteItem[];
  /** Current slash range (null if not active) */
  slashRange: SlashRange | null;
  /** The query text (after `/`) */
  query: string;
  /** Whether items are loading */
  loading: boolean;
  /** Apply a selected palette item — returns the new draft text */
  applyItem: (item: PaletteItem) => string;
}

export function useCommandPalette(
  draft: string,
  cursor: number,
): CommandPaletteState {
  const [allItems, setAllItems] = useState<PaletteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  // Detect slash range
  const slashRange = useMemo(() => detectSlashRange(draft, cursor), [draft, cursor]);
  const paletteActive = slashRange !== null;

  // Fetch items when palette becomes active
  useEffect(() => {
    if (!paletteActive) {
      fetchedRef.current = false;
      return;
    }
    if (fetchedRef.current && allItems.length > 0) return;

    let cancelled = false;
    setLoading(true);
    fetchAllPaletteItems()
      .then((items) => {
        if (!cancelled) {
          setAllItems(items);
          fetchedRef.current = true;
        }
      })
      .catch(() => {
        // Silently fail — palette will show empty
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [paletteActive, allItems.length]);

  // Filter and rank items
  const query = slashRange?.query ?? '';
  /** Commands are only allowed when `/` is at position 0 (start of input) */
  const commandsAllowed = slashRange !== null && slashRange.start === 0;

  const filteredItems = useMemo(() => {
    if (!paletteActive) return [];

    const candidates = commandsAllowed
      ? allItems
      : allItems.filter((it) => it.kind === 'skill');

    const ranked: Array<{ item: PaletteItem; rank: number }> = [];
    for (const item of candidates) {
      const rank = paletteItemMatchRank(item, query);
      if (rank !== null) {
        ranked.push({ item, rank });
      }
    }

    ranked.sort((a, b) => a.rank - b.rank);
    return ranked.slice(0, MAX_FILTERED_ITEMS).map((r) => r.item);
  }, [paletteActive, allItems, query, commandsAllowed]);

  // Apply selected item
  const applyItem = useCallback(
    (item: PaletteItem): string => {
      if (!slashRange) return draft;

      let insert: string;
      if (item.kind === 'skill') {
        insert = `/skill:${item.name} `;
      } else {
        // Command: replace with `/commandName` (with optional trailing space for args)
        insert = `/${item.name}${item.acceptsArgs ? ' ' : '\n'}`;
      }

      const before = draft.slice(0, slashRange.start);
      const after = draft.slice(slashRange.end);
      return `${before}${insert}${after}`;
    },
    [draft, slashRange],
  );

  return {
    open: paletteActive && (filteredItems.length > 0 || loading),
    items: filteredItems,
    slashRange,
    query,
    loading,
    applyItem,
  };
}
