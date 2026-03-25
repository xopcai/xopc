import { PanelLeft, PanelRight, X } from 'lucide-react';
import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import { SidebarNav } from '@/components/shell/sidebar';
import { TokenDialog } from '@/components/shell/token-dialog';
import { Button } from '@/components/ui/button';
import { APP_TOP_HEADER_BAR_CLASS } from '@/components/shell/app-chrome';
import { cn } from '@/lib/cn';
import { GatewaySseBridge } from '@/features/gateway/gateway-sse-bridge';
import { useAppShellStore } from '@/stores/app-shell-store';
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
  const { pathname } = useLocation();

  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const toggleSidebarCollapsed = useSidebarStore((s) => s.toggleCollapsed);

  const mobileNavOpen = useAppShellStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useAppShellStore((s) => s.setMobileNavOpen);

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
  }, [setMobileNavOpen]);

  useEffect(() => {
    const mq = window.matchMedia(LG_MIN);
    const onChange = () => {
      if (mq.matches) setMobileNavOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setMobileNavOpen]);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-base">
      <GatewaySseBridge />
      <NavigateToChatListener />
      <TokenDialog />

      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
      {/* Left column: sidebar rail + top-right collapse (desktop) / close (mobile drawer) */}
      <aside
        id="app-sidebar"
        className={cn(
          'app-sidebar-push flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-surface-base',
          'max-lg:min-w-0',
          mobileNavOpen
            ? 'max-lg:w-[min(18rem,85vw)]'
            : 'max-lg:w-0',
          sidebarCollapsed ? 'lg:w-[4.5rem]' : 'lg:w-60',
        )}
      >
        <div
          className={cn(
            'flex justify-end gap-0.5 bg-surface-base px-2',
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

      {/* Right column: chat title + prefs live in ChatPage (same row); other routes fill as needed */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-panel">
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div key={routeKey} className="page-enter flex min-h-0 flex-1 flex-col">
            <Outlet />
          </div>
        </main>
      </div>
      </div>
    </div>
  );
}
