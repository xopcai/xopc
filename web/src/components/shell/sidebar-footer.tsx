import * as Popover from '@radix-ui/react-popover';
import { FileText, FolderOpen, Settings } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';

import { BrandLogo } from '@/components/shell/brand-logo';
import { ConnectionIndicator } from '@/components/shell/connection-indicator';
import { TabIcon } from '@/components/shell/tab-icons';
import { Button } from '@/components/ui/button';
import { messages, tabLabel, type Tab } from '@/i18n/messages';
import { pathForTab } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';

const SETTINGS_TABS: Tab[] = [
  'settingsAgent',
  'settingsProviders',
  'settingsModels',
  'settingsChannels',
  'settingsVoice',
  'settingsGateway',
];

export function SidebarFooter({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col gap-2 border-t border-edge-subtle dark:border-edge',
        collapsed ? 'items-center px-1 py-2' : 'px-3 py-3',
      )}
    >
      <div
        className={cn(
          'flex min-w-0 items-start gap-2',
          collapsed ? 'flex-col items-center' : 'flex-row',
        )}
      >
        <Link
          to="/chat"
          title={m.nav.chat}
          className={cn(
            'shrink-0 rounded-xl ring-offset-surface-base transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
            collapsed ? 'size-9' : 'size-10',
          )}
          onClick={() => onNavigate?.()}
        >
          <BrandLogo
            className={cn('size-full object-contain', collapsed ? 'rounded-xl' : 'rounded-xl')}
            alt={m.appBrand}
          />
        </Link>
        {!collapsed ? (
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="truncate text-sm font-semibold leading-tight text-fg">{m.appBrand}</div>
            <div className="truncate text-xs leading-normal text-fg-subtle">{m.appSubtitle}</div>
          </div>
        ) : null}
        <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Popover.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              className={cn(
                'shrink-0 rounded-xl p-0 text-fg-muted hover:bg-surface-hover hover:text-fg',
                collapsed ? 'size-8' : 'size-10',
              )}
              aria-label={m.sidebar.appMenuAria}
              title={m.sidebar.appMenuAria}
            >
              <Settings className="size-[18px]" strokeWidth={1.5} />
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="z-50 w-[min(18rem,calc(100vw-2rem))] max-h-[min(24rem,70vh)] overflow-y-auto rounded-xl border border-edge bg-surface-panel p-2 shadow-lg shadow-slate-200/60 dark:border-edge dark:shadow-black/40"
              side={collapsed ? 'right' : 'top'}
              align="end"
              sideOffset={8}
              collisionPadding={12}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <div className="px-4 pb-2 pt-1 text-xs font-medium text-fg-subtle">{m.nav.settings}</div>
              <nav className="flex flex-col gap-0.5" aria-label={m.nav.settings}>
                {SETTINGS_TABS.map((tab) => (
                  <NavLink
                    key={tab}
                    to={pathForTab(tab)}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                        isActive
                          ? 'bg-accent-soft text-accent-fg'
                          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                      )
                    }
                    onClick={() => {
                      setMenuOpen(false);
                      onNavigate?.();
                    }}
                  >
                    <TabIcon tab={tab} className="size-4 shrink-0 opacity-90" />
                    <span className="truncate">{tabLabel(language, tab)}</span>
                  </NavLink>
                ))}
                <div className="my-2 border-t border-edge-subtle dark:border-edge" />
                <NavLink
                  to="/sessions"
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-accent-soft text-accent-fg'
                        : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                    )
                  }
                  onClick={() => {
                    setMenuOpen(false);
                    onNavigate?.();
                  }}
                >
                  <FolderOpen className="size-4 shrink-0 opacity-90" strokeWidth={1.75} />
                  <span className="truncate">{m.nav.sessions}</span>
                </NavLink>
                <NavLink
                  to="/logs"
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-accent-soft text-accent-fg'
                        : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                    )
                  }
                  onClick={() => {
                    setMenuOpen(false);
                    onNavigate?.();
                  }}
                >
                  <FileText className="size-4 shrink-0 opacity-90" strokeWidth={1.75} />
                  <span className="truncate">{m.nav.logs}</span>
                </NavLink>
              </nav>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      <ConnectionIndicator compact={collapsed} className={collapsed ? 'w-full' : undefined} />
    </div>
  );
}
