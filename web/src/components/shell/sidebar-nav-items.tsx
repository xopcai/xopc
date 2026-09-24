import * as Popover from '@radix-ui/react-popover';
import { Boxes, BriefcaseBusiness, Layers3, MoreHorizontal, Puzzle, Zap } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { DragEvent, KeyboardEvent, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { useUiExtensions } from '@/features/extensions/extension-provider';
import { resolveLucideIcon } from '@/features/extensions/extension-nav-icon';
import { extensionPagePath } from '@/features/extensions/extension-paths';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { preloadRouteForPath } from '@/lib/route-preload';
import {
  PRODUCT_DOMAINS,
  productDomainAtPath,
  type ProductDomainId,
} from '@/navigation/product-navigation';
import { reconcileNavOrder, type NavItem } from '@/navigation/sidebar-nav-items';
import { useLocaleStore } from '@/stores/locale-store';
import { useNavOrderStore } from '@/stores/nav-order-store';

const DRAG_MIME = 'text/plain';
const DRAG_PREFIX = 'xopc-nav:';

const DOMAIN_ICONS = {
  work: BriefcaseBusiness,
  automation: Zap,
  capabilities: Layers3,
  apps: Boxes,
} as const satisfies Record<ProductDomainId, typeof BriefcaseBusiness>;

function parseDragPayload(raw: string): string | null {
  return raw.startsWith(DRAG_PREFIX) ? raw.slice(DRAG_PREFIX.length) : null;
}

function dropPosition(event: DragEvent<HTMLElement>): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function rowClass(
  collapsed: boolean,
  active: boolean,
  dragging: boolean,
  dropHint: 'before' | 'after' | null,
  popover = false,
): string {
  return cn(
    'group relative flex w-full items-center text-sm font-medium transition-colors duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
    popover
      ? 'gap-2 rounded-md px-2 py-1.5 text-left leading-5'
      : collapsed
        ? 'justify-center rounded-xl p-2.5 leading-6'
        : 'gap-2 rounded-lg px-3 py-2.5 text-left leading-6 md:py-1.5',
    active ? 'bg-surface-active text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
    dragging && 'opacity-40',
    dropHint === 'before' && 'shadow-[inset_0_2px_0_0_var(--color-accent)]',
    dropHint === 'after' && 'shadow-[inset_0_-2px_0_0_var(--color-accent)]',
  );
}

function NavIcon({ item }: { item: NavItem }) {
  const Icon = item.Icon;
  if (Icon) return <Icon className="size-4 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />;
  return (
    <span className="flex size-4 shrink-0 items-center justify-center text-[10px] font-bold opacity-70" aria-hidden>
      {(item.letter ?? item.label.charAt(0)).toUpperCase()}
    </span>
  );
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
  const { pathname } = useLocation();
  const language = useLocaleStore((state) => state.language);
  const m = messages(language);
  const activeDomain = productDomainAtPath(pathname);
  const uiExtensions = useUiExtensions();
  const order = useNavOrderStore((state) => state.order);
  const setOrder = useNavOrderStore((state) => state.setOrder);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverTarget, setHoverTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);
  const [moreHover, setMoreHover] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const available = useMemo<NavItem[]>(() => {
    const products = PRODUCT_DOMAINS.map((domain): NavItem => ({
      id: `product:${domain.id}`,
      kind: 'product',
      label: m.productNavigation.domains[domain.id],
      to: domain.path,
      Icon: DOMAIN_ICONS[domain.id],
    }));
    const extensions: NavItem[] = [];
    for (const extension of uiExtensions) {
      if (extension.activationEligible === false) continue;
      for (const page of extension.ui?.contributions?.pages ?? []) {
        if (!page.showInNav) continue;
        extensions.push({
          id: `extension:${extension.id}:${page.id}`,
          kind: 'extension',
          label: page.title,
          to: extensionPagePath(extension.id, page),
          Icon: page.navIcon ? resolveLucideIcon(page.navIcon) ?? Puzzle : Puzzle,
          letter: page.title.charAt(0),
          title: page.title,
        });
      }
    }
    return [...products, ...extensions];
  }, [m.productNavigation.domains, uiExtensions]);

  const reconciled = useMemo(
    () => reconcileNavOrder(available, order, visibleLimit),
    [available, order, visibleLimit],
  );
  const orderedItems = useMemo(
    () => [...reconciled.visible, ...reconciled.overflow],
    [reconciled.overflow, reconciled.visible],
  );
  const orderedIds = useMemo(() => orderedItems.map((item) => item.id), [orderedItems]);

  const finishDrag = useCallback(() => {
    setDraggingId(null);
    setHoverTarget(null);
    setMoreHover(false);
  }, []);

  const moveRelative = useCallback((fromId: string, toId: string, position: 'before' | 'after') => {
    if (fromId === toId) return;
    const next = orderedIds.filter((id) => id !== fromId);
    const targetIndex = next.indexOf(toId);
    if (targetIndex < 0) return;
    const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
    setOrder([...next.slice(0, insertIndex), fromId, ...next.slice(insertIndex)]);
  }, [orderedIds, setOrder]);

  const onDragStart = useCallback((id: string) => (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.setData(DRAG_MIME, `${DRAG_PREFIX}${id}`);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingId(id);
  }, []);

  const onRowDragOver = useCallback((id: string) => (event: DragEvent<HTMLElement>) => {
    if (!draggingId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const position = dropPosition(event);
    setHoverTarget((current) => current?.id === id && current.position === position
      ? current
      : { id, position });
  }, [draggingId]);

  const onRowDrop = useCallback((id: string) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const dragged = parseDragPayload(event.dataTransfer.getData(DRAG_MIME));
    if (dragged) moveRelative(dragged, id, dropPosition(event));
    finishDrag();
  }, [finishDrag, moveRelative]);

  const onItemKeyDown = useCallback((id: string) => (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const index = orderedIds.indexOf(id);
    const targetIndex = event.key === 'ArrowUp' ? index - 1 : index + 1;
    const target = orderedIds[targetIndex];
    if (target) moveRelative(id, target, event.key === 'ArrowUp' ? 'before' : 'after');
  }, [moveRelative, orderedIds]);

  const isActive = useCallback((item: NavItem) => item.kind === 'product'
    ? activeDomain === item.id.slice('product:'.length)
    : pathname === item.to || pathname.startsWith(`${item.to}/`), [activeDomain, pathname]);

  function renderRow(item: NavItem, inPopover = false): ReactNode {
    const active = isActive(item);
    const dragging = draggingId === item.id;
    const hint = hoverTarget?.id === item.id ? hoverTarget.position : null;
    return (
      <Link
        key={item.id}
        to={item.to}
        draggable
        aria-current={active ? 'page' : undefined}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        className={rowClass(collapsed, active, dragging, hint, inPopover)}
        title={item.title ?? item.label}
        onDragStart={onDragStart(item.id)}
        onDragEnd={finishDrag}
        onDragOver={onRowDragOver(item.id)}
        onDrop={onRowDrop(item.id)}
        onKeyDown={onItemKeyDown(item.id)}
        onMouseEnter={() => preloadRouteForPath(item.to)}
        onFocus={() => preloadRouteForPath(item.to)}
        onClick={() => {
          setPopoverOpen(false);
          onNavigate?.();
        }}
      >
        <NavIcon item={item} />
        {!collapsed || inPopover ? <span className="truncate">{item.label}</span> : null}
      </Link>
    );
  }

  const overflowProducts = reconciled.overflow.filter((item) => item.kind === 'product');
  const overflowExtensions = reconciled.overflow.filter((item) => item.kind === 'extension');

  return (
    <>
      {reconciled.visible.map((item) => renderRow(item))}
      {reconciled.hasOverflow ? (
        <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label={m.sidebar.moreAppsAria}
              title={m.sidebar.moreApps}
              className={cn(
                'flex w-full items-center text-sm font-medium leading-6 transition-colors duration-200 ease-out',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
                collapsed ? 'justify-center rounded-xl p-2.5' : 'gap-2 rounded-lg px-3 py-2.5 text-left md:py-1.5',
                popoverOpen ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                moreHover && 'ring-2 ring-accent ring-offset-2 ring-offset-surface-base',
              )}
              onDragOver={(event) => {
                if (!draggingId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setMoreHover(true);
              }}
              onDragLeave={() => setMoreHover(false)}
              onDrop={(event) => {
                event.preventDefault();
                const dragged = parseDragPayload(event.dataTransfer.getData(DRAG_MIME));
                if (dragged) setOrder([...orderedIds.filter((id) => id !== dragged), dragged]);
                finishDrag();
              }}
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
              className="z-50 min-w-[14rem] max-w-[20rem] rounded-lg border border-edge bg-surface-panel p-1 shadow-md"
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              <nav className="flex flex-col gap-1" aria-label={m.sidebar.moreAppsAria}>
                {([
                  [m.sidebar.moreGroupProducts, overflowProducts],
                  [m.sidebar.moreGroupExtensions, overflowExtensions],
                ] as const).map(([label, items]) => items.length > 0 ? (
                  <section key={label}>
                    <h3 className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                      {label}
                    </h3>
                    <div className="flex flex-col gap-0.5">{items.map((item) => renderRow(item, true))}</div>
                  </section>
                ) : null)}
              </nav>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
    </>
  );
}
