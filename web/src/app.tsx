import { useEffect } from 'react';
import { createHashRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';

import { AppShell } from '@/components/shell/app-shell';
import { SwrProvider } from '@/providers/swr-provider';
import { ChatPage } from '@/features/chat/chat-page';
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
        element: <Outlet />,
        children: [
          { index: true, element: <ChatPage /> },
          { path: 'new', element: <ChatPage /> },
          { path: ':sessionKey', element: <ChatPage /> },
        ],
      },
      { path: 'sessions', element: <SessionsPage /> },
      { path: 'cron', element: <CronPage /> },
      { path: 'skills', element: <SkillsPage /> },
      { path: 'logs', element: <LogsPage /> },
      { path: 'settings/:section', element: <SettingsPage /> },
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
      <ThemeEffects />
      <RouterProvider router={router} />
    </SwrProvider>
  );
}
