import { memo } from 'react';
import { useLocation } from 'react-router-dom';

import { CommandPaletteSearchButton } from '@/components/shell/command-palette-search-button';
import { SidebarRailToggleButton } from '@/components/shell/sidebar-rail-toggle-button';
import { cn } from '@/lib/cn';
import { isElectronDarwin } from '@/lib/electron-window-chrome';
import { useSidebarStore } from '@/stores/sidebar-store';

/**
 * Desktop (`md+`) only: when the main rail is collapsed, show the expand control inline
 * (left rail is fully hidden). Hidden on small viewports — drawer menu applies.
 * macOS Electron: expand is in {@link DarwinCollapsedTitlebarCluster} instead.
 * No-op on `/settings/*` where `AppShell` omits the main sidebar.
 */
export const MainRailExpandWhenCollapsed = memo(function MainRailExpandWhenCollapsed({
  className,
}: {
  className?: string;
}) {
  const { pathname } = useLocation();
  const collapsed = useSidebarStore((s) => s.collapsed);
  if (pathname.startsWith('/settings') || !collapsed) return null;
  /** macOS: expand lives in {@link DarwinCollapsedTitlebarCluster} with search + new. */
  if (isElectronDarwin()) return null;

  return (
    <div className={cn('hidden shrink-0 items-center gap-0.5 md:flex', className)}>
      <SidebarRailToggleButton variant="main" />
      <CommandPaletteSearchButton />
    </div>
  );
});
