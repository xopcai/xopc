import { ArrowLeft, BookOpen, ExternalLink } from 'lucide-react';
import { memo } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';

import { APP_TOP_HEADER_BAR_CLASS } from '@/components/shell/app-chrome';
import { TabIcon } from '@/components/shell/tab-icons';
import { Button } from '@/components/ui/button';
import { messages, tabLabel } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { HELP_DOCS_URL, pathForTab, SETTINGS_SHELL_NAV_TABS } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

function settingsNavLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex min-h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium leading-snug transition-colors duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
    isActive
      ? 'bg-accent-soft text-accent-fg'
      : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
  );
}

const helpLinkClass = cn(
  'flex min-h-9 items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium leading-snug transition-colors duration-150',
  'text-fg-muted hover:bg-surface-hover hover:text-fg',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
);

/** Full-screen settings: back row + left section nav + right panel (main sidebar hidden in AppShell). */
export const SettingsPageLayout = memo(function SettingsPageLayout() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-panel">
      <header
        className={cn(
          'flex shrink-0 items-center gap-2 border-b border-edge-subtle px-3 sm:px-4',
          APP_TOP_HEADER_BAR_CLASS,
          'bg-surface-panel',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          className={cn(
            '-ml-1 h-9 shrink-0 gap-1.5 rounded-xl px-2 text-fg-muted hover:bg-surface-hover hover:text-fg',
            'sm:gap-2 sm:px-2.5',
          )}
          asChild
        >
          <Link to="/chat" replace={false}>
            <ArrowLeft className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="text-sm font-medium">{m.sidebar.backToApp}</span>
          </Link>
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {/* Mobile: horizontal section tabs + help */}
        <div className="flex shrink-0 flex-col border-b border-edge-subtle bg-surface-base md:hidden">
          <nav
            className="flex gap-1 overflow-x-auto overflow-y-hidden px-2 py-2"
            aria-label={m.nav.settings}
          >
            {SETTINGS_SHELL_NAV_TABS.map((tab) => (
              <NavLink
                key={tab}
                to={pathForTab(tab)}
                className={({ isActive }) =>
                  cn(
                    'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors duration-150',
                    isActive
                      ? 'bg-accent-soft text-accent-fg'
                      : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                  )
                }
              >
                <TabIcon tab={tab} className="size-3.5 shrink-0 opacity-90" />
                <span className="max-w-[7.5rem] truncate">{tabLabel(language, tab)}</span>
              </NavLink>
            ))}
            <a
              href={HELP_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors duration-150',
                'hover:bg-surface-hover hover:text-fg',
              )}
            >
              <BookOpen className="size-3.5 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
              <span className="max-w-[6rem] truncate">{m.sidebar.helpDocs}</span>
              <ExternalLink className="size-3 shrink-0 opacity-70" aria-hidden />
            </a>
          </nav>
        </div>

        {/* Desktop: left rail + help footer */}
        <div className="hidden min-h-0 w-[min(15rem,40vw)] shrink-0 flex-col border-r border-edge-subtle bg-surface-base md:flex">
          <nav
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-3"
            aria-label={m.nav.settings}
          >
            <div className="flex flex-col gap-px">
              {SETTINGS_SHELL_NAV_TABS.map((tab) => (
                <NavLink key={tab} to={pathForTab(tab)} className={settingsNavLinkClass}>
                  <TabIcon tab={tab} className="size-3.5 shrink-0 opacity-90" />
                  <span className="min-w-0 flex-1 truncate">{tabLabel(language, tab)}</span>
                </NavLink>
              ))}
            </div>
          </nav>
          <div className="shrink-0 border-t border-edge-subtle px-2 py-2.5">
            <a
              href={HELP_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={helpLinkClass}
            >
              <BookOpen className="size-3.5 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{m.sidebar.helpDocs}</span>
              <ExternalLink className="size-3 shrink-0 opacity-70" aria-hidden />
            </a>
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
          <Outlet />
        </div>
      </div>
    </div>
  );
});
