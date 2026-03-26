import { ArrowLeft, BookOpen, ExternalLink } from 'lucide-react';
import { memo } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';

import { TabIcon } from '@/components/shell/tab-icons';
import { messages, tabLabel } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { helpDocsHomeUrl, pathForTab, SETTINGS_SHELL_NAV_GROUPS } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

/** Aligned with `SidebarNav` secondary links (§4.3 — same rail rhythm as main app sidebar). */
function settingsNavLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex w-full shrink-0 items-center gap-2.5 rounded-xl px-4 py-2 text-sm font-medium leading-6 transition-colors duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
    isActive
      ? 'bg-accent-soft text-accent-fg'
      : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
  );
}

const helpLinkClass = cn(
  'flex w-full items-center gap-2.5 rounded-xl px-4 py-2 text-sm font-medium leading-6 transition-colors duration-200 ease-out',
  'text-fg-muted hover:bg-surface-hover hover:text-fg',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
);

/** Compact control — hover only on the pill, not full rail width. */
const backLinkClass = cn(
  'inline-flex max-w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-200 ease-out',
  'text-fg-muted hover:bg-surface-hover hover:text-fg',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
  'sm:px-4',
);

/** Full-screen settings: left rail (back + nav + help) vs right panel — color only, no divider borders. */
export const SettingsPageLayout = memo(function SettingsPageLayout() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const backControl = (
    <Link to="/chat" replace={false} className={backLinkClass} title={m.sidebar.backToApp}>
      <ArrowLeft className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <span>{m.sidebar.backToApp}</span>
    </Link>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      {/* Left: surface-base — no border vs right; §2.1 */}
      <div
        className={cn(
          'flex shrink-0 flex-col bg-surface-base',
          'md:h-full md:min-h-0 md:w-[min(15rem,40vw)] md:shrink-0 md:overflow-hidden',
        )}
      >
        <div className="shrink-0 px-4 pb-2 pt-4">{backControl}</div>

        {/* Mobile: horizontal tabs + help */}
        <div className="md:hidden">
          <nav
            className="flex gap-1.5 overflow-x-auto overflow-y-hidden px-4 pb-3 pt-1"
            aria-label={m.nav.settings}
          >
            {SETTINGS_SHELL_NAV_GROUPS.map((group, groupIndex) => (
              <div
                key={group.id}
                className={cn(
                  'flex shrink-0 gap-1.5',
                  groupIndex > 0 && 'border-l border-edge-subtle pl-2',
                )}
              >
                {group.tabs.map((tab) => (
                  <NavLink
                    key={tab}
                    to={pathForTab(tab)}
                    className={({ isActive }) =>
                      cn(
                        'flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium leading-snug transition-colors duration-200 ease-out',
                        isActive
                          ? 'bg-accent-soft text-accent-fg'
                          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                      )
                    }
                  >
                    <TabIcon tab={tab} className="size-4 shrink-0 opacity-90" />
                    <span className="max-w-[7.5rem] truncate">{tabLabel(language, tab)}</span>
                  </NavLink>
                ))}
              </div>
            ))}
            <a
              href={helpDocsHomeUrl(language)}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium leading-snug text-fg-muted transition-colors duration-200 ease-out',
                'hover:bg-surface-hover hover:text-fg',
              )}
            >
              <BookOpen className="size-4 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
              <span className="max-w-[6rem] truncate">{m.sidebar.helpDocs}</span>
              <ExternalLink className="size-3 shrink-0 opacity-70" aria-hidden />
            </a>
          </nav>
        </div>

        {/* Desktop: vertical nav (scroll) + help — flex column fills rail height */}
        <div className="hidden min-h-0 flex-1 flex-col md:flex md:min-h-0">
          <nav
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-2 pt-2"
            aria-label={m.nav.settings}
          >
            <div className="flex flex-col gap-1">
              {SETTINGS_SHELL_NAV_GROUPS.map((group, groupIndex) => (
                <div key={group.id}>
                  <p
                    className={cn(
                      'px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted',
                      groupIndex === 0 && 'pt-0',
                    )}
                  >
                    {m.settingsNavGroups[group.id]}
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {group.tabs.map((tab) => (
                      <NavLink key={tab} to={pathForTab(tab)} className={settingsNavLinkClass}>
                        <TabIcon tab={tab} className="size-5 shrink-0 opacity-90" />
                        <span className="min-w-0 flex-1 truncate">{tabLabel(language, tab)}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </nav>
          <div className="shrink-0 border-t border-edge-subtle px-4 pb-4 pt-3 dark:border-edge-subtle">
            <a
              href={helpDocsHomeUrl(language)}
              target="_blank"
              rel="noopener noreferrer"
              className={helpLinkClass}
            >
              <BookOpen className="size-5 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{m.sidebar.helpDocs}</span>
              <ExternalLink className="size-3 shrink-0 opacity-70" aria-hidden />
            </a>
          </div>
        </div>
      </div>

      {/* Right: surface-panel — elevated vs left rail */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-surface-panel [scrollbar-gutter:stable]">
        <Outlet />
      </div>
    </div>
  );
});
