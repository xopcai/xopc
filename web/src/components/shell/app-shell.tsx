import { Menu, PanelLeft, PanelRight, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { messages } from '@/i18n/messages';
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
  const [isLg, setIsLg] = useState(false);
  const { pathname } = useLocation();

  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const toggleSidebarCollapsed = useSidebarStore((s) => s.toggleCollapsed);

  const navCollapsed = sidebarCollapsed && !mobileNavOpen;

  /** Desktop collapsed rail or mobile drawer closed: new chat lives in the header. */
  const showHeaderNewChat = (isLg && sidebarCollapsed) || (!isLg && !mobileNavOpen);

  useEffect(() => {
    const mq = window.matchMedia(LG_MIN);
    const sync = () => setIsLg(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

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
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            className="hidden size-8 shrink-0 rounded-xl p-0 lg:inline-flex"
            aria-expanded={!sidebarCollapsed}
            aria-controls="app-sidebar"
            aria-label={sidebarCollapsed ? m.sidebarExpand : m.sidebarCollapse}
            onClick={() => toggleSidebarCollapsed()}
          >
            {sidebarCollapsed ? (
              <PanelRight className="size-4" strokeWidth={1.5} aria-hidden />
            ) : (
              <PanelLeft className="size-4" strokeWidth={1.5} aria-hidden />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="size-8 shrink-0 rounded-xl p-0 lg:hidden"
            aria-expanded={mobileNavOpen}
            aria-controls="app-sidebar"
            aria-label={mobileNavOpen ? m.closeMenu : m.openMenu}
            onClick={() => setMobileNavOpen((o) => !o)}
          >
            {mobileNavOpen ? (
              <X className="size-4" strokeWidth={1.5} aria-hidden />
            ) : (
              <Menu className="size-4" strokeWidth={1.5} aria-hidden />
            )}
          </Button>
          {showHeaderNewChat ? (
            <Link
              to="/chat/new"
              className={cn(
                'inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-fg-muted transition-colors',
                'hover:bg-surface-hover hover:text-accent-fg',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
              )}
              aria-label={m.sidebar.newTask}
              title={m.sidebar.newTask}
            >
              <Plus className="size-4" strokeWidth={1.75} aria-hidden />
            </Link>
          ) : null}
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
          <SidebarNav
            collapsed={navCollapsed}
            hideNewTaskLink={showHeaderNewChat}
            onNavigate={() => setMobileNavOpen(false)}
          />
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
