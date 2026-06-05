import { Clock, GitBranch, Layers, Plug, Users } from 'lucide-react';

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
  | 'builtin:skills'
  | 'builtin:cron'
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
  { id: 'builtin:agents', to: '/agents', Icon: Users },
  { id: 'builtin:skills', to: '/skills', Icon: Layers },
  { id: 'builtin:cron', to: '/cron', Icon: Clock },
  { id: 'builtin:workflows', to: '/workflows', Icon: GitBranch },
  { id: 'builtin:channels', to: '/channels', Icon: Plug },
] as const;

/** Cap on visible rail rows excluding the "New chat" button at the top. */
export const VISIBLE_NAV_CAP = 5;
/** When overflowing, the last visible slot becomes the "More" button. */
export const VISIBLE_NAV_WHEN_OVERFLOW = 4;

export type ReconciledNav = {
  visible: NavItem[];
  overflow: NavItem[];
  hasOverflow: boolean;
};

/**
 * Merge stored user order with live available items, then split into visible
 * vs overflow according to {@link VISIBLE_NAV_CAP}.
 *
 * - Items in `storedOrder` no longer present in `available` are silently dropped.
 * - Items in `available` not yet in `storedOrder` are appended at the end
 *   (so newly-installed extensions land in overflow if the rail is already
 *   at capacity — the user can drag them up).
 */
export function reconcileNavOrder(
  available: readonly NavItem[],
  storedOrder: readonly string[],
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

  if (ordered.length <= VISIBLE_NAV_CAP) {
    return { visible: ordered, overflow: [], hasOverflow: false };
  }
  return {
    visible: ordered.slice(0, VISIBLE_NAV_WHEN_OVERFLOW),
    overflow: ordered.slice(VISIBLE_NAV_WHEN_OVERFLOW),
    hasOverflow: true,
  };
}
