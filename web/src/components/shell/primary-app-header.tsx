import { memo } from 'react';
import { useLocation } from 'react-router-dom';

import { APP_CHROME_BAR_CLASS, APP_CHROME_DRAG_CLASS, APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { getShellChromeRuntime, resolveShellChromeLayout } from '@/components/shell/chrome-layout';
import { MainRailExpandWhenCollapsed } from '@/components/shell/main-rail-expand-when-collapsed';
import { MobileNavMenuButton } from '@/components/shell/mobile-nav-menu-button';
import { ShellQuickActions } from '@/components/shell/shell-quick-actions';
import { UnderstandingStatusButton } from '@/features/work-discovery/understanding-status-button';
import { cn } from '@/lib/cn';
import { useAppShellStore } from '@/stores/app-shell-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useSidebarStore } from '@/stores/sidebar-store';

/** Primary chrome: rail expand, mobile menu, and `page-header-store` slots (`h-14` per shell). */
export const PrimaryAppHeader = memo(function PrimaryAppHeader() {
  const { pathname } = useLocation();
  const startExtra = usePageHeaderStore((s) => s.startExtra);
  const main = usePageHeaderStore((s) => s.main);
  const end = usePageHeaderStore((s) => s.end);
  const headerClassName = usePageHeaderStore((s) => s.className);
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const mobileNavOpen = useAppShellStore((s) => s.mobileNavOpen);
  const showMobileNav = !pathname.startsWith('/settings');
  const chromeLayout = resolveShellChromeLayout({
    runtime: getShellChromeRuntime(),
    sidebarCollapsed,
    mobileNavOpen,
  });

  return (
    <header
      className={cn(
        'grid min-w-0 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 bg-surface-panel',
        APP_CHROME_BAR_CLASS,
        chromeLayout.mainHeaderDraggable && APP_CHROME_DRAG_CLASS,
        'px-3 sm:gap-4 sm:px-5 xl:px-6',
        headerClassName,
      )}
    >
      <div className={cn('flex min-w-0 shrink-0 items-center gap-2.5', APP_CHROME_NO_DRAG_CLASS)}>
        {chromeLayout.mainHeaderLeadingInsetClass ? (
          <ShellQuickActions
            sidebarToggleVariant="main"
            className={cn('hidden md:flex', chromeLayout.mainHeaderLeadingInsetClass)}
          />
        ) : null}
        <MainRailExpandWhenCollapsed />
        {showMobileNav ? <MobileNavMenuButton /> : null}
        {startExtra}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center overflow-hidden">
        <div className={cn('w-fit max-w-full', APP_CHROME_NO_DRAG_CLASS)}>{main}</div>
      </div>
      <div className={cn('flex min-w-0 shrink-0 items-center justify-end gap-2', APP_CHROME_NO_DRAG_CLASS)}>
        {end}
        {pathname === '/you' ? <UnderstandingStatusButton persistent /> : null}
      </div>
    </header>
  );
});
