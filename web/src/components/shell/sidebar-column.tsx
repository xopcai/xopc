import { PanelLeft, PanelRight, X } from 'lucide-react';
import { memo, useEffect } from 'react';

import { APP_TOP_HEADER_BAR_CLASS } from '@/components/shell/app-chrome';
import { SidebarNav } from '@/components/shell/sidebar';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useAppShellStore } from '@/stores/app-shell-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useSidebarStore } from '@/stores/sidebar-store';

const LG_MIN = '(min-width: 1024px)';

/**
 * Isolated sidebar shell: subscribes to nav/collapse stores here only so toggling
 * the rail does not re-render the main `<Outlet />` tree.
 *
 * Mobile (`max-lg`): fixed overlay drawer + `transform` (GPU-friendly); main column
 * stays full width. Desktop (`lg+`): flex sibling with width transition on `.app-sidebar-push`.
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
    const mq = window.matchMedia(LG_MIN);
    const onChange = () => {
      if (mq.matches) setMobileNavOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setMobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const mq = window.matchMedia('(max-width: 1023px)');
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
          className="fixed inset-0 z-40 bg-scrim lg:hidden"
          aria-label={m.closeMenu}
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside
        id="app-sidebar"
        className={cn(
          'app-sidebar-push flex min-h-0 shrink-0 flex-col overflow-hidden bg-surface-base',
          // Mobile: overlay; animate with transform only (no main-column width reflow).
          'max-lg:fixed max-lg:left-0 max-lg:top-0 max-lg:z-50 max-lg:h-[100dvh] max-lg:w-[min(18rem,85vw)]',
          'max-lg:transition-transform max-lg:duration-200 max-lg:ease-out',
          'motion-reduce:max-lg:transition-none',
          mobileNavOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
          // Desktop: in-flow rail
          'lg:relative lg:h-full lg:translate-x-0',
          sidebarCollapsed ? 'lg:w-[4.5rem]' : 'lg:w-60',
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
              className="size-8 shrink-0 rounded-xl p-0 lg:hidden"
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
            className="hidden size-8 shrink-0 rounded-xl p-0 lg:inline-flex"
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
