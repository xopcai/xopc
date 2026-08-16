import { Box, BriefcaseBusiness, Cable, FolderKanban, GitBranch, HeartHandshake, Layers, ListChecks, MonitorPlay, Plug, Puzzle, StickyNote, Users, Zap } from 'lucide-react';

import type { LucideIcon } from '@/features/extensions/extension-nav-icon';

export type NavItemKind = 'builtin' | 'extension';

export type NavItem = {
  id: string;
  kind: NavItemKind;
  label: string;
  to: string;
  Icon: LucideIcon | undefined;
  /** Fallback letter when no Lucide icon resolved (extensions only). */
  letter?: string;
  /** Optional title attribute when distinct from label (extensions). */
  title?: string;
};

export type BuiltinNavId =
  | 'builtin:profile'
  | 'builtin:agents'
  | 'builtin:skills'
  | 'builtin:connectors'
  | 'builtin:localApps'
  | 'builtin:work'
  | 'builtin:projects'
  | 'builtin:goals'
  | 'builtin:automations'
  | 'builtin:browserWorkflows'
  | 'builtin:notes'
  | 'builtin:workflows'
  | 'builtin:channels'
  | 'builtin:extensions';

export type BuiltinNavDef = {
  id: BuiltinNavId;
  to: string;
  Icon: LucideIcon;
};

/**
 * Built-in entries always offered to the user (subject to drag reorder).
 * Order here is the *initial* sequence shown to first-time users.
 */
export const BUILTIN_NAV_DEFS: readonly BuiltinNavDef[] = [
  { id: 'builtin:work', to: '/work', Icon: BriefcaseBusiness },
  { id: 'builtin:profile', to: '/you', Icon: HeartHandshake },
  { id: 'builtin:projects', to: '/projects', Icon: FolderKanban },
  { id: 'builtin:automations', to: '/automations', Icon: Zap },
  { id: 'builtin:skills', to: '/skills', Icon: Layers },
  { id: 'builtin:connectors', to: '/connectors', Icon: Cable },
  { id: 'builtin:agents', to: '/agents', Icon: Users },
  { id: 'builtin:notes', to: '/notes', Icon: StickyNote },
  { id: 'builtin:channels', to: '/channels', Icon: Plug },
  { id: 'builtin:goals', to: '/goals', Icon: ListChecks },
  { id: 'builtin:workflows', to: '/workflows', Icon: GitBranch },
  { id: 'builtin:browserWorkflows', to: '/browser-workflows', Icon: MonitorPlay },
  { id: 'builtin:localApps', to: '/local-apps', Icon: Box },
  { id: 'builtin:extensions', to: '/extensions', Icon: Puzzle },
] as const;

/** Product-level destinations that stay visible; advanced capabilities live under More. */
export const PRIMARY_NAV_IDS = [
  'builtin:work',
  'builtin:profile',
] as const satisfies readonly BuiltinNavId[];

export function isPrimaryNavId(id: string): boolean {
  return (PRIMARY_NAV_IDS as readonly string[]).includes(id);
}

export const MIN_VISIBLE_NAV_ITEMS = PRIMARY_NAV_IDS.length;
export const MAX_VISIBLE_NAV_ITEMS = 4;

export type ReconciledNav = {
  visible: NavItem[];
  overflow: NavItem[];
  hasOverflow: boolean;
};

/**
 * Merge stored user order with live available items, then split into visible
 * vs overflow according to the requested visible limit (clamped to 2–4).
 *
 * - Items in `storedOrder` no longer present in `available` are silently dropped.
 * - Items in `available` not yet in `storedOrder` are appended at the end
 *   (so newly-installed extensions land in overflow if the rail is already
 *   at capacity — the user can drag them up).
 */
export function reconcileNavOrder(
  available: readonly NavItem[],
  storedOrder: readonly string[],
  visibleLimit: number = MIN_VISIBLE_NAV_ITEMS,
): ReconciledNav {
  const byId = new Map<string, NavItem>();
  for (const item of available) byId.set(item.id, item);

  const ordered: NavItem[] = [];
  const seen = new Set<string>();
  for (const id of PRIMARY_NAV_IDS) {
    const item = byId.get(id);
    if (!item) continue;
    ordered.push(item);
    seen.add(id);
  }
  for (const id of storedOrder) {
    const item = byId.get(id);
    if (!item || seen.has(id)) continue;
    ordered.push(item);
    seen.add(id);
  }
  for (const item of available) {
    if (seen.has(item.id)) continue;
    ordered.push(item);
    seen.add(item.id);
  }

  const clampedVisibleLimit = Math.min(
    MAX_VISIBLE_NAV_ITEMS,
    Math.max(MIN_VISIBLE_NAV_ITEMS, Math.round(visibleLimit)),
  );
  if (ordered.length <= clampedVisibleLimit) {
    return { visible: ordered, overflow: [], hasOverflow: false };
  }
  return {
    visible: ordered.slice(0, clampedVisibleLimit),
    overflow: ordered.slice(clampedVisibleLimit),
    hasOverflow: true,
  };
}
