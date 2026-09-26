import * as Popover from '@radix-ui/react-popover';
import {
  Box,
  Cable,
  CircleDotDashed,
  FolderKanban,
  GitBranch,
  Home,
  Layers,
  MonitorPlay,
  MoreHorizontal,
  NotebookText,
  Plug,
  Puzzle,
  Users,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { useUiExtensions } from '@/features/extensions/extension-provider';
import { resolveLucideIcon, type LucideIcon } from '@/features/extensions/extension-nav-icon';
import { extensionPagePath } from '@/features/extensions/extension-paths';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { preloadRouteForPath } from '@/lib/route-preload';
import {
  PRODUCT_DOMAINS,
  productSectionAtLocation,
  type ProductDomainId,
  type ProductSectionId,
} from '@/navigation/product-navigation';
import { useLocaleStore } from '@/stores/locale-store';

const DEFAULT_VISIBLE_ITEMS = 3;
const MAX_VISIBLE_ITEMS = 5;

const ALL_SECTION_IDS = [
  'work-overview',
  'capabilities-skills',
  'automation-triggers',
  'capabilities-connectors',
  'work-projects',
  'work-notes',
  'capabilities-agents',
  'capabilities-channels',
  'automation-workflows',
  'automation-browser',
  'apps-library',
  'capabilities-extensions',
  'automation-scenes',
] as const satisfies readonly ProductSectionId[];

type SidebarSectionId = typeof ALL_SECTION_IDS[number];

const SECTION_GROUP: Record<SidebarSectionId, ProductDomainId> = {
  'work-overview': 'work',
  'work-projects': 'work',
  'work-notes': 'work',
  'apps-library': 'apps',
  'automation-scenes': 'automation',
  'automation-triggers': 'automation',
  'automation-workflows': 'automation',
  'automation-browser': 'automation',
  'capabilities-agents': 'capabilities',
  'capabilities-skills': 'capabilities',
  'capabilities-connectors': 'capabilities',
  'capabilities-channels': 'capabilities',
  'capabilities-extensions': 'capabilities',
};

const SECTION_ICONS = {
  'work-overview': Home,
  'work-projects': FolderKanban,
  'work-notes': NotebookText,
  'apps-library': Box,
  'automation-scenes': CircleDotDashed,
  'automation-triggers': Zap,
  'automation-workflows': GitBranch,
  'automation-browser': MonitorPlay,
  'capabilities-agents': Users,
  'capabilities-skills': Layers,
  'capabilities-connectors': Cable,
  'capabilities-channels': Plug,
  'capabilities-extensions': Puzzle,
} as const satisfies Record<SidebarSectionId, LucideIcon>;

const SECTION_BY_ID = new Map(
  PRODUCT_DOMAINS.flatMap((domain) => domain.sections.map((section) => [section.id, section] as const)),
);

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
  const { pathname, search } = useLocation();
  const language = useLocaleStore((state) => state.language);
  const m = messages(language);
  const copy = m.productNavigation;
  const activeSection = productSectionAtLocation(pathname, search);
  const uiExtensions = useUiExtensions();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const builtins: MenuItem[] = ALL_SECTION_IDS.map((sectionId) => {
    const section = SECTION_BY_ID.get(sectionId)!;
    return {
      id: sectionId,
      label: copy.sections[sectionId],
      to: section.path,
      Icon: SECTION_ICONS[sectionId],
      active: activeSection === sectionId,
    };
  });
  const limit = Math.min(MAX_VISIBLE_ITEMS, Math.max(1, Math.round(visibleLimit)));
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
  const overflowGroups = (['work', 'automation', 'capabilities', 'apps'] as const)
    .map((groupId) => ({
      id: groupId,
      label: copy.domains[groupId],
      items: overflowItems.filter((item) => SECTION_GROUP[item.id as SidebarSectionId] === groupId),
    }))
    .filter((group) => group.items.length > 0);
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
      {visibleItems.map((item) => renderLink(item))}
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
            className="z-50 max-h-[min(32rem,var(--radix-popover-content-available-height))] min-w-[14rem] max-w-[20rem] overflow-y-auto rounded-lg border border-edge bg-surface-panel p-1 shadow-popover"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <nav className="flex flex-col gap-1" aria-label={m.sidebar.moreAppsAria}>
              {overflowGroups.map((group) => (
                <section key={group.id} aria-labelledby={`sidebar-more-${group.id}`}>
                  <div id={`sidebar-more-${group.id}`} className="px-2 pb-1 pt-1.5 text-[11px] font-semibold tracking-wide text-fg-subtle">
                    {group.label}
                  </div>
                  <div className="flex flex-col gap-0.5">{group.items.map((item) => renderLink(item, true))}</div>
                </section>
              ))}
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
      </Popover.Root>
    </>
  );
}
