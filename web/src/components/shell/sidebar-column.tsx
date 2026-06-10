import { X } from 'lucide-react';
import { memo, useCallback, useEffect, useState, type CSSProperties } from 'react';

import { APP_CHROME_NO_DRAG_CLASS, APP_TOP_HEADER_BAR_CLASS } from '@/components/shell/app-chrome';
import { CommandPaletteSearchButton } from '@/components/shell/command-palette-search-button';
import { QuickCaptureButton } from '@/components/shell/quick-capture-button';
import { SidebarRailToggleButton } from '@/components/shell/sidebar-rail-toggle-button';
import { SidebarNav } from '@/components/shell/sidebar';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { electronDarwinTitlebarLeftPad, isElectronDarwin } from '@/lib/electron-window-chrome';
import { useAppShellStore } from '@/stores/app-shell-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useSidebarStore } from '@/stores/sidebar-store';

const MD_MIN = '(min-width: 768px)';

/**
 * Isolated sidebar shell: subscribes to nav/collapse stores here only so toggling
 * the rail does not re-render the main `<Outlet />` tree.
 *
 * Small viewports (`max-md`): fixed overlay drawer + `transform` (GPU-friendly); main column
 * stays full width. Tablet+ (`md+`): flex sibling with width transition on `.app-sidebar-push`.
 * `md+` collapsed: rail width `0` (no icon strip); expand control lives in `PrimaryAppHeader`.
 */
export const SidebarColumn = memo(function SidebarColumn() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const expandedWidthPx = useSidebarStore((s) => s.expandedWidthPx);
  const setExpandedWidthPx = useSidebarStore((s) => s.setExpandedWidthPx);
  const mobileNavOpen = useAppShellStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useAppShellStore((s) => s.setMobileNavOpen);
  const [widthResizing, setWidthResizing] = useState(false);

  const onSidebarResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (sidebarCollapsed) return;
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
    [sidebarCollapsed, setExpandedWidthPx],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setMobileNavOpen]);

  useEffect(() => {
    const mq = window.matchMedia(MD_MIN);
    const onChange = () => {
      if (mq.matches) setMobileNavOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setMobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const mq = window.matchMedia('(max-width: 767px)');
    if (!mq.matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  return (
    <>
      {mobileNavOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-scrim md:hidden"
          aria-label={m.closeMenu}
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside
        id="app-sidebar"
        className={cn(
          'app-sidebar-push flex min-h-0 shrink-0 flex-col overflow-hidden bg-surface-base',
          widthResizing && 'sidebar-width-resizing',
          // Mobile: overlay; animate with transform only (no main-column width reflow).
          'max-md:fixed max-md:left-0 max-md:top-0 max-md:z-50 max-md:h-[100dvh] max-md:w-[min(16rem,85vw)]',
          'max-md:transition-transform max-md:duration-200 max-md:ease-out',
          'motion-reduce:max-md:transition-none',
          mobileNavOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
          // Tablet+: in-flow rail
          'md:relative md:h-full md:translate-x-0',
          sidebarCollapsed ? 'md:w-0 md:min-w-0 md:max-w-0 md:overflow-hidden md:border-0' : 'app-sidebar-expanded-width',
        )}
        aria-hidden={sidebarCollapsed && !mobileNavOpen ? true : undefined}
        style={
          !sidebarCollapsed
            ? ({
                '--sidebar-expanded-px': `${expandedWidthPx}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <div
          className={cn(
            'flex bg-surface-base',
            APP_TOP_HEADER_BAR_CLASS,
            electronDarwinTitlebarLeftPad(),
            sidebarCollapsed
              ? 'justify-center gap-1 px-1.5 max-md:flex'
              : cn('justify-start gap-1.5', isElectronDarwin() ? 'pr-4' : 'px-4'),
            sidebarCollapsed && 'md:hidden',
          )}
        >
          {mobileNavOpen ? (
            <Button
              type="button"
              variant="ghost"
              className={cn('size-8 shrink-0 rounded-xl p-0 md:hidden', APP_CHROME_NO_DRAG_CLASS)}
              aria-label={m.closeMenu}
              title={m.closeMenu}
              onClick={() => setMobileNavOpen(false)}
            >
              <X className="size-4" strokeWidth={1.5} aria-hidden />
            </Button>
          ) : null}
          {!sidebarCollapsed ? (
            <>
              <SidebarRailToggleButton variant="sidebar" />
              <QuickCaptureButton className="inline-flex" />
              <CommandPaletteSearchButton className="inline-flex" />
            </>
          ) : null}
        </div>
        <SidebarNav collapsed={false} onNavigate={() => setMobileNavOpen(false)} />
        {!sidebarCollapsed ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={m.sidebar.resizeHandleAria}
            onPointerDown={onSidebarResizePointerDown}
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
        ) : null}
      </aside>
    </>
  );
});
