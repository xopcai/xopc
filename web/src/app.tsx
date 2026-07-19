import { lazy, Suspense, useEffect } from 'react';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';

import { AppShell } from '@/components/shell/app-shell';
import { SettingsPageLayout } from '@/components/shell/settings-page-layout';
import { SettingsSheet } from '@/components/shell/settings-sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ChatPage } from '@/features/chat/chat-page';
import { ChatRouteLayout } from '@/features/chat/chat-route-layout';
import { CHAT_SESSION_ROUTE_PATH } from '@/features/chat/chat-session-route';
import { DesktopPetEventBridge } from '@/features/desktop-pet/desktop-pet-event-bridge';
import { ExtensionProvider } from '@/features/extensions/extension-provider';
import {
  loadAgentsSettingsPage,
  loadAgentBrowserSettingsPage,
  loadExtensionsPage,
  loadAutomationsPage,
  loadChannelsPage,
  loadConnectorsPage,
  loadGoalDetailPage,
  loadGoalsPage,
  loadProjectDetailPage,
  loadProjectsPage,
  loadWorkItemDetailPage,
  loadExtensionDebugPage,
  loadExtensionPage,
  loadExtensionSettingsPage,
  loadLogsPage,
  loadNotesPage,
  loadSettingsPage,
  loadSharePreviewPage,
  loadSessionsPage,
  loadSkillsPage,
  loadUserContextPage,
  loadWorkflowsPage,
} from '@/lib/route-preload';
import { SwrProvider } from '@/providers/swr-provider';
import { syncFontScaleAfterHydration, useFontScaleStore } from '@/stores/font-scale-store';
import { syncElectronLocaleAfterHydration } from '@/stores/locale-store';
import { subscribeSystemTheme, syncThemeAfterHydration, useThemeStore } from '@/stores/theme-store';

const SessionsPage = lazy(() => loadSessionsPage().then((m) => ({ default: m.SessionsPage })));
const AutomationsPage = lazy(() => loadAutomationsPage().then((m) => ({ default: m.AutomationsPage })));
const ProjectsPage = lazy(() => loadProjectsPage().then((m) => ({ default: m.ProjectsPage })));
const ProjectDetailPage = lazy(() => loadProjectDetailPage().then((m) => ({ default: m.ProjectDetailPage })));
const WorkItemDetailPage = lazy(() => loadWorkItemDetailPage().then((m) => ({ default: m.WorkItemDetailPage })));
const GoalsPage = lazy(() => loadGoalsPage().then((m) => ({ default: m.GoalsPage })));
const GoalDetailPage = lazy(() => loadGoalDetailPage().then((m) => ({ default: m.GoalDetailPage })));
const NotesPage = lazy(() => loadNotesPage().then((m) => ({ default: m.NotesPage })));
const WorkflowsPage = lazy(() => loadWorkflowsPage().then((m) => ({ default: m.WorkflowsPage })));
const SkillsPage = lazy(() => loadSkillsPage().then((m) => ({ default: m.SkillsPage })));
const UserContextPage = lazy(() => loadUserContextPage().then((m) => ({ default: m.UserContextPage })));
const ConnectorsPage = lazy(() => loadConnectorsPage().then((m) => ({ default: m.ConnectorsPage })));
const LogsPage = lazy(() => loadLogsPage().then((m) => ({ default: m.LogsPage })));
const SettingsPage = lazy(() => loadSettingsPage().then((m) => ({ default: m.SettingsPage })));
const AgentsSettingsDetailPage = lazy(() =>
  loadAgentsSettingsPage().then((m) => ({ default: m.AgentsSettingsPanel })),
);
const AgentBrowserSettingsPage = lazy(() =>
  loadAgentBrowserSettingsPage().then((m) => ({ default: m.AgentBrowserSettingsPage })),
);
const ChannelsPage = lazy(() => loadChannelsPage().then((m) => ({ default: m.ChannelsSettingsPanel })));
const ExtensionsPage = lazy(() => loadExtensionsPage().then((m) => ({ default: m.ExtensionsPage })));
const ExtensionPage = lazy(() => loadExtensionPage().then((m) => ({ default: m.ExtensionPage })));
const ExtensionSettingsPage = lazy(() =>
  loadExtensionSettingsPage().then((m) => ({ default: m.ExtensionSettingsPage })),
);
const ExtensionDebugPage = lazy(() =>
  loadExtensionDebugPage().then((m) => ({ default: m.ExtensionDebugPage })),
);
const SharePreviewPage = lazy(() => loadSharePreviewPage().then((m) => ({ default: m.SharePreviewPage })));
const DesktopPetPage = lazy(() => import('@/pages/desktop-pet').then((m) => ({ default: m.DesktopPetPage })));

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
    element: (
      <Suspense fallback={<SecondaryRouteFallback />}>
        <SharePreviewPage />
      </Suspense>
    ),
  },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      {
        path: 'chat',
        element: <ChatRouteLayout />,
        children: [
          { path: CHAT_SESSION_ROUTE_PATH, element: <ChatPage /> },
        ],
      },
      {
        path: 'automations',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <AutomationsPage />
          </Suspense>
        ),
      },
      {
        path: 'you',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <UserContextPage />
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
        path: 'work-items/:workItemId',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <WorkItemDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'goals',
        children: [
          {
            index: true,
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <GoalsPage />
              </Suspense>
            ),
          },
          {
            path: ':goalId',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <GoalDetailPage />
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
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <WorkflowsPage />
          </Suspense>
        ),
      },
      {
        path: 'skills',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <SkillsPage />
          </Suspense>
        ),
      },
      {
        path: 'connectors',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <ConnectorsPage />
          </Suspense>
        ),
      },
      {
        path: 'channels',
        children: [
          {
            index: true,
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <ChannelsPage />
              </Suspense>
            ),
          },
          {
            path: ':channelId',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <ChannelsPage />
              </Suspense>
            ),
          },
        ],
      },
      {
        path: 'agents',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <AgentsSettingsDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'agents/:agentId',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <AgentsSettingsDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'extensions',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <ExtensionsPage />
          </Suspense>
        ),
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
          {
            path: 'sessions',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <SessionsPage />
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
            path: 'agent-browser',
            element: (
              <Suspense fallback={<SettingsRouteFallback />}>
                <AgentBrowserSettingsPage />
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
