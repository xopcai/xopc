import { Menu, Plus } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import { APP_TOP_HEADER_BAR_CLASS } from '@/components/shell/app-chrome';
import { HeaderPreferencesPopover } from '@/components/shell/header-preferences-popover';
import { LanguageToggle } from '@/components/shell/language-toggle';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useAppShellStore } from '@/stores/app-shell-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useSidebarStore } from '@/stores/sidebar-store';

type ChatHeaderBarProps = {
  chatHeadline: string;
};

/**
 * Subscribes to sidebar / mobile-nav stores in isolation so collapsing the rail
 * does not re-render the chat body (messages, composer, scroll state).
 */
export const ChatHeaderBar = memo(function ChatHeaderBar({ chatHeadline }: ChatHeaderBarProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const mobileNavOpen = useAppShellStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useAppShellStore((s) => s.setMobileNavOpen);

  return (
    <div
      className={cn(
        'flex gap-3 px-4 sm:gap-4 sm:px-8',
        APP_TOP_HEADER_BAR_CLASS,
        sidebarCollapsed && 'lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-4',
      )}
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2.5">
        <Button
          type="button"
          variant="ghost"
          className={cn('size-8 shrink-0 rounded-xl p-0 lg:hidden', mobileNavOpen && 'hidden')}
          aria-expanded={mobileNavOpen}
          aria-controls="app-sidebar"
          aria-label={m.openMenu}
          title={m.openMenu}
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu className="size-4" strokeWidth={1.5} aria-hidden />
        </Button>
        {sidebarCollapsed ? (
          <Link
            to="/chat/new"
            className={cn(
              'hidden h-8 shrink-0 items-center gap-2 rounded-lg bg-surface-panel px-2.5 text-sm font-medium leading-none text-fg transition-colors hover:bg-surface-hover',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
              'lg:inline-flex',
            )}
            title={m.sidebar.newTask}
          >
            <Plus className="size-4 shrink-0 text-accent-fg" strokeWidth={2} aria-hidden />
            <span className="max-w-[10rem] truncate sm:max-w-[14rem]">{m.sidebar.newTask}</span>
          </Link>
        ) : null}
      </div>
      <h1
        className={cn(
          'min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-fg',
          sidebarCollapsed ? 'text-left lg:text-center' : 'text-left',
        )}
        title={chatHeadline}
      >
        {chatHeadline}
      </h1>
      <div className="flex shrink-0 items-center gap-2 sm:gap-2.5 lg:justify-self-end">
        <div className="hidden items-center gap-2 sm:gap-2.5 lg:flex">
          <LanguageToggle />
          <ThemeToggle />
        </div>
        <div className="lg:hidden">
          <HeaderPreferencesPopover />
        </div>
      </div>
    </div>
  );
});
