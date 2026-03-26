import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { SidebarColumn } from '@/components/shell/sidebar-column';
import { TokenDialog } from '@/components/shell/token-dialog';
import { GatewaySseBridge } from '@/features/gateway/gateway-sse-bridge';
import { cn } from '@/lib/cn';

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
  const { pathname } = useLocation();
  const isSettingsRoute = pathname.startsWith('/settings');

  // Key for the content area — changes only on top-level route segment so sub-routes
  // (e.g. /chat/new → /chat/:key) don't re-trigger the enter animation.
  const routeKey = pathname.split('/')[1] ?? 'root';

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-base">
      <GatewaySseBridge />
      <NavigateToChatListener />
      <TokenDialog />

      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        {!isSettingsRoute ? <SidebarColumn /> : null}

        {/* Right column: chat title + prefs live in ChatPage (same row); settings are full-width */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-panel">
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              key={routeKey}
              className={cn(
                'page-enter flex min-h-0 flex-1 flex-col',
                routeKey === 'settings' && 'page-enter--gentle',
              )}
            >
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
