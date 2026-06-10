import { Plus } from 'lucide-react';
import { memo } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { CommandPaletteSearchButton } from '@/components/shell/command-palette-search-button';
import { QuickCaptureButton } from '@/components/shell/quick-capture-button';
import { SidebarRailToggleButton } from '@/components/shell/sidebar-rail-toggle-button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { isElectronDarwin } from '@/lib/electron-window-chrome';
import { useLocaleStore } from '@/stores/locale-store';
import { useSidebarStore } from '@/stores/sidebar-store';

/**
 * macOS Electron + collapsed left rail: Cursor-style traffic-light row — sidebar toggle,
 * command palette (search), and new task, fixed after the native window controls.
 */
export const DarwinCollapsedTitlebarCluster = memo(function DarwinCollapsedTitlebarCluster() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const { pathname } = useLocation();
  const collapsed = useSidebarStore((s) => s.collapsed);

  if (!isElectronDarwin() || !collapsed || pathname.startsWith('/settings')) return null;

  return (
    <div
      className={cn(
        'pointer-events-none fixed left-[88px] top-0 z-[70] hidden h-14 items-center md:flex',
      )}
    >
      <div className={cn('pointer-events-auto flex items-center gap-0.5', APP_CHROME_NO_DRAG_CLASS)}>
        <SidebarRailToggleButton className="inline-flex" />
        <QuickCaptureButton className="inline-flex" />
        <CommandPaletteSearchButton className="inline-flex" />
        <Link
          to="/chat/new"
          className={cn(
            'inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-fg transition-colors hover:bg-surface-hover',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
            APP_CHROME_NO_DRAG_CLASS,
          )}
          title={m.sidebar.newTask}
        >
          <Plus className="size-4 shrink-0 text-accent-fg" strokeWidth={2} aria-hidden />
        </Link>
      </div>
    </div>
  );
});
