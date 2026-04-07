import { memo } from 'react';
import { useLocation } from 'react-router-dom';

import { APP_TOP_HEADER_BAR_CLASS } from '@/components/shell/app-chrome';
import { MainRailExpandWhenCollapsed } from '@/components/shell/main-rail-expand-when-collapsed';
import { MobileNavMenuButton } from '@/components/shell/mobile-nav-menu-button';
import { cn } from '@/lib/cn';
import { usePageHeaderStore } from '@/stores/page-header-store';

/** Primary chrome: rail expand, mobile menu, and `page-header-store` slots (`h-14` per shell). */
export const PrimaryAppHeader = memo(function PrimaryAppHeader() {
  const { pathname } = useLocation();
  const startExtra = usePageHeaderStore((s) => s.startExtra);
  const main = usePageHeaderStore((s) => s.main);
  const end = usePageHeaderStore((s) => s.end);
  const showMobileNav = !pathname.startsWith('/settings');

  return (
    <header
      className={cn(
        'flex shrink-0 gap-3 bg-surface-panel',
        APP_TOP_HEADER_BAR_CLASS,
        'px-3 sm:gap-4 sm:px-5 xl:px-6',
      )}
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2.5">
        <MainRailExpandWhenCollapsed />
        {showMobileNav ? <MobileNavMenuButton /> : null}
        {startExtra}
      </div>
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col justify-center overflow-hidden">
        {main}
      </div>
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">{end}</div>
    </header>
  );
});
