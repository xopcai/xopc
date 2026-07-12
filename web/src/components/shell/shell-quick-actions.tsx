import { memo } from 'react';

import { CommandPaletteSearchButton } from '@/components/shell/command-palette-search-button';
import { ElectronHistoryNav } from '@/components/shell/electron-history-nav';
import { QuickCaptureButton } from '@/components/shell/quick-capture-button';
import { SidebarRailToggleButton } from '@/components/shell/sidebar-rail-toggle-button';
import { cn } from '@/lib/cn';

export const ShellQuickActions = memo(function ShellQuickActions({
  sidebarToggleVariant,
  showHistory = false,
  className,
}: {
  sidebarToggleVariant: 'sidebar' | 'main';
  showHistory?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 shrink-0 items-center gap-0.5', className)}>
      <SidebarRailToggleButton variant={sidebarToggleVariant} />
      <QuickCaptureButton />
      <CommandPaletteSearchButton />
      {showHistory ? <ElectronHistoryNav /> : null}
    </div>
  );
});
