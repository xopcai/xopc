import { ArrowLeft } from 'lucide-react';
import { memo, useCallback, useState, type CSSProperties } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { APP_CHROME_DRAG_CLASS, APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { TabIcon } from '@/components/shell/tab-icons';
import { messages, tabLabel } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { ExtensionSettingsNav } from '@/features/extensions/extension-settings-nav';
import { pathForTab, SETTINGS_SHELL_NAV_GROUPS } from '@/navigation';
import { isElectron } from '@/lib/electron-env';
import { AGENTS_APP_LIST_PATH } from '@/features/settings/agents/agents-app-path';
import { SETTINGS_BACK_PATH_STATE_KEY } from '@/features/settings/settings-nav-state';
import { useLocaleStore } from '@/stores/locale-store';
import { useSidebarStore } from '@/stores/sidebar-store';

function resolveSettingsBackTarget(state: unknown): string {
  if (!state || typeof state !== 'object') {
    return '/chat';
  }
  const raw = (state as Record<string, unknown>)[SETTINGS_BACK_PATH_STATE_KEY];
  if (typeof raw !== 'string') {
    return '/chat';
  }
  const path = raw.trim();
  if (!path.startsWith('/') || path.startsWith('//')) {
    return '/chat';
  }
  return path;
}

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

/** Compact control — hover only on the pill, not full rail width. */
const backLinkClass = cn(
  'inline-flex max-w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-200 ease-out',
  'text-fg-muted hover:bg-surface-hover hover:text-fg',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
  'sm:px-4',
);

/** Full-screen settings: left rail (back + nav) vs right panel — color only, no divider borders. */
export const SettingsPageLayout = memo(function SettingsPageLayout() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const location = useLocation();
  const expandedWidthPx = useSidebarStore((s) => s.expandedWidthPx);
  const setExpandedWidthPx = useSidebarStore((s) => s.setExpandedWidthPx);
  const [widthResizing, setWidthResizing] = useState(false);

  const onSettingsRailResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      setWidthResizing(true);
      const startX = e.clientX;
      const startW = useSidebarStore.getState().expandedWidthPx;
      const pid = e.pointerId;
      const onMove = (ev: PointerEvent) => {
        setExpandedWidthPx(startW + (ev.clientX - startX));
      };
      const onDone = () => {
        try {
          el.releasePointerCapture(pid);
        } catch {
          /* ignore */
        }
        setWidthResizing(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onDone);
        window.removeEventListener('pointercancel', onDone);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onDone);
      window.addEventListener('pointercancel', onDone);
    },
    [setExpandedWidthPx],
  );

  const backTo = resolveSettingsBackTarget(location.state);
  const backLabel =
    backTo === '/chat'
      ? m.sidebar.backToApp
      : backTo === AGENTS_APP_LIST_PATH
        ? m.sidebar.backToAgents
        : m.sidebar.back;

  const backControl = (
    <Link
      to={backTo}
      replace={false}
      className={cn(backLinkClass, APP_CHROME_NO_DRAG_CLASS)}
      title={backLabel}
    >
      <ArrowLeft className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <span>{backLabel}</span>
    </Link>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      {/* Left: surface-base — no border vs right; §2.1 */}
      <div
        className={cn(
          'relative flex shrink-0 flex-col bg-surface-base',
          'md:h-full md:min-h-0 md:shrink-0 md:overflow-hidden',
          'settings-page-rail',
          widthResizing && 'settings-page-rail-resizing',
        )}
        style={
          {
            '--sidebar-expanded-px': `${expandedWidthPx}px`,
          } as CSSProperties
        }
      >
        <div className={cn('shrink-0 px-4 pb-2 pt-4', APP_CHROME_DRAG_CLASS)}>{backControl}</div>

        {/* Grouped vertical nav (mobile: capped height + scroll; desktop: fills rail). */}
        <div className="flex min-h-0 flex-1 flex-col md:min-h-0">
          <nav
            className={cn(
              'min-h-0 overflow-y-auto overflow-x-hidden px-4 pb-3 pt-2 md:pb-4',
              'max-h-[min(42vh,20rem)] md:max-h-none md:flex-1',
            )}
            aria-label={m.nav.settings}
          >
            <div className="flex flex-col gap-1">
              {SETTINGS_SHELL_NAV_GROUPS.map((group, groupIndex) => {
                const tabs = group.tabs.filter((tab) => tab !== 'settingsSystem' || isElectron());
                if (tabs.length === 0) {
                  return null;
                }
                return (
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
                    {tabs.map((tab) => (
                      <NavLink key={tab} to={pathForTab(tab)} className={settingsNavLinkClass}>
                        <TabIcon tab={tab} className="size-5 shrink-0 opacity-90" />
                        <span className="min-w-0 flex-1 truncate">{tabLabel(language, tab)}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
                );
              })}
              <ExtensionSettingsNav navLinkClassName={settingsNavLinkClass} />
            </div>
          </nav>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={m.sidebar.resizeHandleAria}
          onPointerDown={onSettingsRailResizePointerDown}
          className={cn(
            'pointer-events-auto absolute right-0 top-0 z-10 hidden h-full w-2 shrink-0 cursor-col-resize md:block',
            "before:content-[''] before:pointer-events-none before:absolute before:left-1/2 before:top-0 before:z-0 before:h-full before:w-px before:-translate-x-1/2",
            'before:bg-transparent before:transition-[background-color] before:duration-150',
            'hover:bg-surface-hover/20 hover:before:bg-edge/65 dark:hover:before:bg-edge/75',
            widthResizing && 'bg-surface-hover/30 before:!bg-edge/80 dark:before:!bg-edge/85',
            'transition-[background-color] duration-150',
            'touch-none select-none',
            APP_CHROME_NO_DRAG_CLASS,
          )}
        ></div>
      </div>

      {/* Right: surface-panel — elevated vs left rail */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-surface-panel [scrollbar-gutter:stable]">
        <Outlet />
      </div>
    </div>
  );
});
