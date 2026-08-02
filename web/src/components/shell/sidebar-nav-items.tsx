import * as Popover from '@radix-ui/react-popover';
import { MoreHorizontal } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useNavOrderStore } from '@/stores/nav-order-store';
import { cn } from '@/lib/cn';
import { preloadRouteForPath } from '@/lib/route-preload';

import { useUiExtensions } from '@/features/extensions/extension-provider';
import { extensionPagePath } from '@/features/extensions/extension-paths';
import { resolveLucideIcon } from '@/features/extensions/extension-nav-icon';
import type { ExtensionUiInfo } from '@/features/extensions/types';

import {
  BUILTIN_NAV_DEFS,
  reconcileNavOrder,
  type NavItem,
} from '@/navigation/sidebar-nav-items';

const DRAG_MIME = 'text/plain';
const DT_PREFIX = 'xopc-nav:';

function dragPayload(id: string): string {
  return `${DT_PREFIX}${id}`;
}

function parseDragPayload(raw: string): string | null {
  if (!raw.startsWith(DT_PREFIX)) return null;
  return raw.slice(DT_PREFIX.length);
}

/** Insert before/after based on cursor Y relative to the row midpoint. */
function dropPosition(event: DragEvent<HTMLElement>): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function navRowClass(
  { isActive }: { isActive: boolean },
  collapsed: boolean,
  dragging: boolean,
  dropHint: 'before' | 'after' | null,
) {
  return cn(
    'group relative flex w-full items-center text-sm font-medium leading-6 transition-colors duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
    collapsed ? 'justify-center rounded-xl p-2.5' : 'gap-2 rounded-lg px-3 py-2 text-left',
    isActive ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
    dragging && 'opacity-40',
    dropHint === 'before' && 'shadow-[inset_0_2px_0_0_var(--color-accent)]',
    dropHint === 'after' && 'shadow-[inset_0_-2px_0_0_var(--color-accent)]',
  );
}

function popoverRowClass(
  { isActive }: { isActive: boolean },
  dragging: boolean,
  dropHint: 'before' | 'after' | null,
) {
  return cn(
    'group relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium leading-5 transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    isActive ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
    dragging && 'opacity-40',
    dropHint === 'before' && 'shadow-[inset_0_2px_0_0_var(--color-accent)]',
    dropHint === 'after' && 'shadow-[inset_0_-2px_0_0_var(--color-accent)]',
  );
}

function NavIcon({ item, collapsed }: { item: NavItem; collapsed?: boolean }) {
  const { Icon, letter } = item;
  const size = collapsed ? 'size-4' : 'size-4';
  if (Icon) {
    return <Icon className={cn(size, 'shrink-0 opacity-90')} strokeWidth={1.75} aria-hidden />;
  }
  return (
    <span
      className={cn(size, 'flex shrink-0 items-center justify-center text-[10px] font-bold opacity-70')}
      aria-hidden
    >
      {(letter ?? item.label.charAt(0)).toUpperCase()}
    </span>
  );
}

function collectExtensionNavItems(extensions: readonly ExtensionUiInfo[]): NavItem[] {
  const out: NavItem[] = [];
  for (const extension of extensions) {
    // Hide nav entries the user has explicitly turned off, even while the
    // gateway process keeps the extension loaded pending a restart. See
    // `extensionUiUnlocked()` in extension-provider.tsx: it intentionally
    // keeps `active && !activationEligible` extensions visible to other
    // surfaces (command palette, /extensions), so we narrow the rule here.
    if (extension.activationEligible === false) continue;
    const pages = extension.ui?.contributions?.pages;
    if (!pages) continue;
    for (const page of pages) {
      if (!page.showInNav) continue;
      const Icon = page.navIcon ? resolveLucideIcon(page.navIcon) : undefined;
      out.push({
        id: `ext:${extension.id}:${page.id}`,
        kind: 'extension',
        label: page.title,
        to: extensionPagePath(extension.id, page),
        Icon,
        letter: page.title.charAt(0),
        title: page.title,
      });
    }
  }
  return out;
}

export function SidebarNavItems({
  collapsed = false,
  onNavigate,
  visibleLimit,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  visibleLimit?: number;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const uiExtensions = useUiExtensions();
  const order = useNavOrderStore((s) => s.order);
  const move = useNavOrderStore((s) => s.move);
  const moveToEnd = useNavOrderStore((s) => s.moveToEnd);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverTarget, setHoverTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);
  const [moreHover, setMoreHover] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const available = useMemo<NavItem[]>(() => {
    const builtins: NavItem[] = BUILTIN_NAV_DEFS.map((def) => {
      const labelKey = def.id.slice('builtin:'.length) as 'profile' | 'agents' | 'work' | 'projects' | 'localApps' | 'goals' | 'skills' | 'connectors' | 'automations' | 'browserWorkflows' | 'notes' | 'workflows' | 'channels' | 'extensions';
      return {
        id: def.id,
        kind: 'builtin',
        label: m.nav[labelKey],
        to: def.to,
        Icon: def.Icon,
      };
    });
    const ext = collectExtensionNavItems(uiExtensions);
    return [...builtins, ...ext];
  }, [m, uiExtensions]);

  const reconciled = useMemo(
    () => reconcileNavOrder(available, order, visibleLimit),
    [available, order, visibleLimit],
  );

  const onDragStart = useCallback((id: string) => (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.setData(DRAG_MIME, dragPayload(id));
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(id);
  }, []);

  const onDragEnd = useCallback(() => {
    setDraggingId(null);
    setHoverTarget(null);
    setMoreHover(false);
  }, []);

  const onRowDragOver = useCallback((id: string) => (e: DragEvent<HTMLElement>) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const position = dropPosition(e);
    if (hoverTarget?.id === id && hoverTarget.position === position) return;
    setHoverTarget({ id, position });
  }, [draggingId, hoverTarget]);

  const onRowDrop = useCallback((id: string) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DRAG_MIME);
    const dragged = parseDragPayload(raw);
    if (!dragged || dragged === id) {
      onDragEnd();
      return;
    }
    move(dragged, id, dropPosition(e));
    onDragEnd();
  }, [move, onDragEnd]);

  const onMoreDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setMoreHover(true);
  }, [draggingId]);

  const onMoreDragLeave = useCallback(() => setMoreHover(false), []);

  const onMoreDrop = useCallback((e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DRAG_MIME);
    const dragged = parseDragPayload(raw);
    if (dragged) moveToEnd(dragged);
    onDragEnd();
  }, [moveToEnd, onDragEnd]);

  const onNavIntent = useCallback((to: string) => {
    preloadRouteForPath(to);
  }, []);

  function renderRailRow(item: NavItem): ReactNode {
    const dragging = draggingId === item.id;
    const dropHint = hoverTarget?.id === item.id ? hoverTarget.position : null;
    return (
      <NavLink
        key={item.id}
        to={item.to}
        draggable
        onDragStart={onDragStart(item.id)}
        onDragEnd={onDragEnd}
        onDragOver={onRowDragOver(item.id)}
        onDrop={onRowDrop(item.id)}
        className={(props) => navRowClass(props, collapsed, dragging, dropHint)}
        title={item.title ?? item.label}
        onMouseEnter={() => onNavIntent(item.to)}
        onFocus={() => onNavIntent(item.to)}
        onClick={() => onNavigate?.()}
      >
        <NavIcon item={item} collapsed={collapsed} />
        {!collapsed ? <span className="truncate">{item.label}</span> : null}
      </NavLink>
    );
  }

  function renderMoreButton(): ReactNode {
    return (
      <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            onDragOver={onMoreDragOver}
            onDragLeave={onMoreDragLeave}
            onDrop={onMoreDrop}
            className={cn(
              'flex w-full items-center text-sm font-medium leading-6 transition-colors duration-200 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
              collapsed ? 'justify-center rounded-xl p-2.5' : 'gap-2 rounded-lg px-3 py-2 text-left',
              popoverOpen
                ? 'bg-surface-hover text-fg'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              moreHover && 'ring-2 ring-accent ring-offset-2 ring-offset-surface-base',
            )}
            aria-label={m.sidebar.moreAppsAria}
            title={m.sidebar.moreApps}
          >
            <MoreHorizontal className="size-4 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
            {!collapsed ? <span className="truncate">{m.sidebar.moreApps}</span> : null}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="right"
            align="start"
            sideOffset={8}
            collisionPadding={8}
            className={cn(
              'z-50 min-w-[14rem] max-w-[20rem] rounded-lg border border-edge bg-surface-panel p-1 shadow-md',
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <ul className="flex flex-col gap-0.5" role="list" aria-label={m.sidebar.moreAppsAria}>
              {reconciled.overflow.map((item) => {
                const dragging = draggingId === item.id;
                const dropHint = hoverTarget?.id === item.id ? hoverTarget.position : null;
                return (
                  <li key={item.id} className="contents">
                    <NavLink
                      to={item.to}
                      draggable
                      onDragStart={onDragStart(item.id)}
                      onDragEnd={onDragEnd}
                      onDragOver={onRowDragOver(item.id)}
                      onDrop={onRowDrop(item.id)}
                      className={(props) => popoverRowClass(props, dragging, dropHint)}
                      title={item.title ?? item.label}
                      onMouseEnter={() => onNavIntent(item.to)}
                      onFocus={() => onNavIntent(item.to)}
                      onClick={() => {
                        setPopoverOpen(false);
                        onNavigate?.();
                      }}
                    >
                      <NavIcon item={item} />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return (
    <>
      {reconciled.visible.map(renderRailRow)}
      {reconciled.hasOverflow ? renderMoreButton() : null}
    </>
  );
}
