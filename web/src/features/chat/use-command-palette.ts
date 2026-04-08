import { useCallback, useEffect, useMemo, useState } from 'react';

import { listSkillNamesInWire } from '@/features/chat/composer-editor-wire';
import { fetchCommandsCached, getSkillsCached } from '@/features/chat/command-palette-api';
import type { PaletteItem, SlashRange } from '@/features/chat/command-palette.types';

const MAX_VISIBLE = 8;

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
  return {
    start: match.index,
    end: c,
    query: match[0].slice(1),
  };
}

function matchesQuery(item: PaletteItem, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    item.name,
    item.description,
    item.category ?? '',
    ...(item.aliases ?? []),
    item.kind === 'skill' ? item.source ?? '' : '',
  ]
    .join('\n')
    .toLowerCase();
  return hay.includes(needle);
}

export function useCommandPalette(value: string, cursor: number) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allItems, setAllItems] = useState<PaletteItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const slashRange = useMemo(() => detectSlashRange(value, cursor), [value, cursor]);
  const paletteActive = !!slashRange;

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

  const filteredItems = useMemo(() => {
    const alreadyPicked = listSkillNamesInWire(value);
    const list = allItems.filter((item) => {
      if (item.kind === 'skill' && alreadyPicked.has(item.name)) {
        return false;
      }
      return matchesQuery(item, query);
    });
    return list.slice(0, MAX_VISIBLE);
  }, [allItems, query, value]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex >= filteredItems.length) {
      setSelectedIndex(Math.max(0, filteredItems.length - 1));
    }
  }, [filteredItems.length, selectedIndex]);

  const onNavigate = useCallback(
    (dir: 'up' | 'down') => {
      if (filteredItems.length === 0) return;
      setSelectedIndex((i) => {
        if (dir === 'down') return (i + 1) % filteredItems.length;
        return (i - 1 + filteredItems.length) % filteredItems.length;
      });
    },
    [filteredItems.length],
  );

  return {
    open: paletteActive,
    slashRange,
    items: filteredItems,
    selectedIndex,
    query,
    loadError,
    onNavigate,
    setSelectedIndex,
  };
}
