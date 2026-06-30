import { ArrowLeft, Menu, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';

import { APP_CHROME_DRAG_CLASS, APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { SettingsModeToggle } from '@/components/shell/settings-mode-toggle';
import { TabIcon } from '@/components/shell/tab-icons';
import { messages, tabLabel } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { ExtensionSettingsNav } from '@/features/extensions/extension-settings-nav';
import {
  ELECTRON_ONLY_SETTINGS_TABS,
  ELECTRON_SYSTEM_NAV_GROUP,
  pathForTab,
  SETTINGS_SHELL_NAV_GROUPS,
} from '@/navigation';
import type { SettingsShellNavGroup } from '@/navigation';
import { isSettingsPathVisibleInMode, isSettingsTabVisibleInMode } from '@/navigation/settings-nav-visibility';
import { isElectron } from '@/lib/electron-env';
import { electronDarwinTitlebarLeftPad, isElectronDarwin } from '@/lib/electron-window-chrome';
import { preloadRouteForPath } from '@/lib/route-preload';
import { SETTINGS_SHEET_PORTAL_BODY_MQ } from '@/lib/settings-shell-dialog-layer';
import { useMediaQuery } from '@/lib/use-media-query';
import type { StoredLanguage } from '@/lib/storage';
import { resolveSettingsBackTarget } from '@/features/settings/settings-nav-state';
import { useLocaleStore } from '@/stores/locale-store';
import { useSettingsModeStore } from '@/stores/settings-mode-store';
import { useSettingsRailStore } from '@/stores/settings-rail-store';

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

const mobileToolbarButtonClass = cn(
  'inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-fg-muted transition-colors duration-200 ease-out',
  'hover:bg-surface-hover hover:text-fg',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
  APP_CHROME_NO_DRAG_CLASS,
);

function visibleSettingsNavTabs(group: SettingsShellNavGroup, settingsMode: ReturnType<typeof useSettingsModeStore.getState>['mode']) {
  return group.tabs.filter((tab) => {
    if (!isSettingsTabVisibleInMode(tab, settingsMode)) {
      return false;
    }
    return !ELECTRON_ONLY_SETTINGS_TABS.has(tab) || isElectron();
  });
}

function SettingsNavGroupBlock({
  group,
  groupIndex,
  language,
  location,
  settingsMode,
}: {
  group: SettingsShellNavGroup;
  groupIndex: number;
  language: StoredLanguage;
  location: ReturnType<typeof useLocation>;
  settingsMode: ReturnType<typeof useSettingsModeStore.getState>['mode'];
}) {
  const m = messages(language);
  const tabs = visibleSettingsNavTabs(group, settingsMode);
  if (tabs.length === 0) {
    return null;
  }
  return (
    <div>
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
          <NavLink
            key={tab}
            to={pathForTab(tab)}
            state={location.state}
            onMouseEnter={() => preloadRouteForPath(pathForTab(tab))}
            onFocus={() => preloadRouteForPath(pathForTab(tab))}
            className={({ isActive: routerActive }) =>
              settingsNavLinkClass({
                isActive: routerActive,
              })
            }
          >
            <TabIcon tab={tab} className="size-5 shrink-0 opacity-90" />
            <span className="min-w-0 flex-1 truncate">{tabLabel(language, tab)}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}

/** Full-screen settings: desktop rail; mobile uses a toolbar + slide-over nav. */
export const SettingsPageLayout = memo(function SettingsPageLayout() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const location = useLocation();
  const settingsMode = useSettingsModeStore((s) => s.mode);
  const settingsRailWidthPx = useSettingsRailStore((s) => s.widthPx);
  const setSettingsRailWidthPx = useSettingsRailStore((s) => s.setWidthPx);
  const [widthResizing, setWidthResizing] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  /** Full-screen portal only: rail touches window edge and needs traffic-light inset on macOS Electron. */
  const settingsPortalFullscreen = useMediaQuery(SETTINGS_SHEET_PORTAL_BODY_MQ);
  const darwinTitlebarPad =
    settingsPortalFullscreen && isElectronDarwin() ? electronDarwinTitlebarLeftPad() : '';

  const onSettingsRailResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      setWidthResizing(true);
      const startX = e.clientX;
      const startW = useSettingsRailStore.getState().widthPx;
      const pid = e.pointerId;
      const onMove = (ev: PointerEvent) => {
        setSettingsRailWidthPx(startW + (ev.clientX - startX));
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
    [setSettingsRailWidthPx],
  );

  const backTo = resolveSettingsBackTarget(location.state);
  const backLabel = m.sidebar.backToApp;

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

  const railNavGroups: SettingsShellNavGroup[] = useMemo(
    () => [...SETTINGS_SHELL_NAV_GROUPS, ...(isElectron() ? [ELECTRON_SYSTEM_NAV_GROUP] : [])],
    [],
  );

  const activeSettingsTab = useMemo(
    () =>
      railNavGroups
        .flatMap((group) => visibleSettingsNavTabs(group, settingsMode))
        .find((tab) =>
          location.pathname === pathForTab(tab),
        ),
    [location, railNavGroups, settingsMode],
  );

  const settingsPathBlocked = !isSettingsPathVisibleInMode(location.pathname, settingsMode);

  const activeTitle = activeSettingsTab ? tabLabel(language, activeSettingsTab) : m.nav.settings;

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname, location.search]);

  const railNav = (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-4 pt-2"
        aria-label={m.nav.settings}
      >
        <div className="flex flex-col gap-1">
          {railNavGroups.map((group, groupIndex) => (
            <SettingsNavGroupBlock
              key={group.id}
              group={group}
              groupIndex={groupIndex}
              language={language}
              location={location}
              settingsMode={settingsMode}
            />
          ))}
          <ExtensionSettingsNav
            navLinkClassName={settingsNavLinkClass}
            showAdvanced={settingsMode === 'advanced'}
          />
        </div>
      </nav>
      <SettingsModeToggle />
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 border-b border-edge-subtle bg-surface-panel px-3 py-2 md:hidden',
          APP_CHROME_DRAG_CLASS,
        )}
      >
        <Link to={backTo} className={mobileToolbarButtonClass} title={backLabel} aria-label={backLabel}>
          <ArrowLeft className="size-5" strokeWidth={1.75} aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{m.nav.settings}</p>
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{activeTitle}</h1>
        </div>
        <button
          type="button"
          className={mobileToolbarButtonClass}
          onClick={() => setMobileNavOpen(true)}
          aria-label={m.nav.settings}
          aria-expanded={mobileNavOpen}
        >
          <Menu className="size-5" strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-60 md:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-scrim/45 backdrop-blur-[1px]"
            onClick={() => setMobileNavOpen(false)}
            aria-label={m.nav.settings}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(20rem,calc(100vw-3rem))] flex-col bg-surface-base shadow-float">
            <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-4">
              {backControl}
              <button
                type="button"
                className={mobileToolbarButtonClass}
                onClick={() => setMobileNavOpen(false)}
                aria-label={m.nav.settings}
              >
                <X className="size-5" strokeWidth={1.75} aria-hidden />
              </button>
            </div>
            {railNav}
          </aside>
        </div>
      ) : null}

      {/* Left: surface-base — no border vs right; §2.1 */}
      <div
        className={cn(
          'relative hidden shrink-0 flex-col bg-surface-base md:flex',
          'md:h-full md:min-h-0 md:shrink-0 md:overflow-hidden',
          'settings-page-rail',
          widthResizing && 'settings-page-rail-resizing',
        )}
        style={
          {
            '--settings-rail-px': `${settingsRailWidthPx}px`,
          } as CSSProperties
        }
      >
        <div
          className={cn(
            'flex shrink-0 items-center justify-start pb-2 pt-4',
            APP_CHROME_DRAG_CLASS,
            darwinTitlebarPad,
            settingsPortalFullscreen && isElectronDarwin() ? 'pr-4' : 'px-4',
          )}
        >
          {backControl}
        </div>

        {railNav}

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
            widthResizing && 'bg-surface-hover/30 before:bg-edge/80! dark:before:bg-edge/85!',
            'transition-[background-color] duration-150',
            'touch-none select-none',
            APP_CHROME_NO_DRAG_CLASS,
          )}
        />
      </div>

      {/* Right: surface-panel — elevated vs left rail */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-surface-panel scrollbar-gutter-both">
        {settingsPathBlocked ? <Navigate to="/settings/overview" replace /> : <Outlet />}
      </div>
    </div>
  );
});
