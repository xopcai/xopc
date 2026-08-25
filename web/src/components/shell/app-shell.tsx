import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { APP_CHROME_BAR_CLASS, APP_CHROME_DRAG_CLASS } from '@/components/shell/app-chrome';
import { GatewayConnectLanding } from '@/components/shell/gateway-connect-landing';
import { PrimaryAppHeader } from '@/components/shell/primary-app-header';
import { SidebarColumn } from '@/components/shell/sidebar-column';
import { WorkspaceColumn } from '@/components/shell/workspace-column';
import { SideChatColumn } from '@/features/side-chat/side-chat-column';
import { SideChatSelectionLauncher } from '@/features/side-chat/side-chat-selection-launcher';
import { TokenDialog } from '@/components/shell/token-dialog';
import { WindowsTitlebar } from '@/components/shell/windows-titlebar';
import { ElectronGatewayExitBanner } from '@/features/electron/electron-gateway-exit-banner';
import { EndpointToolBridge } from '@/features/endpoint-tools/endpoint-tool-bridge';
import { ElectronMenuListener } from '@/features/electron/electron-menu-listener';
import { GatewayRestartBanner } from '@/features/gateway/gateway-restart-banner';
import { UpdateReminderBar } from '@/features/updater/update-reminder-bar';
import { useUpdateReminder } from '@/features/updater/use-update-reminder';
import { GlobalCommandPaletteHost } from '@/features/search/global-command-palette/global-command-palette-host';
import { GlobalQuickCaptureHost } from '@/features/notes/global-quick-capture';
import { GlobalDiscussionCaptureHost } from '@/features/discussions/global-discussion-capture';
import { GatewayRealtimeBridge } from '@/features/gateway/gateway-realtime-bridge';
import { AgentRunNotificationCoordinator } from '@/features/notifications/agent-run-notification-coordinator';
import { WorkspacePreviewPane } from '@/features/workspace/workspace-preview-pane';
import { GlobalReadAloudPlayer } from '@/features/voice/global-read-aloud-player';
import { GlobalVoiceInputShortcutHost } from '@/features/voice/global-voice-input-shortcut-host';
import { closeTaskDetailModalHref, TASK_DETAIL_MODAL_PARAM } from '@/features/tasks/task-detail-route';
import { OnboardingDialog } from '@/components/shell/onboarding-dialog';
import { TopBannerStack } from '@/components/shell/top-banner-stack';
import { UnderstandingStatusButton } from '@/features/work-discovery/understanding-status-button';
import {
  closeWorkDiscoveryOverlaySearch,
  isWorkDiscoveryOverlaySearch,
} from '@/features/work-discovery/work-discovery-navigation';
import { cn } from '@/lib/cn';
import { isElectronDarwin } from '@/lib/electron-window-chrome';
import { loadTaskDetailPage, loadWorkDiscoveryOverlay } from '@/lib/route-preload';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';
import { useSideChatStore } from '@/stores/side-chat-store';

const WorkDiscoveryOverlay = lazy(() =>
  loadWorkDiscoveryOverlay().then((module) => ({ default: module.WorkDiscoveryOverlay })),
);
const TaskDetailModal = lazy(() =>
  loadTaskDetailPage().then((module) => ({ default: module.TaskDetailModal })),
);

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
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const isSettingsRoute = pathname.startsWith('/settings');
  const isWorkDiscoveryRoute = pathname === '/onboarding/workspace';
  const language = useLocaleStore((s) => s.language);
  const updateReminder = useUpdateReminder();
  const previewPath = useWorkspacePreviewStore((s) => s.path);
  const chatPathSessionKey = pathname.startsWith('/chat/task/')
    ? ''
    : pathname.startsWith('/chat/') ? pathname.slice('/chat/'.length) : '';
  const parentSessionKey = chatPathSessionKey && chatPathSessionKey !== 'new'
    ? decodeURIComponent(chatPathSessionKey)
    : null;
  const sideChatOpen = useSideChatStore((s) => (
    parentSessionKey ? s.panes[parentSessionKey]?.open === true : false
  ));
  const showWorkDiscoveryOverlay = pathname === '/you' && isWorkDiscoveryOverlaySearch(search);
  const taskModalId = pathname.startsWith('/tasks/')
    ? null
    : new URLSearchParams(search).get(TASK_DETAIL_MODAL_PARAM);
  const taskModalBackgroundPath = closeTaskDetailModalHref(pathname, search);
  const [workDiscoveryOverlayMounted, setWorkDiscoveryOverlayMounted] = useState(showWorkDiscoveryOverlay);

  useEffect(() => {
    if (showWorkDiscoveryOverlay) setWorkDiscoveryOverlayMounted(true);
  }, [showWorkDiscoveryOverlay]);

  const closeWorkDiscoveryOverlay = useCallback(() => {
    navigate(
      { pathname, search: closeWorkDiscoveryOverlaySearch(search) },
      { replace: true },
    );
  }, [navigate, pathname, search]);
  const finishWorkDiscoveryOverlayExit = useCallback(() => {
    setWorkDiscoveryOverlayMounted(false);
    if (showWorkDiscoveryOverlay) closeWorkDiscoveryOverlay();
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-work-discovery-trigger]')?.focus({ preventScroll: true });
    });
  }, [closeWorkDiscoveryOverlay, showWorkDiscoveryOverlay]);
  const closeTaskDetailModal = useCallback(() => {
    navigate(taskModalBackgroundPath, { replace: true });
  }, [navigate, taskModalBackgroundPath]);

  if (!token) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-base">
        <a
          href="#app-main-content"
          className="sr-only z-[80] rounded-lg bg-surface-panel px-3 py-2 text-sm text-fg shadow-elevated focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {language === 'zh' ? '跳到主要内容' : 'Skip to main content'}
        </a>
        <WindowsTitlebar />
        <ElectronMenuListener />
        <div className="min-h-0 flex-1">
          <GatewayConnectLanding />
        </div>
      </div>
    );
  }

  // Key for the content area — changes only on top-level route segment so sub-routes
  // (e.g. /chat/new → /chat/:key) don't re-trigger the enter animation.
  const routeKey = pathname.split('/')[1] || 'root';
  /** Routes that scroll inside the page (not on this shell wrapper). */
  const routeUsesInternalScroll = routeKey === 'chat' || routeKey === 'notes';

  if (isWorkDiscoveryRoute) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-base">
        <EndpointToolBridge />
        <GatewayRealtimeBridge />
        <AgentRunNotificationCoordinator />
        <ElectronMenuListener />
        <WindowsTitlebar />
        <UnderstandingStatusButton floating />
        {isElectronDarwin() ? (
          <div
            className={cn('w-full', APP_CHROME_BAR_CLASS, APP_CHROME_DRAG_CLASS)}
            aria-hidden="true"
          />
        ) : null}
        <main id="app-main-content" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-base">
      <EndpointToolBridge />
      <a
        href="#app-main-content"
        className="sr-only z-[80] rounded-lg bg-surface-panel px-3 py-2 text-sm text-fg shadow-elevated focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {language === 'zh' ? '跳到主要内容' : 'Skip to main content'}
      </a>
      <GatewayRealtimeBridge />
      <AgentRunNotificationCoordinator />
      <ElectronMenuListener />
      <NavigateToChatListener />
      <ExtensionNavigateListener />
      <GlobalCommandPaletteHost />
      <GlobalQuickCaptureHost />
      <GlobalDiscussionCaptureHost />
      <GlobalVoiceInputShortcutHost />
      <GlobalReadAloudPlayer />
      <SideChatSelectionLauncher />
      <TokenDialog />
      <OnboardingDialog />
      {taskModalId ? (
        <Suspense fallback={null}>
          <TaskDetailModal taskId={taskModalId} backgroundPath={taskModalBackgroundPath} onClose={closeTaskDetailModal} />
        </Suspense>
      ) : null}
      {workDiscoveryOverlayMounted ? (
        <Suspense fallback={null}>
          <WorkDiscoveryOverlay
            requestedOpen={showWorkDiscoveryOverlay}
            onExited={finishWorkDiscoveryOverlayExit}
          />
        </Suspense>
      ) : null}
      <div className="app-chrome-shell flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <WindowsTitlebar />
        <TopBannerStack>
          <ElectronGatewayExitBanner />
          <UpdateReminderBar reminder={updateReminder} />
          <GatewayRestartBanner />
        </TopBannerStack>
        <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
          <SidebarColumn />

          {/* Main + workspace: workspace is a right rail sibling (not a dialog), like app-sidebar */}
          <div className="app-main-surface relative flex min-h-0 min-w-0 flex-1 min-w-0 flex-col overflow-hidden bg-surface-panel">
            <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {!isSettingsRoute && !previewPath ? <PrimaryAppHeader /> : null}
                <main id="app-main-content" className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  {previewPath != null && !taskModalId ? (
                    <WorkspacePreviewPane />
                  ) : (
                    <div
                      key={routeKey}
                      className={cn(
                        'page-enter flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-surface-panel',
                        routeKey === 'settings'
                          ? 'page-enter--gentle overflow-hidden'
                          : routeUsesInternalScroll
                            ? 'overflow-hidden'
                            : 'overflow-y-auto overscroll-contain [scrollbar-gutter:stable_both-edges]',
                      )}
                    >
                      <Outlet />
                    </div>
                  )}
                </main>
              </div>
              {!isSettingsRoute ? (
                sideChatOpen && parentSessionKey && !taskModalId
                  ? <SideChatColumn parentSessionKey={parentSessionKey} />
                  : <WorkspaceColumn elevated={Boolean(taskModalId)} />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
