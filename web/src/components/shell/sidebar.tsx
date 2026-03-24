import { NavLink } from 'react-router-dom';

import { getTabGroups, tabLabel, type Tab } from '@/i18n/messages';
import { pathForTab } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';

import { TabIcon } from '@/components/shell/tab-icons';

function navLinkClass({ isActive }: { isActive: boolean }, collapsed: boolean) {
  return cn(
    'flex w-full items-center text-sm font-medium leading-6 transition-colors duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
    collapsed
      ? 'justify-center rounded-xl px-2 py-2.5'
      : 'gap-2.5 rounded-xl px-4 py-2 text-left',
    isActive
      ? 'bg-accent-soft text-accent-fg'
      : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
  );
}

export function SidebarNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const language = useLocaleStore((s) => s.language);
  const groups = getTabGroups(language);

  return (
    <nav
      className={cn('flex flex-col pb-4', collapsed ? 'gap-3 px-1.5 pt-2' : 'gap-6 px-4 pt-4')}
      aria-label="Main"
    >
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1.5">
          <div
            className={cn(
              'px-4 text-xs font-normal leading-5 text-fg-subtle',
              collapsed && 'sr-only',
            )}
          >
            {group.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.tabs.map((tab: Tab) => (
              <NavLink
                key={tab}
                to={pathForTab(tab)}
                className={(props) => navLinkClass(props, collapsed)}
                end={tab === 'chat'}
                title={tabLabel(language, tab)}
                onClick={() => onNavigate?.()}
              >
                <TabIcon tab={tab} className="size-5 shrink-0 opacity-90" />
                {!collapsed ? <span className="truncate">{tabLabel(language, tab)}</span> : null}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
