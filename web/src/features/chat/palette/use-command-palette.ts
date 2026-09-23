import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveSkillPresentation } from '@xopcai/composer-core/skill-localization';

import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { listSkillNamesInWire } from '@/features/chat/composer/composer-editor-wire';
import { ABORT_CLASS_NAMES } from '@/features/chat/composer/palette-item-handlers';
import { fetchCommandsCached, getChatSkillsCached } from '@/features/chat/palette/command-palette-api';
import {
  agentListDisplayDescription,
  agentListDisplayName,
} from '@/features/settings/agents/agent-display-names';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import type {
  PaletteItem,
  PaletteItemKind,
  PaletteSection,
  SlashRange,
} from '@/features/chat/palette/command-palette.types';
import { paletteDefaultTiebreak } from '@/features/chat/palette/palette-default-order';
import { useAsyncResource } from '@/lib/use-async-resource';

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
  const desc = item.description.toLowerCase();
  if (desc.includes(needle)) {
    return 100;
  }
  if (item.category.toLowerCase().includes(needle)) {
    return 101;
  }
  if (item.kind === 'skill' && (item.source ?? '').toLowerCase().includes(needle)) {
    return 102;
  }
  if (item.kind === 'skill') {
    for (const term of item.searchTerms ?? []) {
      if (term.toLowerCase().includes(needle)) {
        return 103;
      }
    }
  }
  return null;
}

function clampPaletteIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.min(index, length - 1);
}

export function buildPaletteSections(
  allItems: PaletteItem[],
  options: {
    query: string;
    value: string;
    commandsAllowed: boolean;
    agentsAllowed: boolean;
  },
): { sections: PaletteSection[]; flatItems: PaletteItem[] } {
  const { query, value, commandsAllowed, agentsAllowed } = options;
  const unfiltered = query.trim() === '';
  const alreadyPicked = listSkillNamesInWire(value);
  const scored: Array<{ item: PaletteItem; rank: number }> = [];

  for (const item of allItems) {
    if (item.kind === 'command' && !commandsAllowed) continue;
    if (item.kind === 'agent' && !agentsAllowed) continue;
    if (item.kind === 'skill' && alreadyPicked.has(item.canonicalName)) continue;
    if (item.kind === 'skill' && unfiltered && item.availability.status !== 'available') continue;
    const rank = paletteItemMatchRank(item, query);
    if (rank !== null) scored.push({ item, rank });
  }

  scored.sort((a, b) => {
    const aUnavailableSkill = a.item.kind === 'skill' && a.item.availability.status !== 'available';
    const bUnavailableSkill = b.item.kind === 'skill' && b.item.availability.status !== 'available';
    if (aUnavailableSkill !== bUnavailableSkill) return aUnavailableSkill ? 1 : -1;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return paletteDefaultTiebreak(a.item, b.item);
  });

  const orderedItems = scored.map((entry) => entry.item);
  const sections: PaletteSection[] = [];
  const skills = orderedItems.filter((item) => item.kind === 'skill');
  const commands = orderedItems.filter((item) => item.kind === 'command');
  const agents = orderedItems.filter((item) => item.kind === 'agent');
  if (skills.length > 0) sections.push({ kind: 'skill', items: skills });
  if (commands.length > 0) sections.push({ kind: 'command', items: commands });
  if (agents.length > 0) sections.push({ kind: 'agent', items: agents });

  const flatItems: PaletteItem[] = [];
  for (const section of sections) flatItems.push(...section.items);
  return { sections, flatItems };
}

export function useCommandPalette(
  value: string,
  cursor: number,
  options?: {
    suppress?: boolean;
    isComposing?: boolean;
    currentAgentId?: string;
    conversationId?: string | null;
  },
) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [skillsVersion, setSkillsVersion] = useState(0);
  const language = useLocaleStore((s) => s.language);

  const slashRange = useMemo(
    () => (options?.isComposing ? null : detectSlashRange(value, cursor)),
    [value, cursor, options?.isComposing],
  );
  const paletteActive = Boolean(slashRange && !options?.suppress);

  useEffect(() => {
    const onConfigReload = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (
        detail &&
        typeof detail === 'object' &&
        'section' in detail &&
        ((detail as { section?: unknown }).section === 'skills' ||
          (detail as { section?: unknown }).section === 'agents')
      ) {
        setSkillsVersion((v) => v + 1);
      }
    };
    window.addEventListener('config-reload', onConfigReload);
    return () => window.removeEventListener('config-reload', onConfigReload);
  }, []);

  const itemsResource = useAsyncResource(
    async () => {
      const [commandsResult, skillsResult, agentsResult] = await Promise.allSettled([
        fetchCommandsCached(),
        getChatSkillsCached(options?.currentAgentId, options?.conversationId),
        fetchChatAgents(),
      ]);
      const failedKinds: PaletteItemKind[] = [];
      if (skillsResult.status === 'rejected') failedKinds.push('skill');
      if (commandsResult.status === 'rejected') failedKinds.push('command');
      if (agentsResult.status === 'rejected') failedKinds.push('agent');

      const commandItems: PaletteItem[] = (commandsResult.status === 'fulfilled' ? commandsResult.value : []).map((c) => ({
        kind: 'command' as const,
        id: `cmd:${c.id}`,
        name: c.name,
        description: c.description,
        category: c.category,
        aliases: c.aliases,
        acceptsArgs: c.acceptsArgs,
        acceptsContext: c.acceptsContext,
        examples: c.examples,
      }));
      const skillItems: PaletteItem[] = (skillsResult.status === 'fulfilled' ? skillsResult.value.skills : []).map((s) => {
        const presentation = resolveSkillPresentation(s, language);
        return {
          kind: 'skill' as const,
          id: `skill:${s.name}`,
          name: presentation.displayName,
          canonicalName: s.name,
          description: presentation.description,
          aliases: presentation.aliases,
          searchTerms: presentation.searchTerms,
          category: 'skill',
          source: s.source,
          availability: {
            status: s.availableForCurrentAgent ? 'available' : (s.unavailableReason ?? 'agent-denied'),
            reason: s.unavailableReason ?? undefined,
          },
        };
      });
      // Agents: only when there is more than one (matches header `showChatAgentSelector`).
      const agentsMessages = messages(language).agentsSettings;
      const agentsPayload = agentsResult.status === 'fulfilled' ? agentsResult.value : null;
      const agentItems: PaletteItem[] =
        agentsPayload && agentsPayload.items.length > 1
          ? agentsPayload.items.map((a) => ({
              kind: 'agent' as const,
              id: `agent:${a.id}`,
              agentId: a.id,
              name: agentListDisplayName(a, agentsMessages),
              description: agentListDisplayDescription(a, agentsMessages),
              category: 'agent',
              ...(a.avatar ? { avatar: a.avatar } : {}),
              aliases: [a.id, ...(a.name ? [a.name] : [])],
            }))
          : [];
      return { items: [...skillItems, ...commandItems, ...agentItems], failedKinds };
    },
    [language, options?.currentAgentId, options?.conversationId, skillsVersion],
    {
      enabled: paletteActive,
      initial: { items: [] as PaletteItem[], failedKinds: [] as PaletteItemKind[] },
      errorData: { items: [] as PaletteItem[], failedKinds: [] as PaletteItemKind[] },
    },
  );
  const allItems = itemsResource.data.items;
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

  const { sections, flatItems } = useMemo(
    () => buildPaletteSections(allItems, { query, value, commandsAllowed, agentsAllowed }),
    [allItems, commandsAllowed, agentsAllowed, query, value],
  );

  const selectionKey = slashRange ? query : '';
  const trackedSelectionKeyRef = useRef(selectionKey);
  if (trackedSelectionKeyRef.current !== selectionKey) {
    trackedSelectionKeyRef.current = selectionKey;
    if (selectedIndex !== 0) {
      setSelectedIndex(0);
    }
  }
  const resolvedSelectedIndex = clampPaletteIndex(selectedIndex, flatItems.length);

  const onNavigate = useCallback(
    (dir: 'up' | 'down') => {
      if (flatItems.length === 0) return;
      setSelectedIndex((i) => {
        if (dir === 'down') return (i + 1) % flatItems.length;
        return (i - 1 + flatItems.length) % flatItems.length;
      });
    },
    [flatItems.length],
  );

  return {
    open: paletteActive,
    slashRange,
    /** False when `/` is not at position 0 - palette may still list skills. */
    commandsAllowed,
    /** False when `/` is not at position 0 - agents are sentence-level switches. */
    agentsAllowed,
    sections,
    flatItems,
    selectedIndex: resolvedSelectedIndex,
    query,
    loading: itemsResource.loading,
    failedKinds: itemsResource.data.failedKinds,
    loadError,
    onNavigate,
    setSelectedIndex,
  };
}
