import { Box, CircleDotDashed, FolderKanban, GitBranch, Home, Layers, MonitorPlay, Plug, StickyNote, Users, Zap } from 'lucide-react';

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
  | 'builtin:agents'
  | 'builtin:capabilities'
  | 'builtin:localApps'
  | 'builtin:scenes'
  | 'builtin:home'
  | 'builtin:projects'
  | 'builtin:automations'
  | 'builtin:browserAutomations'
  | 'builtin:notes'
  | 'builtin:workflows'
  | 'builtin:channels';

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
  { id: 'builtin:home', to: '/', Icon: Home },
  { id: 'builtin:capabilities', to: '/capabilities/discover', Icon: Layers },
  { id: 'builtin:automations', to: '/automations', Icon: Zap },
  { id: 'builtin:projects', to: '/projects', Icon: FolderKanban },
  { id: 'builtin:notes', to: '/notes', Icon: StickyNote },
  { id: 'builtin:agents', to: '/agents', Icon: Users },
  { id: 'builtin:channels', to: '/channels', Icon: Plug },
  { id: 'builtin:workflows', to: '/workflows', Icon: GitBranch },
  { id: 'builtin:browserAutomations', to: '/browser-automations', Icon: MonitorPlay },
  { id: 'builtin:localApps', to: '/local-apps', Icon: Box },
  { id: 'builtin:scenes', to: '/scenes', Icon: CircleDotDashed },
] as const;

export function builtinNavDefsForFeatures(scenesEnabled: boolean): readonly BuiltinNavDef[] {
  return scenesEnabled
    ? BUILTIN_NAV_DEFS
    : BUILTIN_NAV_DEFS.filter((item) => item.id !== 'builtin:scenes');
}

/** Product-level destinations shown by default; advanced capabilities live under More. */
export const PRIMARY_NAV_IDS = [
  'builtin:home',
  'builtin:capabilities',
  'builtin:automations',
  'builtin:projects',
  'builtin:notes',
] as const satisfies readonly BuiltinNavId[];

/** Adjustable shortcut-row bounds, excluding "New chat" and "More". */
export const MIN_VISIBLE_NAV_ITEMS = 2;
export const DEFAULT_VISIBLE_NAV_ITEMS = PRIMARY_NAV_IDS.length;
export const MAX_VISIBLE_NAV_ITEMS = 5;

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
  visibleLimit: number = DEFAULT_VISIBLE_NAV_ITEMS,
): ReconciledNav {
  const byId = new Map<string, NavItem>();
  for (const item of available) byId.set(item.id, item);

  const ordered: NavItem[] = [];
  const seen = new Set<string>();
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
