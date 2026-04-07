import { memo } from 'react';
import { useLocation } from 'react-router-dom';

import { SidebarRailToggleButton } from '@/components/shell/sidebar-rail-toggle-button';
import { cn } from '@/lib/cn';
import { useSidebarStore } from '@/stores/sidebar-store';

/**
 * Desktop (`md+`) only: when the main rail is collapsed, show the expand control inline
 * (left rail hides its expand affordance). Hidden on small viewports — drawer menu applies.
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

  return (
    <div className={cn('hidden shrink-0 items-center md:flex', className)}>
      <SidebarRailToggleButton variant="main" />
    </div>
  );
});
