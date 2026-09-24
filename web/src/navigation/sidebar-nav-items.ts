import type { LucideIcon } from '@/features/extensions/extension-nav-icon';

export type NavItemKind = 'product' | 'extension';

export type NavItem = {
  id: string;
  kind: NavItemKind;
  label: string;
  to: string;
  Icon: LucideIcon | undefined;
  letter?: string;
  title?: string;
};

/** Adjustable shortcut-row bounds, excluding "New chat" and "More". */
export const MIN_VISIBLE_NAV_ITEMS = 2;
export const DEFAULT_VISIBLE_NAV_ITEMS = 5;
export const MAX_VISIBLE_NAV_ITEMS = 5;

export type ReconciledNav = {
  visible: NavItem[];
  overflow: NavItem[];
  hasOverflow: boolean;
};

/** Merge a saved order with currently available product and extension entries. */
export function reconcileNavOrder(
  available: readonly NavItem[],
  storedOrder: readonly string[],
  visibleLimit: number = DEFAULT_VISIBLE_NAV_ITEMS,
): ReconciledNav {
  const byId = new Map(available.map((item) => [item.id, item]));
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

  const limit = Math.min(
    MAX_VISIBLE_NAV_ITEMS,
    Math.max(MIN_VISIBLE_NAV_ITEMS, Math.round(visibleLimit)),
  );
  return ordered.length <= limit
    ? { visible: ordered, overflow: [], hasOverflow: false }
    : { visible: ordered.slice(0, limit), overflow: ordered.slice(limit), hasOverflow: true };
}
