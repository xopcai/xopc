import { memo } from 'react';
import { useLocation } from 'react-router-dom';

import { APP_CHROME_NO_DRAG_CLASS, APP_TOP_HEADER_BAR_CLASS } from '@/components/shell/app-chrome';
import { DarwinCollapsedTitlebarCluster } from '@/components/shell/darwin-collapsed-titlebar-cluster';
import { MainRailExpandWhenCollapsed } from '@/components/shell/main-rail-expand-when-collapsed';
import { MobileNavMenuButton } from '@/components/shell/mobile-nav-menu-button';
import { cn } from '@/lib/cn';
import { electronDarwinCollapsedClusterMainPadMd } from '@/lib/electron-window-chrome';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useSidebarStore } from '@/stores/sidebar-store';

/** Primary chrome: rail expand, mobile menu, and `page-header-store` slots (`h-14` per shell). */
export const PrimaryAppHeader = memo(function PrimaryAppHeader() {
  const { pathname } = useLocation();
  const startExtra = usePageHeaderStore((s) => s.startExtra);
  const main = usePageHeaderStore((s) => s.main);
  const end = usePageHeaderStore((s) => s.end);
  const headerClassName = usePageHeaderStore((s) => s.className);
  const showMobileNav = !pathname.startsWith('/settings');
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);

  return (
    <header
      className={cn(
        'flex shrink-0 items-center gap-3 bg-surface-base',
        APP_TOP_HEADER_BAR_CLASS,
        'px-3 sm:gap-4 sm:px-5 xl:px-6',
        electronDarwinCollapsedClusterMainPadMd(sidebarCollapsed),
        headerClassName,
      )}
    >
      <DarwinCollapsedTitlebarCluster />
      <div className={cn('flex min-w-0 shrink-0 items-center gap-2.5', APP_CHROME_NO_DRAG_CLASS)}>
        <MainRailExpandWhenCollapsed />
        {showMobileNav ? <MobileNavMenuButton /> : null}
        {startExtra}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center overflow-hidden">
        <div className={cn('w-fit max-w-full', APP_CHROME_NO_DRAG_CLASS)}>{main}</div>
      </div>
      <div className={cn('flex min-w-0 shrink-0 items-center justify-end gap-2', APP_CHROME_NO_DRAG_CLASS)}>{end}</div>
    </header>
  );
});
