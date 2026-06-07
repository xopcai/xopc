import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { GatewayConnectLanding } from '@/components/shell/gateway-connect-landing';
import { ToastHost } from '@/components/ui/toast-host';
import { PrimaryAppHeader } from '@/components/shell/primary-app-header';
import { SidebarColumn } from '@/components/shell/sidebar-column';
import { WorkspaceColumn } from '@/components/shell/workspace-column';
import { TokenDialog } from '@/components/shell/token-dialog';
import { DesktopNotificationBridge } from '@/features/electron/desktop-notification-bridge';
import { ElectronGatewayExitBanner } from '@/features/electron/electron-gateway-exit-banner';
import { ElectronMenuListener } from '@/features/electron/electron-menu-listener';
import { GatewayRestartBanner } from '@/features/gateway/gateway-restart-banner';
import { UpdateReminderBar } from '@/features/updater/update-reminder-bar';
import { useUpdateReminder } from '@/features/updater/use-update-reminder';
import { GlobalCommandPaletteHost } from '@/features/search/global-command-palette/global-command-palette-host';
import { GatewaySseBridge } from '@/features/gateway/gateway-sse-bridge';
import { DreamingOverlay } from '@/features/dreaming/dreaming-overlay';
import { WorkspacePreviewDialog } from '@/features/workspace/workspace-preview-dialog';
import { OnboardingDialog } from '@/components/shell/onboarding-dialog';
import { TopBannerStack } from '@/components/shell/top-banner-stack';
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
    window.addEventListener('navigate-to-chat', handler);
    return () => window.removeEventListener('navigate-to-chat', handler);
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
    window.addEventListener('extension-navigate', handler);
    return () => window.removeEventListener('extension-navigate', handler);
  }, [navigate]);
  return null;
}

export function AppShell() {
  const token = useGatewayStore((s) => s.token);
  const { pathname } = useLocation();
  const isSettingsRoute = pathname.startsWith('/settings');
  const language = useLocaleStore((s) => s.language);
  const updateReminder = useUpdateReminder();

  if (!token) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-base">
        <ElectronMenuListener />
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
      <DreamingOverlay />
      <DesktopNotificationBridge />
      <ElectronMenuListener />
      <NavigateToChatListener />
      <ExtensionNavigateListener />
      <GlobalCommandPaletteHost />
      <ToastHost />
      <TokenDialog />
      <OnboardingDialog />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopBannerStack>
          <ElectronGatewayExitBanner />
          <UpdateReminderBar reminder={updateReminder} />
          <GatewayRestartBanner />
        </TopBannerStack>
        <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
          <SidebarColumn />

          {/* Main + workspace: workspace is a right rail sibling (not a dialog), like app-sidebar */}
          <div className="flex min-h-0 min-w-0 flex-1 min-w-0 flex-col overflow-hidden bg-surface-panel">
            <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {!isSettingsRoute ? <PrimaryAppHeader /> : null}
                <main id="app-main-content" className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div
                    key={routeKey}
                    className={cn(
                      'page-enter flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden',
                      routeKey === 'settings'
                        ? 'page-enter--gentle overflow-hidden'
                        : 'overflow-y-auto overscroll-contain [scrollbar-gutter:stable_both-edges]',
                    )}
                  >
                    <Outlet />
                  </div>
                </main>
              </div>
              {!isSettingsRoute ? <WorkspaceColumn /> : null}
            </div>
          </div>
        </div>
      </div>
      {!isSettingsRoute ? <WorkspacePreviewDialog /> : null}
    </div>
  );
}
