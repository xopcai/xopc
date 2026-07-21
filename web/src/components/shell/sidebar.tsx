import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Link } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';

import { SidebarFooter } from '@/components/shell/sidebar-footer';
import { SidebarNavItems } from '@/components/shell/sidebar-nav-items';
import { SidebarTaskList } from '@/components/shell/sidebar-task-list';
import {
  MAX_VISIBLE_NAV_ITEMS,
  MIN_VISIBLE_NAV_ITEMS,
} from '@/navigation/sidebar-nav-items';

const NAV_ITEM_PITCH_PX = 42;
const VISIBLE_APP_COUNT_STORAGE_KEY = 'xopc-web-sidebar-visible-app-count';

function clampVisibleAppCount(value: number): number {
  return Math.min(MAX_VISIBLE_NAV_ITEMS, Math.max(MIN_VISIBLE_NAV_ITEMS, value));
}

function readVisibleAppCount(): number {
  try {
    const stored = Number.parseInt(
      globalThis.localStorage?.getItem(VISIBLE_APP_COUNT_STORAGE_KEY) ?? '',
      10,
    );
    return Number.isFinite(stored)
      ? clampVisibleAppCount(stored)
      : MIN_VISIBLE_NAV_ITEMS;
  } catch {
    return MIN_VISIBLE_NAV_ITEMS;
  }
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
  const [visibleAppCount, setVisibleAppCount] = useState(readVisibleAppCount);
  const resizeStartRef = useRef<{ clientY: number; visibleCount: number } | null>(null);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(
        VISIBLE_APP_COUNT_STORAGE_KEY,
        String(visibleAppCount),
      );
    } catch {
      /* ignore quota / private mode */
    }
  }, [visibleAppCount]);

  function onResizePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    resizeStartRef.current = { clientY: event.clientY, visibleCount: visibleAppCount };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onResizePointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = resizeStartRef.current;
    if (!start) return;
    const rowDelta = Math.round((event.clientY - start.clientY) / NAV_ITEM_PITCH_PX);
    setVisibleAppCount(clampVisibleAppCount(start.visibleCount + rowDelta));
  }

  function onResizePointerEnd(event: PointerEvent<HTMLDivElement>) {
    resizeStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      setVisibleAppCount((count) => clampVisibleAppCount(count + 1));
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      setVisibleAppCount((count) => clampVisibleAppCount(count - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setVisibleAppCount(MIN_VISIBLE_NAV_ITEMS);
    } else if (event.key === 'End') {
      event.preventDefault();
      setVisibleAppCount(MAX_VISIBLE_NAV_ITEMS);
    }
  }

  return (
    <div className="app-sidebar-content flex min-h-0 flex-1 flex-col">
      {/* Fixed: primary links do not scroll with the task list */}
      <nav
        className={cn('shrink-0 pt-4', collapsed ? 'px-1.5' : 'px-4')}
        aria-label="Main"
      >
        <div className="flex flex-col gap-0.5">
          {!collapsed ? (
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
          ) : null}
          <SidebarNavItems
            collapsed={collapsed}
            onNavigate={onNavigate}
            visibleLimit={collapsed ? MIN_VISIBLE_NAV_ITEMS : visibleAppCount}
          />
        </div>
      </nav>

      {!collapsed ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={m.sidebar.resizeApps}
          aria-valuemin={MIN_VISIBLE_NAV_ITEMS}
          aria-valuemax={MAX_VISIBLE_NAV_ITEMS}
          aria-valuenow={visibleAppCount}
          tabIndex={0}
          className="group flex h-3 shrink-0 touch-none cursor-row-resize items-center px-4 focus-visible:outline-none"
          title={m.sidebar.resizeApps}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerEnd}
          onPointerCancel={onResizePointerEnd}
          onKeyDown={onResizeKeyDown}
        >
          <span className="h-px w-full bg-edge-subtle transition-colors group-hover:bg-edge group-focus-visible:bg-accent" />
        </div>
      ) : null}

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
