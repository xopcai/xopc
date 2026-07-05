import { lazy, Suspense, useEffect } from 'react';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';

import { AppShell } from '@/components/shell/app-shell';
import { SettingsPageLayout } from '@/components/shell/settings-page-layout';
import { SettingsSheet } from '@/components/shell/settings-sheet';
import { ChatPage } from '@/features/chat/chat-page';
import { ChatRouteLayout } from '@/features/chat/chat-route-layout';
import { ExtensionProvider } from '@/features/extensions/extension-provider';
import {
  loadAgentsSettingsPage,
  loadAgentBrowserSettingsPage,
  loadAppsPage,
  loadAutomationsPage,
  loadChannelsPage,
  loadConnectorsPage,
  loadGoalDetailPage,
  loadGoalsPage,
  loadExtensionDebugPage,
  loadExtensionPage,
  loadExtensionSettingsPage,
  loadLogsPage,
  loadNoteDetailPage,
  loadNotesPage,
  loadSettingsPage,
  loadSharePreviewPage,
  loadSessionsPage,
  loadSkillsPage,
  loadWorkflowsPage,
} from '@/lib/route-preload';
import { SwrProvider } from '@/providers/swr-provider';
import { syncFontScaleAfterHydration, useFontScaleStore } from '@/stores/font-scale-store';
import { syncElectronLocaleAfterHydration } from '@/stores/locale-store';
import { subscribeSystemTheme, syncThemeAfterHydration, useThemeStore } from '@/stores/theme-store';

const SessionsPage = lazy(() => loadSessionsPage().then((m) => ({ default: m.SessionsPage })));
const AutomationsPage = lazy(() => loadAutomationsPage().then((m) => ({ default: m.AutomationsPage })));
const GoalsPage = lazy(() => loadGoalsPage().then((m) => ({ default: m.GoalsPage })));
const GoalDetailPage = lazy(() => loadGoalDetailPage().then((m) => ({ default: m.GoalDetailPage })));
const NotesPage = lazy(() => loadNotesPage().then((m) => ({ default: m.NotesPage })));
const NoteDetailPage = lazy(() => loadNoteDetailPage().then((m) => ({ default: m.NoteDetailPage })));
const WorkflowsPage = lazy(() => loadWorkflowsPage().then((m) => ({ default: m.WorkflowsPage })));
const SkillsPage = lazy(() => loadSkillsPage().then((m) => ({ default: m.SkillsPage })));
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
const AppsPage = lazy(() => loadAppsPage().then((m) => ({ default: m.AppsPage })));
const ExtensionPage = lazy(() => loadExtensionPage().then((m) => ({ default: m.ExtensionPage })));
const ExtensionSettingsPage = lazy(() =>
  loadExtensionSettingsPage().then((m) => ({ default: m.ExtensionSettingsPage })),
);
const ExtensionDebugPage = lazy(() =>
  loadExtensionDebugPage().then((m) => ({ default: m.ExtensionDebugPage })),
);
const SharePreviewPage = lazy(() => loadSharePreviewPage().then((m) => ({ default: m.SharePreviewPage })));

function SecondaryRouteFallback() {
  return (
    <div
      className="flex min-h-[min(40vh,16rem)] flex-1 items-center justify-center text-sm text-fg-muted"
      aria-busy
    >
      Loading…
    </div>
  );
}


function SettingsRouteFallback() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy>
      <div className="mx-auto w-full max-w-app-main flex-1 px-4 py-8">
        <div className="h-8 w-48 max-w-full animate-pulse rounded-md bg-surface-hover" />
        <div className="mt-6 h-36 animate-pulse rounded-xl bg-surface-hover" />
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-surface-hover" />
        <p className="mt-6 text-sm text-fg-muted">Loading…</p>
      </div>
    </div>
  );
}

const router = createHashRouter([
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
          { index: true, element: <ChatPage /> },
          { path: 'new', element: <ChatPage /> },
          { path: ':sessionKey', element: <ChatPage /> },
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
                <NoteDetailPage />
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
        path: 'apps',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <AppsPage />
          </Suspense>
        ),
      },
      {
        path: 'apps/:extensionId',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <ExtensionPage />
          </Suspense>
        ),
      },
      {
        path: 'apps/:extensionId/:pageId',
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
            path: 'apps',
            element: (
              <Suspense fallback={<SettingsRouteFallback />}>
                <AppsPage />
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
            <RouterProvider router={router} />
          </div>
        </div>
      </ExtensionProvider>
    </SwrProvider>
  );
}
