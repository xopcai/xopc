import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { GatewayConnectLanding } from '@/components/shell/gateway-connect-landing';
import { OnboardingDialog } from '@/components/shell/onboarding-dialog';
import { PrimaryAppHeader } from '@/components/shell/primary-app-header';
import { SidebarColumn } from '@/components/shell/sidebar-column';
import { WorkspaceColumn } from '@/components/shell/workspace-column';
import { TokenDialog } from '@/components/shell/token-dialog';
import { ElectronGatewayExitBanner } from '@/features/electron/electron-gateway-exit-banner';
import { ExtensionCommandPaletteHost } from '@/features/extensions/extension-command-palette';
import { GatewaySseBridge } from '@/features/gateway/gateway-sse-bridge';
import { WorkspacePreviewDialog } from '@/features/workspace/workspace-preview-dialog';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

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

/** Extension iframe `ui.navigate` — navigate within hash router. */
function ExtensionNavigateListener() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ path?: string }>).detail;
      const path = typeof d?.path === 'string' ? d.path.trim() : '';
      if (path) {
        navigate(path.startsWith('/') ? path : `/${path}`);
      }
    };
    window.addEventListener('extension-navigate', handler as EventListener);
    return () => window.removeEventListener('extension-navigate', handler as EventListener);
  }, [navigate]);
  return null;
}

type ExtensionNotificationDetail = {
  type?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  message?: string;
  duration?: number;
};

function ExtensionNotificationListener() {
  const [toast, setToast] = useState<ExtensionNotificationDetail | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<ExtensionNotificationDetail>).detail;
      if (!d || typeof d.title !== 'string' || !d.title.trim()) return;
      setToast({
        type: d.type ?? 'info',
        title: d.title.trim(),
        message: typeof d.message === 'string' ? d.message : undefined,
        duration: d.duration,
      });
      const ms = d.duration === 0 ? 0 : (d.duration ?? 5000);
      if (ms > 0) {
        window.setTimeout(() => setToast(null), ms);
      }
    };
    window.addEventListener('extension-notification', handler as EventListener);
    return () => window.removeEventListener('extension-notification', handler as EventListener);
  }, []);

  if (!toast) return null;
  const accent =
    toast.type === 'error'
      ? 'border-red-500/40 bg-red-500/10'
      : toast.type === 'warning'
        ? 'border-amber-500/40 bg-amber-500/10'
        : toast.type === 'success'
          ? 'border-emerald-500/40 bg-emerald-500/10'
          : 'border-edge bg-surface-panel';

  return (
    <div
      className={`pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-1 rounded-lg border px-4 py-3 text-sm shadow-elevated ${accent}`}
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto font-medium text-fg">{toast.title}</div>
      {toast.message ? <div className="pointer-events-auto text-fg-muted">{toast.message}</div> : null}
    </div>
  );
}

export function AppShell() {
  const token = useGatewayStore((s) => s.token);
  const { pathname } = useLocation();
  const isSettingsRoute = pathname.startsWith('/settings');
  const language = useLocaleStore((s) => s.language);

  if (!token) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-base">
        <GatewayConnectLanding />
      </div>
    );
  }

  // Key for the content area — changes only on top-level route segment so sub-routes
  // (e.g. /chat/new → /chat/:key) don't re-trigger the enter animation.
  const routeKey = pathname.split('/')[1] ?? 'root';

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-base">
      <a
        href="#app-main-content"
        className="sr-only z-[80] rounded-lg bg-surface-panel px-3 py-2 text-sm text-fg shadow-elevated focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {language === 'zh' ? '跳到主要内容' : 'Skip to main content'}
      </a>
      <GatewaySseBridge />
      <NavigateToChatListener />
      <ExtensionNavigateListener />
      <ExtensionCommandPaletteHost />
      <ExtensionNotificationListener />
      <TokenDialog />
      <ElectronGatewayExitBanner />
      <OnboardingDialog />

      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        {!isSettingsRoute ? <SidebarColumn /> : null}

        {/* Main + workspace: workspace is a right rail sibling (not a dialog), like app-sidebar */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden bg-surface-panel">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {!isSettingsRoute ? <PrimaryAppHeader /> : null}
            <main id="app-main-content" className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
          {!isSettingsRoute ? <WorkspaceColumn /> : null}
        </div>
      </div>
      {!isSettingsRoute ? <WorkspacePreviewDialog /> : null}
    </div>
  );
}
