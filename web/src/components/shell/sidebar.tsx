import { Clock, FileEdit, Layers, Plug, Plus } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';

import { SidebarFooter } from '@/components/shell/sidebar-footer';
import { SidebarTaskList } from '@/components/shell/sidebar-task-list';

function secondaryNavClass({ isActive }: { isActive: boolean }, collapsed: boolean) {
  return cn(
    'flex w-full items-center text-sm font-medium leading-6 transition-colors duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
    collapsed
      ? 'justify-center rounded-xl px-2 py-2.5'
      : 'gap-2 rounded-lg px-3 py-2 text-left',
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
  const m = messages(language);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Fixed: primary links do not scroll with the task list */}
      <nav
        className={cn('shrink-0', collapsed ? 'px-1.5 pt-2' : 'px-4 pt-4')}
        aria-label="Main"
      >
        <div className="flex flex-col gap-0.5">
          {!collapsed ? (
            <Link
              to="/chat/new"
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium leading-5 transition-colors duration-200 ease-out',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
                'bg-surface-panel text-fg hover:bg-surface-hover',
              )}
              title={m.sidebar.newTask}
              onClick={() => onNavigate?.()}
            >
              <Plus className="size-4 shrink-0 text-accent-fg" strokeWidth={2} aria-hidden />
              <span className="truncate">{m.sidebar.newTask}</span>
            </Link>
          ) : null}
          <NavLink
            to="/skills"
            className={(props) => secondaryNavClass(props, collapsed)}
            title={m.nav.skills}
            onClick={() => onNavigate?.()}
          >
            <Layers className="size-4 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
            {!collapsed ? <span className="truncate">{m.nav.skills}</span> : null}
          </NavLink>
          <NavLink
            to="/cron"
            className={(props) => secondaryNavClass(props, collapsed)}
            title={m.nav.cron}
            onClick={() => onNavigate?.()}
          >
            <Clock className="size-4 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
            {!collapsed ? <span className="truncate">{m.nav.cron}</span> : null}
          </NavLink>
          <NavLink
            to="/editor"
            className={(props) => secondaryNavClass(props, collapsed)}
            title={m.nav.editor}
            onClick={() => onNavigate?.()}
          >
            <FileEdit className="size-4 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
            {!collapsed ? <span className="truncate">{m.nav.editor}</span> : null}
          </NavLink>
          <NavLink
            to="/channels"
            className={(props) => secondaryNavClass(props, collapsed)}
            title={m.nav.channels}
            onClick={() => onNavigate?.()}
          >
            <Plug className="size-4 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
            {!collapsed ? <span className="truncate">{m.nav.channels}</span> : null}
          </NavLink>
        </div>
      </nav>

      {/* Scroll + load-more: task list only */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-hidden',
          collapsed && 'hidden',
        )}
        aria-hidden={collapsed ? true : undefined}
      >
        <SidebarTaskList onNavigate={onNavigate} />
      </div>

      <SidebarFooter collapsed={collapsed} onNavigate={onNavigate} />
    </div>
  );
}
