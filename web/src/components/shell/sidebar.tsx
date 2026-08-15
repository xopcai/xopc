import { AudioLines, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import { openDiscussionCapture } from '@/features/discussions/discussion-events';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';

import { SidebarFooter } from '@/components/shell/sidebar-footer';
import { SidebarNavItems } from '@/components/shell/sidebar-nav-items';
import { SidebarTaskList } from '@/components/shell/sidebar-task-list';
import {
  MIN_VISIBLE_NAV_ITEMS,
} from '@/navigation/sidebar-nav-items';

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
    <div className="app-sidebar-content flex min-h-0 flex-1 flex-col">
      {/* Fixed: primary links do not scroll with the task list */}
      <nav
        className={cn('shrink-0 pt-4', collapsed ? 'px-1.5' : 'px-4')}
        aria-label="Main"
      >
        <div className="flex flex-col gap-0.5">
          {!collapsed ? (
            <>
              <Link
                to="/chat/new"
                state={{ forceNewChat: true }}
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
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium leading-5 text-fg-muted transition-colors duration-200 ease-out hover:bg-surface-hover hover:text-fg',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
                )}
                title={m.notes.discussionCapture.title}
                onClick={() => {
                  openDiscussionCapture();
                  onNavigate?.();
                }}
              >
                <AudioLines className="size-4 shrink-0 text-accent-fg" strokeWidth={1.75} aria-hidden />
                <span className="truncate">{m.notes.discussionCapture.title}</span>
              </button>
            </>
          ) : null}
          <SidebarNavItems
            collapsed={collapsed}
            onNavigate={onNavigate}
            visibleLimit={MIN_VISIBLE_NAV_ITEMS}
          />
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
