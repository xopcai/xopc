import { useCallback, useEffect, useMemo, useState } from 'react';

import { listSkillNamesInWire } from '@/features/chat/composer-editor-wire';
import { fetchCommandsCached, getSkillsCached } from '@/features/chat/command-palette-api';
import type { PaletteItem, SlashRange } from '@/features/chat/command-palette.types';
import { paletteDefaultTiebreak } from '@/features/chat/palette-default-order';

/** Max rows in the flat palette (skills and commands mixed, sorted by match then name). */
const MAX_PALETTE_ITEMS = 20;

export function detectSlashRange(text: string, cursor: number): SlashRange | null {
  const len = text.length;
  let c = Math.min(Math.max(cursor, 0), len);
  // Single `/` before React state catches up: caret can briefly read as 0 while value is `/`.
  if (c < 1 && text === '/') {
    c = 1;
  }
  if (c < 1) return null;
  const before = text.slice(0, c);
  const match = before.match(/\/[^\s]*$/);
  if (!match || match.index === undefined) return null;
  const token = match[0];
  // Wire `/skill:name` is rendered as a pill, not an active slash palette — otherwise the list stays open with no matches and blocks typing.
  if (token.startsWith('/skill:')) {
    return null;
  }
  return {
    start: match.index,
    end: c,
    query: token.slice(1),
  };
}

/**
 * Lower rank = stronger match. `null` = no match.
 * Name / alias matches rank above description-only (avoids e.g. `/new` listing skills whose description contains "new").
 */
export function paletteItemMatchRank(item: PaletteItem, q: string): number | null {
  const needle = q.trim().toLowerCase();
  if (!needle) {
    return 0;
  }

  const name = item.name.toLowerCase();
  if (name === needle) {
    return 0;
  }
  for (const a of item.aliases ?? []) {
    if (a.toLowerCase() === needle) {
      return 1;
    }
  }
  if (name.startsWith(needle)) {
    return 2;
  }
  for (const a of item.aliases ?? []) {
    if (a.toLowerCase().startsWith(needle)) {
      return 3;
    }
  }
  if (name.includes(needle)) {
    return 4;
  }
  for (const a of item.aliases ?? []) {
    if (a.toLowerCase().includes(needle)) {
      return 5;
    }
  }
  const desc = (item.description ?? '').toLowerCase();
  if (desc.includes(needle)) {
    return 100;
  }
  if ((item.category ?? '').toLowerCase().includes(needle)) {
    return 101;
  }
  if (item.kind === 'skill' && (item.source ?? '').toLowerCase().includes(needle)) {
    return 102;
  }
  return null;
}

export function useCommandPalette(value: string, cursor: number, options?: { suppress?: boolean }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allItems, setAllItems] = useState<PaletteItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const slashRange = useMemo(() => detectSlashRange(value, cursor), [value, cursor]);
  const paletteActive = Boolean(slashRange && !options?.suppress);

  useEffect(() => {
    if (!slashRange) {
      setSelectedIndex(0);
    }
  }, [slashRange]);

  useEffect(() => {
    if (!paletteActive) return;

    let cancelled = false;
    (async () => {
      try {
        setLoadError(null);
        const [commands, skillsPayload] = await Promise.all([fetchCommandsCached(), getSkillsCached()]);
        if (cancelled) return;

        const commandItems: PaletteItem[] = commands.map((c) => ({
          kind: 'command' as const,
          id: `cmd:${c.id}`,
          name: c.name,
          description: c.description,
          category: c.category,
          aliases: c.aliases,
          acceptsArgs: c.acceptsArgs,
        }));

        const skillItems: PaletteItem[] = skillsPayload.catalog
          .filter((s) => s.enabled && !s.disableModelInvocation)
          .map((s) => ({
            kind: 'skill' as const,
            id: `skill:${s.name}`,
            name: s.name,
            description: s.description,
            category: 'skill',
            source: s.source,
          }));

        setAllItems([...skillItems, ...commandItems]);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
          setAllItems([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [paletteActive]);

  const query = slashRange?.query ?? '';

  /** Slash commands only run when the token is at the start of the composer (`/new`); mid-string `/` is for skills only. */
  const commandsAllowed = slashRange !== null && slashRange.start === 0;

  const items = useMemo(() => {
    const alreadyPicked = listSkillNamesInWire(value);
    const scored: Array<{ item: PaletteItem; rank: number }> = [];

    for (const item of allItems) {
      if (item.kind === 'command' && !commandsAllowed) {
        continue;
      }
      if (item.kind === 'skill' && alreadyPicked.has(item.name)) {
        continue;
      }
      const rank = paletteItemMatchRank(item, query);
      if (rank === null) {
        continue;
      }
      scored.push({ item, rank });
    }

    scored.sort((a, b) => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      const byDefault = paletteDefaultTiebreak(a.item, b.item);
      if (byDefault !== 0) {
        return byDefault;
      }
      return 0;
    });

    return scored.slice(0, MAX_PALETTE_ITEMS).map((s) => s.item);
  }, [allItems, commandsAllowed, query, value]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

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
    open: paletteActive,
    slashRange,
    /** False when `/` is not at position 0 — palette may still list skills. */
    commandsAllowed,
    items,
    selectedIndex,
    query,
    loadError,
    onNavigate,
    setSelectedIndex,
  };
}
