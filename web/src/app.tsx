import { lazy, Suspense, useEffect } from 'react';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';

import { AppShell } from '@/components/shell/app-shell';
import { SecondaryPageLayout } from '@/components/shell/secondary-page-layout';
import { ChatPage } from '@/features/chat/chat-page';
import { ChatRouteLayout } from '@/features/chat/chat-route-layout';
import { SwrProvider } from '@/providers/swr-provider';
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
        element: <SecondaryPageLayout />,
        children: [
          {
            path: 'sessions',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <SessionsPage />
              </Suspense>
            ),
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
            path: 'logs',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
                <LogsPage />
              </Suspense>
            ),
          },
          {
            path: 'settings/:section',
            element: (
              <Suspense fallback={<SecondaryRouteFallback />}>
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
    const offHydration = useThemeStore.persist.onFinishHydration(() => {
      syncThemeAfterHydration();
    });
    const offSystem = subscribeSystemTheme();
    return () => {
      offHydration?.();
      offSystem();
    };
  }, []);

  return null;
}

export function App() {
  return (
    <SwrProvider>
      <div className="flex min-h-0 flex-1 flex-col">
        <ThemeEffects />
        <div className="flex min-h-0 flex-1 flex-col [&>*]:min-h-0 [&>*]:flex-1">
          <RouterProvider router={router} />
        </div>
      </div>
    </SwrProvider>
  );
}
