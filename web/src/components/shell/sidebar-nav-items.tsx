import * as Popover from '@radix-ui/react-popover';
import {
  Archive,
  Boxes,
  BriefcaseBusiness,
  Layers3,
  MoreHorizontal,

  Puzzle,
  Zap,
} from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { Link, matchPath, useLocation } from 'react-router-dom';

import { useUiExtensions } from '@/features/extensions/extension-provider';
import { usePersonalProfile } from '@/features/personal-agent/use-personal-profile';
import { personalUnreadLabel, usePersonalUnread } from '@/features/personal-agent/use-personal-unread';
import { PersonalAvatar } from '@/features/personal-agent/personal-avatar';
import { resolveLucideIcon, type LucideIcon } from '@/features/extensions/extension-nav-icon';
import { extensionPagePath } from '@/features/extensions/extension-paths';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { preloadRouteForPath } from '@/lib/route-preload';
import {
  PRODUCT_DOMAINS,
  productDomainAtPath,
  type ProductDomainId,
} from '@/navigation/product-navigation';
import { useLocaleStore } from '@/stores/locale-store';
import { useNavOrderStore } from '@/stores/nav-order-store';

const DRAG_MIME = 'application/x-xopc-sidebar-nav';
export const DEFAULT_VISIBLE_NAV_ITEMS = 4;
const SPACE_NAV_ID = 'builtin:space';
const SIDEBAR_DOMAIN_IDS = ['work', 'capabilities', 'automation', 'apps'] as const;

const DOMAIN_ICONS = {
  work: BriefcaseBusiness,
  capabilities: Layers3,
  automation: Zap,
  apps: Boxes,
} as const satisfies Partial<Record<ProductDomainId, LucideIcon>>;

type MenuItem = {
  id: string;
  label: string;
  to: string;
  Icon: LucideIcon;
  active: boolean;
};

function rowClass(collapsed: boolean, active: boolean, popover = false): string {
  return cn(
    'flex w-full items-center text-sm font-medium transition-colors duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
    popover
      ? 'gap-2 rounded-md px-2 py-1.5 text-left leading-5'
      : collapsed
        ? 'justify-center rounded-xl p-2.5 leading-6'
        : 'gap-2 rounded-lg px-3 py-2.5 text-left leading-6 md:py-1.5',
    active ? 'bg-surface-active text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
  );
}

function NavIcon({ Icon }: { Icon: LucideIcon }) {
  return <Icon className="size-4 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />;
}

export function SidebarNavItems({
  collapsed = false,
  onNavigate,
  visibleLimit = DEFAULT_VISIBLE_NAV_ITEMS,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  visibleLimit?: number;
}) {
  const { pathname } = useLocation();
  const language = useLocaleStore((state) => state.language);
  const m = messages(language);
  const copy = m.productNavigation;
  const activeDomain = matchPath('/chat/*', pathname) ? null : productDomainAtPath(pathname);
  const uiExtensions = useUiExtensions();
  const { profile, displayName } = usePersonalProfile();
  const personalUnreadCount = usePersonalUnread();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const order = useNavOrderStore((state) => state.order);
  const setOrder = useNavOrderStore((state) => state.setOrder);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; after: boolean } | null>(null);
  const builtins: MenuItem[] = SIDEBAR_DOMAIN_IDS.map((domainId) => {
    const domain = PRODUCT_DOMAINS.find((item) => item.id === domainId)!;
    return {
      id: `builtin:${domainId === 'automation' ? 'automations' : domainId === 'apps' ? 'localApps' : domainId}`,
      label: copy.domains[domainId],
      to: domain.path,
      Icon: DOMAIN_ICONS[domainId],
      active: activeDomain === domainId,
    };
  });
  const extensionItems: MenuItem[] = uiExtensions.flatMap((extension) => {
    if (extension.activationEligible === false) return [];
    return (extension.ui?.contributions?.pages ?? [])
      .filter((page) => page.showInNav)
      .map((page) => {
        const to = extensionPagePath(extension.id, page);
        return {
          id: `ext:${extension.id}:${page.id}`,
          label: page.title,
          to,
          Icon: page.navIcon ? resolveLucideIcon(page.navIcon) ?? Puzzle : Puzzle,
          active: pathname === to || pathname.startsWith(`${to}/`),
        };
      });
  });
  const space: MenuItem = { id: SPACE_NAV_ID, label: copy.space, to: '/space', Icon: Archive, active: pathname === '/space' };
  const shortcuts = [...builtins, ...extensionItems];
  const byId = new Map([...shortcuts, space].map((item) => [item.id, item]));
  const orderedIds = [...new Set([...order, ...shortcuts.map(item => item.id)])].filter((id) => byId.has(id));
  if (!order.includes(SPACE_NAV_ID)) {
    orderedIds.splice(orderedIds.indexOf('builtin:work') + 1, 0, SPACE_NAV_ID);
  }
  const ordered = orderedIds.map((id) => byId.get(id)!);
  const limit = Number.isFinite(visibleLimit)
    ? Math.min(ordered.length, Math.max(1, Math.round(visibleLimit)))
    : DEFAULT_VISIBLE_NAV_ITEMS;
  const visibleItems = ordered.slice(0, limit);
  const overflow = ordered.slice(limit);
  const overflowItems = overflow.filter((item) => !item.id.startsWith('ext:'));
  const overflowExtensions = overflow.filter((item) => item.id.startsWith('ext:'));
  const overflowActive = overflow.some((item) => item.active);

  const endDrag = () => {
    setDraggingId(null);
    setDropHint(null);
  };
  const isAfter = (event: DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY >= rect.top + rect.height / 2;
  };
  const drop = (event: DragEvent<HTMLElement>, targetId?: string) => {
    const id = event.dataTransfer.getData(DRAG_MIME);
    if (!draggingId || id !== draggingId || !byId.has(id)) return;
    event.preventDefault();
    if (id !== targetId) {
      const next = orderedIds.filter((existing) => existing !== id);
      const index = targetId ? next.indexOf(targetId) + (isAfter(event) ? 1 : 0) : next.length;
      next.splice(index, 0, id);
      // Retain unavailable extensions so temporarily disabling one preserves its preference.
      setOrder([...next, ...order.filter((existing) => !byId.has(existing))]);
    }
    endDrag();
    setPopoverOpen(false);
  };

  const renderLink = (item: MenuItem, inPopover = false) => (
    <Link
      key={item.id}
      to={item.to}
      aria-current={item.active ? 'page' : undefined}
      aria-label={collapsed && !inPopover ? item.label : undefined}
      className={cn(
        rowClass(collapsed, item.active, inPopover),
        draggingId === item.id && 'opacity-40',
        dropHint?.id === item.id && (dropHint.after
          ? 'shadow-[inset_0_-2px_0_0_var(--color-accent)]'
          : 'shadow-[inset_0_2px_0_0_var(--color-accent)]'),
      )}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_MIME, item.id);
        event.dataTransfer.effectAllowed = 'move';
        setDraggingId(item.id);
      }}
      onDragEnd={endDrag}
      onDragOver={(event) => {
        if (!draggingId || draggingId === item.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropHint({ id: item.id, after: isAfter(event) });
      }}
      onDragLeave={() => setDropHint(null)}
      onDrop={(event) => drop(event, item.id)}
      title={item.label}
      onMouseEnter={() => preloadRouteForPath(item.to)}
      onFocus={() => preloadRouteForPath(item.to)}
      onClick={() => {
        setPopoverOpen(false);
        onNavigate?.();
      }}
    >
      <NavIcon Icon={item.Icon} />
      {!collapsed || inPopover ? <span className="truncate">{item.label}</span> : null}
    </Link>
  );

  return (
    <>
      <Link
        to="/personal"
        aria-current={pathname === '/personal' ? 'page' : undefined}
        className={cn('relative', rowClass(collapsed, pathname === '/personal'))}
        title={displayName}
        onMouseEnter={() => preloadRouteForPath('/personal')}
        onFocus={() => preloadRouteForPath('/personal')}
        onClick={onNavigate}
      >
        <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
          <PersonalAvatar appearance={profile?.appearance ?? 'loopi'} agentId={profile?.agentId} className="size-5" />
        </span>
        {!collapsed && <span className="min-w-0 flex-1 truncate">{displayName}</span>}
        {personalUnreadCount > 0 && <span
          aria-label={language === 'zh' ? `${personalUnreadCount} 条未读消息` : `${personalUnreadCount} unread messages`}
          className={cn('shrink-0 rounded-full bg-accent/15 px-1.5 text-center text-[10px] font-semibold leading-5 tabular-nums text-accent',
            collapsed ? 'absolute right-0 top-0 min-w-4 leading-4' : 'min-w-5')}
        >{personalUnreadLabel(personalUnreadCount)}</span>}
      </Link>
      {visibleItems.map((item) => renderLink(item))}
      {overflow.length > 0 ? <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            onDragOver={(event) => {
              if (!draggingId) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDropHint({ id: 'more', after: false });
              setPopoverOpen(true);
            }}
            onDragLeave={() => setDropHint(null)}
            onDrop={(event) => drop(event)}
            aria-label={m.sidebar.moreAppsAria}
            title={m.sidebar.moreApps}
            className={cn(
              'flex w-full items-center text-sm font-medium leading-6 transition-colors duration-200 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
              collapsed ? 'justify-center rounded-xl p-2.5' : 'gap-2 rounded-lg px-3 py-2.5 text-left md:py-1.5',
              dropHint?.id === 'more' && 'ring-2 ring-accent',
              popoverOpen || overflowActive
                ? 'bg-surface-active text-fg'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
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
            className="z-50 max-h-[min(32rem,var(--radix-popover-content-available-height))] min-w-[14rem] max-w-[20rem] overflow-y-auto rounded-lg border border-edge bg-surface-overlay p-1 shadow-popover"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <nav className="flex flex-col gap-1" aria-label={m.sidebar.moreAppsAria}>
              {overflowItems.map((item) => renderLink(item, true))}
              {overflowExtensions.length > 0 ? (
                <section aria-labelledby="sidebar-more-extension-apps">
                  <div id="sidebar-more-extension-apps" className="px-2 pb-1 pt-1.5 text-[11px] font-semibold tracking-wide text-fg-subtle">
                    {m.sidebar.extensionAppsHeading}
                  </div>
                  <div className="flex flex-col gap-0.5">{overflowExtensions.map((item) => renderLink(item, true))}</div>
                </section>
              ) : null}
            </nav>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root> : null}
    </>
  );
}
