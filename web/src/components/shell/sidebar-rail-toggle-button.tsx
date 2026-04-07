import { PanelLeft, PanelRight } from 'lucide-react';
import { memo } from 'react';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { useSidebarStore } from '@/stores/sidebar-store';

type SidebarRailToggleButtonProps = {
  /** `sidebar`: hidden on small viewports (rail has its own md-only toggle). `main`: shown only inside a max-md:hidden bar. */
  variant?: 'sidebar' | 'main';
  className?: string;
};

export const SidebarRailToggleButton = memo(function SidebarRailToggleButton({
  variant = 'sidebar',
  className,
}: SidebarRailToggleButtonProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const toggleSidebarCollapsed = useSidebarStore((s) => s.toggleCollapsed);

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'size-8 shrink-0 rounded-xl p-0',
        variant === 'sidebar' ? 'hidden md:inline-flex' : 'inline-flex',
        APP_CHROME_NO_DRAG_CLASS,
        className,
      )}
      aria-expanded={!sidebarCollapsed}
      aria-controls="app-sidebar"
      aria-label={sidebarCollapsed ? m.sidebarExpand : m.sidebarCollapse}
      onClick={() => toggleSidebarCollapsed()}
    >
      {sidebarCollapsed ? (
        <PanelRight className="size-4" strokeWidth={1.5} aria-hidden />
      ) : (
        <PanelLeft className="size-4" strokeWidth={1.5} aria-hidden />
      )}
    </Button>
  );
});
