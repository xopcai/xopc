import { PanelLeft, PanelRight, X } from 'lucide-react';
import { memo, useEffect } from 'react';

import { APP_CHROME_NO_DRAG_CLASS, APP_TOP_HEADER_BAR_CLASS } from '@/components/shell/app-chrome';
import { SidebarNav } from '@/components/shell/sidebar';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
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
 */
export const SidebarColumn = memo(function SidebarColumn() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const toggleSidebarCollapsed = useSidebarStore((s) => s.toggleCollapsed);
  const mobileNavOpen = useAppShellStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useAppShellStore((s) => s.setMobileNavOpen);
  const navCollapsed = sidebarCollapsed && !mobileNavOpen;

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
          // Mobile: overlay; animate with transform only (no main-column width reflow).
          'max-md:fixed max-md:left-0 max-md:top-0 max-md:z-50 max-md:h-[100dvh] max-md:w-[min(16rem,85vw)]',
          'max-md:transition-transform max-md:duration-200 max-md:ease-out',
          'motion-reduce:max-md:transition-none',
          mobileNavOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
          // Tablet+: in-flow rail
          'md:relative md:h-full md:translate-x-0',
          sidebarCollapsed ? 'md:w-[4.5rem]' : 'md:w-64',
        )}
      >
        <div
          className={cn(
            'flex bg-surface-base',
            sidebarCollapsed ? 'justify-center gap-1 px-1.5' : 'justify-end gap-1.5 px-4',
            APP_TOP_HEADER_BAR_CLASS,
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
          <Button
            type="button"
            variant="ghost"
            className={cn(
              'hidden size-8 shrink-0 rounded-xl p-0 md:inline-flex',
              APP_CHROME_NO_DRAG_CLASS,
            )}
            aria-expanded={!sidebarCollapsed}
            aria-controls="app-sidebar"
            aria-label={sidebarCollapsed ? m.sidebarExpand : m.sidebarCollapse}
            title={sidebarCollapsed ? m.sidebarExpand : m.sidebarCollapse}
            onClick={() => toggleSidebarCollapsed()}
          >
            {sidebarCollapsed ? (
              <PanelRight className="size-4" strokeWidth={1.5} aria-hidden />
            ) : (
              <PanelLeft className="size-4" strokeWidth={1.5} aria-hidden />
            )}
          </Button>
        </div>
        <SidebarNav collapsed={navCollapsed} onNavigate={() => setMobileNavOpen(false)} />
      </aside>
    </>
  );
});
