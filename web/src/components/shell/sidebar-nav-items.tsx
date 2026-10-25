import * as Popover from '@radix-ui/react-popover';
import {
  Boxes,
  BriefcaseBusiness,
  Layers3,
  MoreHorizontal,

  Puzzle,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

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

const DEFAULT_VISIBLE_ITEMS = 3;
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
  visibleLimit = DEFAULT_VISIBLE_ITEMS,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  visibleLimit?: number;
}) {
  const { pathname } = useLocation();
  const language = useLocaleStore((state) => state.language);
  const m = messages(language);
  const copy = m.productNavigation;
  const activeDomain = productDomainAtPath(pathname);
  const uiExtensions = useUiExtensions();
  const { profile, displayName } = usePersonalProfile();
  const personalUnreadCount = usePersonalUnread();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const builtins: MenuItem[] = SIDEBAR_DOMAIN_IDS.map((domainId) => {
    const domain = PRODUCT_DOMAINS.find((item) => item.id === domainId)!;
    return {
      id: domainId,
      label: copy.domains[domainId],
      to: domain.path,
      Icon: DOMAIN_ICONS[domainId],
      active: activeDomain === domainId,
    };
  });
  const limit = Number.isFinite(visibleLimit)
    ? Math.min(builtins.length, Math.max(1, Math.round(visibleLimit)))
    : DEFAULT_VISIBLE_ITEMS;
  const visibleItems = builtins.slice(0, limit);
  const overflowItems = builtins.slice(limit);
  const extensionItems: MenuItem[] = uiExtensions.flatMap((extension) => {
    if (extension.activationEligible === false) return [];
    return (extension.ui?.contributions?.pages ?? [])
      .filter((page) => page.showInNav)
      .map((page) => {
        const to = extensionPagePath(extension.id, page);
        return {
          id: `extension:${extension.id}:${page.id}`,
          label: page.title,
          to,
          Icon: page.navIcon ? resolveLucideIcon(page.navIcon) ?? Puzzle : Puzzle,
          active: pathname === to || pathname.startsWith(`${to}/`),
        };
      });
  });
  const overflowActive = overflowItems.some((item) => item.active) || extensionItems.some((item) => item.active);

  const renderLink = (item: MenuItem, inPopover = false) => (
    <Link
      key={item.id}
      to={item.to}
      aria-current={item.active ? 'page' : undefined}
      className={rowClass(collapsed, item.active, inPopover)}
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
      {overflowItems.length > 0 || extensionItems.length > 0 ? <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={m.sidebar.moreAppsAria}
            title={m.sidebar.moreApps}
            className={cn(
              'flex w-full items-center text-sm font-medium leading-6 transition-colors duration-200 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
              collapsed ? 'justify-center rounded-xl p-2.5' : 'gap-2 rounded-lg px-3 py-2.5 text-left md:py-1.5',
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
              {extensionItems.length > 0 ? (
                <section aria-labelledby="sidebar-more-extension-apps">
                  <div id="sidebar-more-extension-apps" className="px-2 pb-1 pt-1.5 text-[11px] font-semibold tracking-wide text-fg-subtle">
                    {m.sidebar.extensionAppsHeading}
                  </div>
                  <div className="flex flex-col gap-0.5">{extensionItems.map((item) => renderLink(item, true))}</div>
                </section>
              ) : null}
            </nav>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root> : null}
    </>
  );
}
