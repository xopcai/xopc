import { lazy, Suspense, useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createHashRouter, Navigate, RouterProvider, useParams } from 'react-router-dom';

import { i18n } from '@/i18n/i18n';
import { AppShell } from '@/components/shell/app-shell';
import { SettingsPageLayout } from '@/components/shell/settings-page-layout';
import { SettingsSheet } from '@/components/shell/settings-sheet';
import { ChatPage } from '@/features/chat/chat-page';
import { ChatRouteLayout } from '@/features/chat/chat-route-layout';
import { ExtensionProvider } from '@/features/extensions/extension-provider';
import { SwrProvider } from '@/providers/swr-provider';
import { syncFontScaleAfterHydration, useFontScaleStore } from '@/stores/font-scale-store';
import { subscribeSystemTheme, syncThemeAfterHydration, useThemeStore } from '@/stores/theme-store';

const SessionsPage = lazy(() =>
  import('@/pages/sessions-page').then((m) => ({ default: m.SessionsPage })),
);
const CronPage = lazy(() => import('@/pages/cron-page').then((m) => ({ default: m.CronPage })));
const SkillsPage = lazy(() => import('@/pages/skills-page').then((m) => ({ default: m.SkillsPage })));
const LogsPage = lazy(() => import('@/pages/logs-page').then((m) => ({ default: m.LogsPage })));
const SettingsPage = lazy(() =>
  import('@/pages/settings-page').then((m) => ({ default: m.SettingsPage })),
);
const AgentsSettingsDetailPage = lazy(() =>
  import('@/features/settings/agents').then((m) => ({ default: m.AgentsSettingsPanel })),
);
const ChannelsPage = lazy(() =>
  import('@/features/settings/channels-settings').then((m) => ({
    default: m.ChannelsSettingsPanel,
  })),
);
const AppsPage = lazy(() =>
  import('@/pages/apps-page').then((m) => ({ default: m.AppsPage })),
);
const ExtensionPage = lazy(() =>
  import('@/features/extensions/extension-page').then((m) => ({ default: m.ExtensionPage })),
);
const ExtensionSettingsPage = lazy(() =>
  import('@/features/extensions/extension-settings-page').then((m) => ({
    default: m.ExtensionSettingsPage,
  })),
);
const ExtensionDebugPage = lazy(() =>
  import('@/features/extensions/extension-debug-page').then((m) => ({
    default: m.ExtensionDebugPage,
  })),
);

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

function RedirectLegacySettingsAgentsDetail() {
  const { agentId } = useParams();
  const raw = typeof agentId === 'string' ? agentId.trim() : '';
  return <Navigate to={raw ? `/agents/${encodeURIComponent(raw)}` : '/agents'} replace />;
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
        path: 'sessions',
        element: <Navigate to="/settings/sessions" replace />,
      },
      {
        path: 'logs',
        element: <Navigate to="/settings/logs" replace />,
      },
      {
        path: 'cron',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <CronPage />
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
        path: 'channels',
        element: (
          <Suspense fallback={<SecondaryRouteFallback />}>
            <ChannelsPage />
          </Suspense>
        ),
      },
      {
        path: 'mcp',
        element: <Navigate to="/settings/agent-mcp" replace />,
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
            path: 'skills',
            element: <Navigate to="/skills" replace />,
          },
          {
            path: 'cron',
            element: <Navigate to="/cron" replace />,
          },
          {
            path: 'channels',
            element: <Navigate to="/channels" replace />,
          },
          {
            path: 'mcp',
            element: <Navigate to="/settings/agent-mcp" replace />,
          },
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
            path: 'agents',
            element: <Navigate to="/agents" replace />,
          },
          {
            path: 'agents/:agentId',
            element: <RedirectLegacySettingsAgentsDetail />,
          },
          {
            path: 'agent-defaults',
            element: <Navigate to="/settings/agent-chat" replace />,
          },
          {
            path: 'agent-models',
            element: <Navigate to="/settings/models" replace />,
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
    const offSystem = subscribeSystemTheme();
    return () => {
      offTheme?.();
      offFont?.();
      offSystem();
    };
  }, []);

  return null;
}

export function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <SwrProvider>
        <ExtensionProvider>
          <div className="flex min-h-0 flex-1 flex-col">
            <ThemeEffects />
            <div className="flex min-h-0 flex-1 flex-col [&>*]:min-h-0 [&>*]:flex-1">
              <RouterProvider router={router} />
            </div>
          </div>
        </ExtensionProvider>
      </SwrProvider>
    </I18nextProvider>
  );
}
