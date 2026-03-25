import { useEffect } from 'react';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';

import { AppShell } from '@/components/shell/app-shell';
import { SecondaryPageLayout } from '@/components/shell/secondary-page-layout';
import { ChatPage } from '@/features/chat/chat-page';
import { ChatRouteLayout } from '@/features/chat/chat-route-layout';
import { SwrProvider } from '@/providers/swr-provider';
import { CronPage } from '@/pages/cron-page';
import { LogsPage } from '@/pages/logs-page';
import { SessionsPage } from '@/pages/sessions-page';
import { SettingsPage } from '@/pages/settings-page';
import { SkillsPage } from '@/pages/skills-page';
import { subscribeSystemTheme, syncThemeAfterHydration, useThemeStore } from '@/stores/theme-store';

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
          { path: 'sessions', element: <SessionsPage /> },
          { path: 'cron', element: <CronPage /> },
          { path: 'skills', element: <SkillsPage /> },
          { path: 'logs', element: <LogsPage /> },
          { path: 'settings/:section', element: <SettingsPage /> },
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
