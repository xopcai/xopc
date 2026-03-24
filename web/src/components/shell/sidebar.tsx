import { NavLink } from 'react-router-dom';

import { getTabGroups, tabLabel, type Tab } from '@/i18n/messages';
import { pathForTab } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';

import { TabIcon } from '@/components/shell/tab-icons';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
    isActive
      ? 'bg-accent-soft text-accent-fg'
      : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
  );

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const language = useLocaleStore((s) => s.language);
  const groups = getTabGroups(language);

  return (
    <nav className="flex flex-col gap-4 px-2 py-3" aria-label="Main">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <div className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            {group.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.tabs.map((tab: Tab) => (
              <NavLink
                key={tab}
                to={pathForTab(tab)}
                className={navLinkClass}
                end={tab === 'chat'}
                onClick={() => onNavigate?.()}
              >
                <TabIcon tab={tab} className="size-4 shrink-0 opacity-90" />
                <span className="truncate">{tabLabel(language, tab)}</span>
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
