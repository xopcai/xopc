import { lazy, Suspense, useEffect } from 'react';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';

import { AppShell } from '@/components/shell/app-shell';
import { RouteErrorFallback } from '@/components/errors/app-error-boundary';
import { SettingsPageLayout } from '@/components/shell/settings-page-layout';
import { SettingsSheet } from '@/components/shell/settings-sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ChatPage } from '@/features/chat/chat-page';
import { ChatRouteLayout } from '@/features/chat/chat-route-layout';
import { CHAT_SESSION_ROUTE_PATH } from '@/features/chat/chat-session-route';
import { TaskChatPage } from '@/features/chat/task/task-chat-page';
import { DesktopPetEventBridge } from '@/features/desktop-pet/desktop-pet-event-bridge';
import { ExtensionProvider } from '@/features/extensions/extension-provider';
import {
  loadAgentBrowserSettingsPage,
  loadComputerSettingsPage,
  loadAutomationsPage,
  loadScenesPage,
  loadBrowserAutomationsPage,
  loadHomePage,
  loadTaskDetailPage,
  loadProjectDetailPage,
  loadProjectsPage,
  loadExtensionDebugPage,
  loadExtensionPage,
  loadExtensionSettingsPage,
  loadLogsPage,
  loadNotesPage,
  loadSettingsPage,
  loadSharePreviewPage,
  loadSessionsPage,
  loadUsagePage,
  loadUserModelPage,
  loadWorkflowsPage,
  loadLocalAppsPage,
  loadLocalAppWorkbenchPage,
  loadProductOpenPage,
  loadCapabilitiesSettingsPanel,
  loadWorkDiscoveryPage,
} from '@/lib/route-preload';
import { SwrProvider } from '@/providers/swr-provider';
import { syncFontScaleAfterHydration, useFontScaleStore } from '@/stores/font-scale-store';
import { syncElectronLocaleAfterHydration } from '@/stores/locale-store';
import { subscribeSystemTheme, syncThemeAfterHydration, useThemeStore } from '@/stores/theme-store';

const SessionsPage = lazy(() => loadSessionsPage().then((m) => ({ default: m.SessionsPage })));
const UsageSettingsPage = lazy(() => loadUsagePage().then((m) => ({ default: m.UsageSettingsPage })));
const AutomationsPage = lazy(() => loadAutomationsPage().then((m) => ({ default: m.AutomationsPage })));
const BrowserAutomationsPage = lazy(() => loadBrowserAutomationsPage().then((m) => ({ default: m.BrowserAutomationsPage })));
const ScenesPage = lazy(() => loadScenesPage().then((m) => ({ default: m.ScenesPage })));
const HomePage = lazy(() => loadHomePage().then((m) => ({ default: m.HomePage })));
const TaskDetailPage = lazy(() => loadTaskDetailPage().then((m) => ({ default: m.TaskDetailPage })));
const ProjectsPage = lazy(() => loadProjectsPage().then((m) => ({ default: m.ProjectsPage })));
const ProjectDetailPage = lazy(() => loadProjectDetailPage().then((m) => ({ default: m.ProjectDetailPage })));
const NotesPage = lazy(() => loadNotesPage().then((m) => ({ default: m.NotesPage })));
const WorkflowsPage = lazy(() => loadWorkflowsPage().then((m) => ({ default: m.WorkflowsPage })));
const WorkflowDetailPage = lazy(() => loadWorkflowsPage().then((m) => ({ default: m.WorkflowDetailPage })));
const WorkflowEditorPage = lazy(() => loadWorkflowsPage().then((m) => ({ default: m.WorkflowEditorPage })));
const WorkflowRunPage = lazy(() => loadWorkflowsPage().then((m) => ({ default: m.WorkflowRunPage })));
const ImportsPage = lazy(() => import('@/features/imports/imports-page').then(m => ({ default: m.ImportsPage })));
const CapabilitiesPage = lazy(() => import('@/features/capabilities/capabilities-page').then((m) => ({ default: m.CapabilitiesPage })));
const UserModelPage = lazy(() => loadUserModelPage().then((m) => ({ default: m.UserModelPage })));
const ConnectorServicePage = lazy(() => import('./features/connectors/connector-service-page').then(m => ({ default: m.ConnectorServicePage })));
const LogsPage = lazy(() => loadLogsPage().then((m) => ({ default: m.LogsPage })));
const SettingsPage = lazy(() => loadSettingsPage().then((m) => ({ default: m.SettingsPage })));
const CapabilitiesSettingsPanel = lazy(() =>
  loadCapabilitiesSettingsPanel().then((m) => ({ default: m.CapabilitiesSettingsPanel })),
);
const AgentBrowserSettingsPage = lazy(() =>
  loadAgentBrowserSettingsPage().then((m) => ({ default: m.AgentBrowserSettingsPage })),
);
const ComputerSettingsPage = lazy(() => loadComputerSettingsPage().then(m => ({ default: m.ComputerSettingsPage })));
const ExtensionPage = lazy(() => loadExtensionPage().then((m) => ({ default: m.ExtensionPage })));
const ExtensionSettingsPage = lazy(() =>
  loadExtensionSettingsPage().then((m) => ({ default: m.ExtensionSettingsPage })),
);
const ExtensionDebugPage = lazy(() =>
  loadExtensionDebugPage().then((m) => ({ default: m.ExtensionDebugPage })),
);
const SharePreviewPage = lazy(() => loadSharePreviewPage().then((m) => ({ default: m.SharePreviewPage })));
const DesktopPetPage = lazy(() => import('@/pages/desktop-pet').then((m) => ({ default: m.DesktopPetPage })));
const LocalAppsPage = lazy(() => loadLocalAppsPage().then((m) => ({ default: m.LocalAppsPage })));
const LocalAppWorkbenchPage = lazy(() => loadLocalAppWorkbenchPage().then((m) => ({ default: m.LocalAppWorkbenchPage })));
const ProductOpenPage = lazy(() => loadProductOpenPage().then((m) => ({ default: m.ProductOpenPage })));
const WorkDiscoveryPage = lazy(() => loadWorkDiscoveryPage().then((m) => ({ default: m.WorkDiscoveryPage })));

function SecondaryRouteFallback() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-panel" aria-busy>
      <div className="flex w-full flex-col gap-5 px-3 py-6 sm:px-5 xl:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-9 w-24 shrink-0 rounded-lg" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}



function SettingsRouteFallback() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy>
      <div className="w-full flex-1 px-3 py-8 sm:px-5 xl:px-6">
        <Skeleton className="h-8 w-48 max-w-full" />
        <Skeleton className="mt-6 h-36 rounded-xl" />
        <Skeleton className="mt-4 h-24 rounded-xl" />
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

const router = createHashRouter([
  {
    path: '/desktop-pet',
    errorElement: <RouteErrorFallback />,
    element: (
      <Suspense fallback={null}>
        <DesktopPetPage />
      </Suspense>
    ),
  },
  {
    // Public share preview — bypasses `AppShell`'s gateway-token gate so any
    // recipient of a share link can render it. Talks only to /s/:token/* APIs.
    path: '/share/:token',
    errorElement: <RouteErrorFallback />,
    element: (
      <Suspense fallback={<SecondaryRouteFallback />}>
        <SharePreviewPage />
      </Suspense>
    ),
  },
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorFallback />,
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <HomePage />
          </Suspense>
        ),
      },
      {
        path: 'open',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <ProductOpenPage />
          </Suspense>
        ),
      },
      {
        path: 'onboarding/workspace',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <WorkDiscoveryPage />
          </Suspense>
        ),
      },
      {
        path: 'chat',
        element: <ChatRouteLayout />,
        children: [
          { path: 'task/:taskId', element: <TaskChatPage /> },
          { path: CHAT_SESSION_ROUTE_PATH, element: <ChatPage /> },
        ],
      },
      ...['scenes', 'scenes/inbox', 'scenes/new/:templateKey', 'scenes/:activationId'].map((path) => ({
        path, element: <Suspense fallback={<SecondaryRouteFallback />}><ScenesPage /></Suspense>,
      })),
      {
        path: 'automations',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <AutomationsPage />
          </Suspense>
        ),
      },
      {
        path: 'browser-automations',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <BrowserAutomationsPage />
          </Suspense>
        ),
      },
      {
        path: 'user-model',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <UserModelPage />
          </Suspense>
        ),
      },
      {
        path: 'tasks/:taskId',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <TaskDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'projects',
        children: [
          {
            index: true,
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <ProjectsPage />
              </Suspense>
            ),
          },
          {
            path: ':projectId',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <ProjectDetailPage />
              </Suspense>
            ),
          },
          {
            path: ':projectId/:tabId',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <ProjectDetailPage />
              </Suspense>
            ),
          },
          {
            path: ':projectId/notes/:noteId',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <ProjectDetailPage />
              </Suspense>
            ),
          },
        ],
      },
      {
        path: 'notes',
        children: [
          {
            index: true,
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <NotesPage />
              </Suspense>
            ),
          },
          {
            path: ':noteId',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <NotesPage />
              </Suspense>
            ),
          },
        ],
      },
      {
        path: 'workflows',
        children: [
          {
            index: true,
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <WorkflowsPage />
              </Suspense>
            ),
          },
          {
            path: 'new',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <WorkflowEditorPage />
              </Suspense>
            ),
          },
          {
            path: 'runs/:runId',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <WorkflowRunPage />
              </Suspense>
            ),
          },
          {
            path: ':definitionId',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <WorkflowDetailPage />
              </Suspense>
            ),
          },
          {
            path: ':definitionId/edit',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <WorkflowEditorPage />
              </Suspense>
            ),
          },
        ],
      },
      {
        path: 'capabilities/:section?/:detailId?',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <CapabilitiesPage />
          </Suspense>
        ),
      },
      {
        path: 'settings/connector-service',
        element: <Suspense fallback={<SecondaryRouteFallback />}><ConnectorServicePage /></Suspense>,
      },
      {
        path: 'local-apps',
        children: [
          {
            index: true,
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <LocalAppsPage />
              </Suspense>
            ),
          },
          {
            path: ':appId',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <LocalAppWorkbenchPage />
              </Suspense>
            ),
          },
        ],
      },
      {
        path: 'extensions/:extensionId',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <ExtensionPage />
          </Suspense>
        ),
      },
      {
        path: 'extensions/:extensionId/:pageId',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <ExtensionPage />
          </Suspense>
        ),
      },
      {
        path: 'settings',
        element: (
          <SettingsSheet>
            <SettingsPageLayout />
          </SettingsSheet>
        ),
        children: [
          { index: true, element: <Navigate to="overview" replace /> },
          { path: 'imports', element: <Suspense fallback={<SettingsRouteFallback />}><ImportsPage /></Suspense> },
          {
            path: 'sessions',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <SessionsPage />
              </Suspense>
            ),
          },
          {
            path: 'usage',
            element: (
              <Suspense fallback={<SettingsRouteFallback />}>
                <UsageSettingsPage />
              </Suspense>
            ),
          },
          {
            path: 'logs',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <LogsPage />
              </Suspense>
            ),
          },
          {
            path: 'computer-use',
            element: (
              <Suspense fallback={<SettingsRouteFallback />}>
                <ComputerSettingsPage />
              </Suspense>
            ),
          },
          {
            path: 'agent-browser',
            element: (
              <Suspense fallback={<SettingsRouteFallback />}>
                <AgentBrowserSettingsPage />
              </Suspense>
            ),
          },
          {
            path: 'capabilities/:capability',
            element: (
              <Suspense fallback={<SettingsRouteFallback />}>
                <CapabilitiesSettingsPanel />
              </Suspense>
            ),
          },
          {
            path: 'extensions/debug',
            element: (
              <Suspense fallback={<SettingsRouteFallback />}>
                <ExtensionDebugPage />
              </Suspense>
            ),
          },
          {
            path: 'ext/:extensionId',
            element: (
              <Suspense fallback={<SettingsRouteFallback />}>
                <ExtensionSettingsPage />
              </Suspense>
            ),
          },
          {
            path: 'ext/:extensionId/:panelId',
            element: (
              <Suspense fallback={<SettingsRouteFallback />}>
                <ExtensionSettingsPage />
              </Suspense>
            ),
          },
          {
            path: ':section',
            element: (
              <Suspense fallback={<SettingsRouteFallback />}>
                <SettingsPage />
              </Suspense>
            ),
          },
        ],
      },
    ],
  },
]);

function ThemeEffects() {
  useEffect(() => {
    const offTheme = useThemeStore.persist.onFinishHydration(() => {
      syncThemeAfterHydration();
    });
    const offFont = useFontScaleStore.persist.onFinishHydration(() => {
      syncFontScaleAfterHydration();
    });
    const offLocale = syncElectronLocaleAfterHydration();
    const offSystem = subscribeSystemTheme();
    return () => {
      offTheme?.();
      offFont?.();
      offLocale();
      offSystem();
    };
  }, []);

  return null;
}

export function App() {
  return (
    <SwrProvider>
      <ExtensionProvider>
        <div className="flex min-h-0 flex-1 flex-col">
          <ThemeEffects />
          <div className="flex min-h-0 flex-1 flex-col *:min-h-0 *:flex-1">
            <DesktopPetEventBridge />
            <RouterProvider router={router} />
          </div>
        </div>
      </ExtensionProvider>
    </SwrProvider>
  );
}
