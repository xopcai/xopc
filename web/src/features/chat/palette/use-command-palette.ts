import { useCallback, useMemo, useRef, useState } from 'react';

import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { listSkillNamesInWire } from '@/features/chat/composer/composer-editor-wire';
import { ABORT_CLASS_NAMES } from '@/features/chat/composer/palette-item-handlers';
import { fetchCommandsCached, getChatSkillsCached } from '@/features/chat/palette/command-palette-api';
import { useLocaleStore } from '@/stores/locale-store';
import type { PaletteItem, SlashRange } from '@/features/chat/palette/command-palette.types';
import { FILE_WIRE_TAIL_BODY } from '@/features/chat/palette/file-wire-pattern';
import { paletteDefaultTiebreak } from '@/features/chat/palette/palette-default-order';
import { useAsyncResource } from '@/lib/use-async-resource';

/** Same boundary as `@file:` wire tokens (quoted or unquoted); path `/` is not slash-palette. */
const AT_FILE_TOKEN_AT_INDEX = new RegExp(`^@file:${FILE_WIRE_TAIL_BODY}`, 'u');

function isAbortClassCommand(item: PaletteItem): boolean {
  if (item.kind !== 'command') return false;
  if (ABORT_CLASS_NAMES.has(item.name.toLowerCase())) return true;
  for (const alias of item.aliases ?? []) {
    if (ABORT_CLASS_NAMES.has(alias.toLowerCase())) return true;
  }
  return false;
}

/**
 * UI-side disabled check for palette rows. Mirrors the runtime guard inside
 * `applyCommandItem`; returning `true` means: render the row greyed-out, do not
 * select on click, and have the keyboard adapter consume Enter without action.
 *
 * Disabled iff: command, `acceptsArgs=false`, non-abort, in stream-like state,
 * AND the follow-up queue is full. Other states stay actionable (queue available
 * → queue badge; abort → fires `onAbort`; args=true → just inserts text).
 */
export function commandRowDisabled(
  item: PaletteItem,
  ctx: { runBusy: boolean; pendingFollowUpsCount: number; maxPendingFollowUps: number },
): boolean {
  if (item.kind !== 'command') return false;
  if (item.acceptsArgs === true) return false;
  if (isAbortClassCommand(item)) return false;
  const streamLike = ctx.runBusy || ctx.pendingFollowUpsCount > 0;
  if (!streamLike) return false;
  return ctx.pendingFollowUpsCount >= ctx.maxPendingFollowUps;
}

/**
 * Whether the row should display the "queued" badge (non-disabled, but selecting
 * will route through `onAddPendingFollowUp` rather than `onSend`).
 */
export function commandRowWillQueue(
  item: PaletteItem,
  ctx: { runBusy: boolean; pendingFollowUpsCount: number; maxPendingFollowUps: number },
): boolean {
  if (item.kind !== 'command') return false;
  if (item.acceptsArgs === true) return false;
  if (isAbortClassCommand(item)) return false;
  const streamLike = ctx.runBusy || ctx.pendingFollowUpsCount > 0;
  if (!streamLike) return false;
  return ctx.pendingFollowUpsCount < ctx.maxPendingFollowUps;
}

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
  options?: { suppress?: boolean; isComposing?: boolean; currentAgentId?: string },
) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  /** Grouped (empty) palette: each section can expand independently after "Show N more". */
  const [groupedSkillsExpanded, setGroupedSkillsExpanded] = useState(false);
  const [groupedCommandsExpanded, setGroupedCommandsExpanded] = useState(false);
  const [groupedAgentsExpanded, setGroupedAgentsExpanded] = useState(false);
  const language = useLocaleStore((s) => s.language);

  const slashRange = useMemo(
    () => (options?.isComposing ? null : detectSlashRange(value, cursor)),
    [value, cursor, options?.isComposing],
  );
  const paletteActive = Boolean(slashRange && !options?.suppress);

  if (
    !paletteActive &&
    (groupedSkillsExpanded || groupedCommandsExpanded || groupedAgentsExpanded)
  ) {
    setGroupedSkillsExpanded(false);
    setGroupedCommandsExpanded(false);
    setGroupedAgentsExpanded(false);
  }

  const itemsResource = useAsyncResource(
    async () => {
      const [commands, skillsPayload, agentsPayload] = await Promise.all([
        fetchCommandsCached(),
        getChatSkillsCached(options?.currentAgentId),
        fetchChatAgents().catch(() => null),
      ]);
      const commandItems: PaletteItem[] = commands.map((c) => ({
        kind: 'command' as const,
        id: `cmd:${c.id}`,
        name: c.name,
        description: c.description,
        category: c.category,
        aliases: c.aliases,
        acceptsArgs: c.acceptsArgs,
      }));
      const skillItems: PaletteItem[] = skillsPayload.skills.map((s) => ({
        kind: 'skill' as const,
        id: `skill:${s.name}`,
        name: s.name,
        description: s.description,
        category: 'skill',
        source: s.source,
        availability: {
          status: s.availableForCurrentAgent ? 'available' : (s.unavailableReason ?? 'agent-denied'),
          reason: s.unavailableReason ?? undefined,
        },
      }));
      // Agents: only when there is more than one (matches header `showChatAgentSelector`).
      const agentItems: PaletteItem[] =
        agentsPayload && agentsPayload.items.length > 1
          ? agentsPayload.items.map((a) => ({
              kind: 'agent' as const,
              id: `agent:${a.id}`,
              name: a.id,
              description: a.description ?? '',
              category: 'agent',
              ...(a.avatar ? { avatar: a.avatar } : {}),
              ...(a.name ? { aliases: [a.name] } : {}),
            }))
          : [];
      return [...skillItems, ...commandItems, ...agentItems];
    },
    [language, options?.currentAgentId],
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
  /** Agents are sentence-level switches; only meaningful at the start of the composer. */
  const agentsAllowed = commandsAllowed;

  const qTrim = query.trim();
  const grouped = qTrim === '';

  const effectiveGroupedSkillsExpanded = paletteActive && grouped && groupedSkillsExpanded;
  const effectiveGroupedCommandsExpanded = paletteActive && grouped && groupedCommandsExpanded;
  const effectiveGroupedAgentsExpanded = paletteActive && grouped && groupedAgentsExpanded;

  const expandGroupedSkills = useCallback(() => {
    setGroupedSkillsExpanded(true);
  }, []);
  const expandGroupedCommands = useCallback(() => {
    setGroupedCommandsExpanded(true);
  }, []);
  const expandGroupedAgents = useCallback(() => {
    setGroupedAgentsExpanded(true);
  }, []);

  const {
    items,
    skillRowCount,
    commandRowCount,
    groupedHasSkills,
    groupedHasCommands,
    groupedHasAgents,
    groupedSkillsMoreCount,
    groupedCommandsMoreCount,
    groupedAgentsMoreCount,
  } = useMemo(() => {
    const alreadyPicked = listSkillNamesInWire(value);
    const scored: Array<{ item: PaletteItem; rank: number }> = [];

    for (const item of allItems) {
      if (item.kind === 'command' && !commandsAllowed) {
        continue;
      }
      if (item.kind === 'agent' && !agentsAllowed) {
        continue;
      }
      if (item.kind === 'skill' && alreadyPicked.has(item.name)) {
        continue;
      }
      if (item.kind === 'skill' && grouped && item.availability?.status !== 'available') {
        continue;
      }
      const rank = paletteItemMatchRank(item, query);
      if (rank === null) {
        continue;
      }
      scored.push({ item, rank });
    }

    if (grouped) {
      const sortByDefault = (a: { item: PaletteItem }, b: { item: PaletteItem }) => {
        const t = paletteDefaultTiebreak(a.item, b.item);
        if (t !== 0) return t;
        return a.item.id.localeCompare(b.item.id);
      };
      const skills = scored.filter((s) => s.item.kind === 'skill').sort(sortByDefault).map((s) => s.item);
      const commands = scored.filter((s) => s.item.kind === 'command').sort(sortByDefault).map((s) => s.item);
      const agents = scored.filter((s) => s.item.kind === 'agent').sort(sortByDefault).map((s) => s.item);

      const visSkills = effectiveGroupedSkillsExpanded
        ? skills
        : skills.slice(0, GROUPED_INITIAL_PER_SECTION);
      const visCommands = effectiveGroupedCommandsExpanded
        ? commands
        : commands.slice(0, GROUPED_INITIAL_PER_SECTION);
      const visAgents = effectiveGroupedAgentsExpanded
        ? agents
        : agents.slice(0, GROUPED_INITIAL_PER_SECTION);

      const moreSkills = !effectiveGroupedSkillsExpanded
        ? Math.max(0, skills.length - GROUPED_INITIAL_PER_SECTION)
        : 0;
      const moreCommands = !effectiveGroupedCommandsExpanded
        ? Math.max(0, commands.length - GROUPED_INITIAL_PER_SECTION)
        : 0;
      const moreAgents = !effectiveGroupedAgentsExpanded
        ? Math.max(0, agents.length - GROUPED_INITIAL_PER_SECTION)
        : 0;
      return {
        items: [...visSkills, ...visCommands, ...visAgents],
        skillRowCount: visSkills.length,
        commandRowCount: visCommands.length,
        groupedHasSkills: skills.length > 0,
        groupedHasCommands: commands.length > 0,
        groupedHasAgents: agents.length > 0,
        groupedSkillsMoreCount: moreSkills,
        groupedCommandsMoreCount: moreCommands,
        groupedAgentsMoreCount: moreAgents,
      };
    }

    scored.sort((a, b) => {
      const aUnavailableSkill = a.item.kind === 'skill' && a.item.availability?.status !== 'available';
      const bUnavailableSkill = b.item.kind === 'skill' && b.item.availability?.status !== 'available';
      if (aUnavailableSkill !== bUnavailableSkill) {
        return aUnavailableSkill ? 1 : -1;
      }
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
      commandRowCount: 0,
      groupedHasSkills: false,
      groupedHasCommands: false,
      groupedHasAgents: false,
      groupedSkillsMoreCount: 0,
      groupedCommandsMoreCount: 0,
      groupedAgentsMoreCount: 0,
    };
  }, [
    allItems,
    commandsAllowed,
    agentsAllowed,
    grouped,
    effectiveGroupedCommandsExpanded,
    effectiveGroupedSkillsExpanded,
    effectiveGroupedAgentsExpanded,
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
    /** False when `/` is not at position 0 - agents are sentence-level switches. */
    agentsAllowed,
    /** `true` when the slash token has no filter text: show Skills / Commands / Agents sections. */
    grouped,
    /** In grouped mode, number of leading rows that belong to Skills. */
    skillRowCount,
    /** In grouped mode, number of rows after Skills that belong to Commands. Agents follow. */
    commandRowCount,
    /** In grouped mode, whether the full (untruncated) lists include each kind. */
    groupedHasSkills,
    groupedHasCommands,
    groupedHasAgents,
    /** Hidden skill rows in that section when the section is collapsed. */
    groupedSkillsMoreCount,
    /** Hidden command rows in that section when the section is collapsed. */
    groupedCommandsMoreCount,
    /** Hidden agent rows in that section when the section is collapsed. */
    groupedAgentsMoreCount,
    items,
    selectedIndex: resolvedSelectedIndex,
    query,
    loadError,
    onNavigate,
    setSelectedIndex,
    expandGroupedSkills,
    expandGroupedCommands,
    expandGroupedAgents,
  };
}
