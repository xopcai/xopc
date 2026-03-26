import { Settings } from 'lucide-react';
import { useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { BrandLogo } from '@/components/shell/brand-logo';
import { messages } from '@/i18n/messages';
import { pathForTab } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';

export function SidebarFooter({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const { pathname } = useLocation();
  const settingsActive = pathname.startsWith('/settings');

  useEffect(() => {
    void import('@/pages/settings-page');
    void import('@/pages/sessions-page');
    void import('@/pages/logs-page');
  }, []);

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col gap-2',
        /* Collapsed rail: task list is hidden — pin brand + settings to column bottom */
        collapsed && 'mt-auto',
        collapsed ? 'items-center px-1 py-2' : 'px-3 py-3',
      )}
    >
      {/* §7.1 Hover: bg-surface-hover + transition-colors duration-150 (ui-design-system.md) */}
      <div
        className={cn(
          'rounded-xl border border-transparent transition-colors duration-150 ease-out',
          'hover:bg-surface-hover hover:border-edge-subtle',
          'motion-reduce:transition-none',
          collapsed ? 'px-1 py-1.5' : 'px-2 py-2',
        )}
      >
        <div
          className={cn(
            'flex min-w-0 gap-2',
            collapsed ? 'flex-col items-center' : 'flex-row items-center',
          )}
        >
          <Link
            to="/chat"
            title={m.nav.chat}
            className={cn(
              'shrink-0 rounded-xl ring-offset-surface-base transition-transform duration-150 ease-out',
              'hover:opacity-95 active:scale-95',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
              'motion-reduce:hover:opacity-100 motion-reduce:active:scale-100',
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
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold leading-tight text-fg">{m.appBrand}</div>
            </div>
          ) : null}

          <NavLink
            to={pathForTab('settingsAgent')}
            title={m.nav.settings}
            aria-label={m.nav.settings}
            aria-current={settingsActive ? 'page' : undefined}
            className={({ isActive }) => {
              const on = isActive || settingsActive;
              return cn(
                'flex shrink-0 items-center justify-center rounded-xl p-0 transition-colors duration-150 ease-out',
                'active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                'motion-reduce:active:scale-100',
                collapsed ? 'size-8' : 'size-10',
                on
                  ? 'bg-accent-soft text-accent-fg hover:bg-accent-soft hover:text-accent-fg'
                  : 'text-fg-muted hover:bg-surface-active hover:text-fg',
              );
            }}
            onClick={() => onNavigate?.()}
          >
            <Settings className="size-[18px]" strokeWidth={1.5} aria-hidden />
          </NavLink>
        </div>
      </div>
    </div>
  );
}
