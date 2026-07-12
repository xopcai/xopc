import { memo } from 'react';
import { useLocation } from 'react-router-dom';

import { getShellChromeRuntime, resolveShellChromeLayout } from '@/components/shell/chrome-layout';
import { ShellQuickActions } from '@/components/shell/shell-quick-actions';
import { cn } from '@/lib/cn';
import { useSidebarStore } from '@/stores/sidebar-store';

/**
 * Desktop (`md+`) only: when the main rail is collapsed, show the expand control inline
 * (left rail is fully hidden). Hidden on small viewports — drawer menu applies.
 * macOS owns its collapsed-state actions in `PrimaryAppHeader` so its traffic-light safe area
 * remains a single layout track.
 * No-op on `/settings/*` where `AppShell` omits the main sidebar.
 */
export const MainRailExpandWhenCollapsed = memo(function MainRailExpandWhenCollapsed({
  className,
}: {
  className?: string;
}) {
  const { pathname } = useLocation();
  const collapsed = useSidebarStore((s) => s.collapsed);
  const chromeLayout = resolveShellChromeLayout({
    runtime: getShellChromeRuntime(),
    sidebarCollapsed: collapsed,
    mobileNavOpen: false,
  });
  if (pathname.startsWith('/settings') || !collapsed) return null;
  if (!chromeLayout.mainHeaderQuickActionsVisible || chromeLayout.mainHeaderLeadingInsetClass) return null;

  return (
    <ShellQuickActions sidebarToggleVariant="main" className={cn('hidden md:flex', className)} />
  );
});
