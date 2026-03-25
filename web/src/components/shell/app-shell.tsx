import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import { BrandLogo } from '@/components/shell/brand-logo';
import { ConnectionIndicator } from '@/components/shell/connection-indicator';
import { HeaderPreferencesPopover } from '@/components/shell/header-preferences-popover';
import { LanguageToggle } from '@/components/shell/language-toggle';
import { SidebarNav } from '@/components/shell/sidebar';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { TokenDialog } from '@/components/shell/token-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { GatewaySseBridge } from '@/features/gateway/gateway-sse-bridge';
import { useLocaleStore } from '@/stores/locale-store';
import { useSidebarStore } from '@/stores/sidebar-store';

const LG_MIN = '(min-width: 1024px)';

/** Align with `ui` `navigate-to-chat` custom event from session manager. */
function NavigateToChatListener() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ sessionKey: string }>).detail;
      if (d?.sessionKey) {
        navigate(`/chat/${encodeURIComponent(d.sessionKey)}`);
      }
    };
    window.addEventListener('navigate-to-chat', handler as EventListener);
    return () => window.removeEventListener('navigate-to-chat', handler as EventListener);
  }, [navigate]);
  return null;
}

export function AppShell() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { pathname } = useLocation();

  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const toggleSidebarCollapsed = useSidebarStore((s) => s.toggleCollapsed);

  const navCollapsed = sidebarCollapsed && !mobileNavOpen;

  // Key for the content area — changes only on top-level route segment so sub-routes
  // (e.g. /chat/new → /chat/:key) don't re-trigger the enter animation.
  const routeKey = pathname.split('/')[1] ?? 'root';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(LG_MIN);
    const onChange = () => {
      if (mq.matches) setMobileNavOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-base">
      <GatewaySseBridge />
      <NavigateToChatListener />
      <TokenDialog />

      {/* Full-width app bar (design: content surface + top strip) */}
      <header className="flex shrink-0 items-center gap-2 border-b border-edge bg-surface-panel px-3 py-2 sm:gap-3 sm:px-6 lg:px-8 dark:border-edge">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
          <Button
            type="button"
            variant="ghost"
            className="hidden size-8 shrink-0 rounded-xl p-0 lg:inline-flex"
            aria-expanded={!sidebarCollapsed}
            aria-controls="app-sidebar"
            aria-label={sidebarCollapsed ? m.sidebarExpand : m.sidebarCollapse}
            onClick={() => toggleSidebarCollapsed()}
          >
            <Menu className="size-4" strokeWidth={1.5} />
          </Button>
          <BrandLogo className="size-8 rounded-xl max-[374px]:size-7" alt="" aria-hidden />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="truncate text-sm font-semibold tracking-tight text-fg">{m.appBrand}</span>
              <span className="hidden truncate text-xs font-normal text-fg-subtle sm:inline">{m.appSubtitle}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2 lg:gap-3">
          <ConnectionIndicator iconOnly className="lg:hidden" />
          <div className="hidden items-center gap-1.5 sm:gap-2 lg:flex">
            <LanguageToggle />
            <ThemeToggle />
          </div>
          <div className="lg:hidden">
            <HeaderPreferencesPopover />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="h-8 shrink-0 px-2 lg:hidden"
            aria-expanded={mobileNavOpen}
            aria-controls="app-sidebar"
            aria-label="Menu"
            onClick={() => setMobileNavOpen((o) => !o)}
          >
            <Menu className="size-3.5" strokeWidth={1.5} />
          </Button>
        </div>
      </header>

      {/* Sidebar + main: flex push (no fixed overlay on mobile). */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        <aside
          id="app-sidebar"
          className={cn(
            'app-sidebar-push flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-surface-base',
            'max-lg:min-w-0',
            mobileNavOpen
              ? 'max-lg:w-[min(18rem,85vw)] max-lg:border-r max-lg:border-edge dark:max-lg:border-edge'
              : 'max-lg:w-0 max-lg:border-0',
            sidebarCollapsed ? 'lg:w-[4.5rem] lg:border-r lg:border-edge dark:lg:border-edge' : 'lg:w-60 lg:border-r lg:border-edge dark:lg:border-edge',
          )}
        >
          {mobileNavOpen ? (
            <div className="flex shrink-0 items-center justify-end border-b border-edge-subtle px-3 py-2 lg:hidden dark:border-edge">
              <Button
                type="button"
                variant="ghost"
                className="size-8 shrink-0 rounded-xl p-0"
                aria-label={m.closeMenu}
                onClick={() => setMobileNavOpen(false)}
              >
                <X className="size-4" strokeWidth={1.5} />
              </Button>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-2">
            <SidebarNav
              collapsed={navCollapsed}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </div>
          <div
            className={cn(
              'shrink-0 border-t border-edge-subtle dark:border-edge',
              navCollapsed ? 'px-1 py-2' : 'px-4 py-3',
            )}
          >
            <ConnectionIndicator compact={navCollapsed} />
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-panel">
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* key on the top-level segment so sub-route changes (e.g. /chat/new → /chat/:id)
                don't re-trigger the enter animation, only real page switches do. */}
            <div key={routeKey} className="page-enter flex min-h-0 flex-1 flex-col">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
