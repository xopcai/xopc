import { useCallback, useMemo, useRef, useState } from 'react';

import { listSkillNamesInWire } from '@/features/chat/composer/composer-editor-wire';
import { fetchCommandsCached, getSkillsCached } from '@/features/chat/palette/command-palette-api';
import { useLocaleStore } from '@/stores/locale-store';
import type { PaletteItem, SlashRange } from '@/features/chat/palette/command-palette.types';
import { FILE_WIRE_TAIL_BODY } from '@/features/chat/palette/file-wire-pattern';
import { paletteDefaultTiebreak } from '@/features/chat/palette/palette-default-order';
import { useAsyncResource } from '@/lib/use-async-resource';

/** Same boundary as `@file:` wire tokens (quoted or unquoted); path `/` is not slash-palette. */
const AT_FILE_TOKEN_AT_INDEX = new RegExp(`^@file:${FILE_WIRE_TAIL_BODY}`, 'u');

function atFileTokenSpanContainingIndex(text: string, index: number): { start: number; end: number } | null {
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf('@file:', from);
    if (at === -1) return null;
    const slice = text.slice(at);
    const m = slice.match(AT_FILE_TOKEN_AT_INDEX);
    if (!m) {
      from = at + 1;
      continue;
    }
    const end = at + m[0].length;
    if (index >= at && index < end) {
      return { start: at, end };
    }
    from = end;
  }
  return null;
}

/** Max rows when filtering (flat list, by relevance). */
const MAX_FLAT_PALETTE_ITEMS = 20;
/** When grouped (empty query), rows per section before "Show N more". */
const GROUPED_INITIAL_PER_SECTION = 3;

/** Slash token body after the leading `/` looks like a filesystem path, not a skill name. */
function looksLikePathQuery(query: string): boolean {
  if (query.includes('/')) return true;
  if (/^[A-Za-z]:/u.test(query)) return true;
  return /^(Users|home|var|tmp|etc|opt|private|Volumes|System|Applications|Library|usr|dev|bin|sbin|proc|sys)(\/|$)/iu.test(
    query,
  );
}

/** `/` that continues a URL or path segment (`.com/foo`, `https://`), not a fresh `/command` token. */
function isEmbeddedPathOrUrlSlash(text: string, slashIndex: number): boolean {
  if (slashIndex === 0) return false;
  const prev = text[slashIndex - 1];
  if (prev === undefined || prev === '.' || prev === ':' || prev === '/') return true;
  const head = text.slice(0, slashIndex);
  return /[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+$/u.test(head);
}

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
  // Path segments in `@file:dir/name` contain `/`; do not treat them as `/skill`-style slash palette input.
  if (atFileTokenSpanContainingIndex(text, match.index)) {
    return null;
  }
  const slashStart = match.index;
  if (isEmbeddedPathOrUrlSlash(text, slashStart)) {
    return null;
  }
  const token = match[0];
  const query = token.slice(1);
  if (looksLikePathQuery(query)) {
    return null;
  }
  // Wire `/skill:name` is rendered as a pill, not an active slash palette - otherwise the list stays open with no matches and blocks typing.
  if (token.startsWith('/skill:')) {
    return null;
  }
  return {
    start: match.index,
    end: c,
    query,
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

function clampPaletteIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.min(index, length - 1);
}

export function useCommandPalette(
  value: string,
  cursor: number,
  options?: { suppress?: boolean; isComposing?: boolean },
) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  /** Grouped (empty) palette: each section can expand independently after "Show N more". */
  const [groupedSkillsExpanded, setGroupedSkillsExpanded] = useState(false);
  const [groupedCommandsExpanded, setGroupedCommandsExpanded] = useState(false);
  const language = useLocaleStore((s) => s.language);

  const slashRange = useMemo(
    () => (options?.isComposing ? null : detectSlashRange(value, cursor)),
    [value, cursor, options?.isComposing],
  );
  const paletteActive = Boolean(slashRange && !options?.suppress);

  if (!paletteActive && (groupedSkillsExpanded || groupedCommandsExpanded)) {
    setGroupedSkillsExpanded(false);
    setGroupedCommandsExpanded(false);
  }

  const itemsResource = useAsyncResource(
    async () => {
      const [commands, skillsPayload] = await Promise.all([fetchCommandsCached(), getSkillsCached(language)]);
      const commandItems: PaletteItem[] = commands.map((c) => ({
        kind: 'command' as const,
        id: `cmd:${c.id}`,
        name: c.name,
        description: c.description,
        category: c.category,
        aliases: c.aliases,
        acceptsArgs: c.acceptsArgs,
      }));
      const skillItems: PaletteItem[] = skillsPayload.catalog.flatMap((s) => {
        if (!s.enabled || s.disableModelInvocation) return [];
        return [
          {
            kind: 'skill' as const,
            id: `skill:${s.name}`,
            name: s.name,
            description: s.description,
            category: 'skill',
            source: s.source,
          },
        ];
      });
      return [...skillItems, ...commandItems];
    },
    [language],
    { enabled: paletteActive, initial: [] as PaletteItem[], errorData: [] },
  );
  const allItems = itemsResource.data;
  const loadError = itemsResource.error == null
    ? null
    : itemsResource.error instanceof Error
      ? itemsResource.error.message
      : String(itemsResource.error);

  const query = slashRange?.query ?? '';

  /** Slash commands only run when the token is at the start of the composer (`/new`). */
  const commandsAllowed = slashRange !== null && slashRange.start === 0;

  const qTrim = query.trim();
  const grouped = qTrim === '';

  const effectiveGroupedSkillsExpanded = paletteActive && grouped && groupedSkillsExpanded;
  const effectiveGroupedCommandsExpanded = paletteActive && grouped && groupedCommandsExpanded;

  const expandGroupedSkills = useCallback(() => {
    setGroupedSkillsExpanded(true);
  }, []);
  const expandGroupedCommands = useCallback(() => {
    setGroupedCommandsExpanded(true);
  }, []);

  const {
    items,
    skillRowCount,
    groupedHasSkills,
    groupedHasCommands,
    groupedSkillsMoreCount,
    groupedCommandsMoreCount,
  } = useMemo(() => {
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

    if (grouped) {
      const skills = scored
        .filter((s) => s.item.kind === 'skill')
        .sort((a, b) => {
          const t = paletteDefaultTiebreak(a.item, b.item);
          if (t !== 0) return t;
          return a.item.id.localeCompare(b.item.id);
        })
        .map((s) => s.item);
      const commands = scored
        .filter((s) => s.item.kind === 'command')
        .sort((a, b) => {
          const t = paletteDefaultTiebreak(a.item, b.item);
          if (t !== 0) return t;
          return a.item.id.localeCompare(b.item.id);
        })
        .map((s) => s.item);
      const hasSkills = skills.length > 0;
      const hasCommands = commands.length > 0;
      const visSkills = effectiveGroupedSkillsExpanded
        ? skills
        : skills.slice(0, GROUPED_INITIAL_PER_SECTION);
      const visCommands = effectiveGroupedCommandsExpanded
        ? commands
        : commands.slice(0, GROUPED_INITIAL_PER_SECTION);
      const moreSkills = !effectiveGroupedSkillsExpanded
        ? Math.max(0, skills.length - GROUPED_INITIAL_PER_SECTION)
        : 0;
      const moreCommands = !effectiveGroupedCommandsExpanded
        ? Math.max(0, commands.length - GROUPED_INITIAL_PER_SECTION)
        : 0;
      return {
        items: [...visSkills, ...visCommands],
        skillRowCount: visSkills.length,
        groupedHasSkills: hasSkills,
        groupedHasCommands: hasCommands,
        groupedSkillsMoreCount: moreSkills,
        groupedCommandsMoreCount: moreCommands,
      };
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

    return {
      items: scored.slice(0, MAX_FLAT_PALETTE_ITEMS).map((s) => s.item),
      skillRowCount: 0,
      groupedHasSkills: false,
      groupedHasCommands: false,
      groupedSkillsMoreCount: 0,
      groupedCommandsMoreCount: 0,
    };
  }, [
    allItems,
    commandsAllowed,
    grouped,
    effectiveGroupedCommandsExpanded,
    effectiveGroupedSkillsExpanded,
    query,
    value,
  ]);

  const selectionKey = slashRange ? query : '';
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
    open: paletteActive,
    slashRange,
    /** False when `/` is not at position 0 - palette may still list skills. */
    commandsAllowed,
    /** `true` when the slash token has no filter text: show Skills / Commands sections. */
    grouped,
    /** In grouped mode, number of leading rows that belong to Skills (rest are Commands). */
    skillRowCount,
    /** In grouped mode, whether the full (untruncated) lists include each kind. */
    groupedHasSkills,
    groupedHasCommands,
    /** Hidden skill rows in that section when the section is collapsed. */
    groupedSkillsMoreCount,
    /** Hidden command rows in that section when the section is collapsed. */
    groupedCommandsMoreCount,
    items,
    selectedIndex: resolvedSelectedIndex,
    query,
    loadError,
    onNavigate,
    setSelectedIndex,
    expandGroupedSkills,
    expandGroupedCommands,
  };
}
