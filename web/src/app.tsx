import { useEffect } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { AppShell } from '@/components/shell/app-shell';
import { SwrProvider } from '@/providers/swr-provider';
import { HomePage } from '@/pages/home-page';
import { subscribeSystemTheme, syncThemeAfterHydration, useThemeStore } from '@/stores/theme-store';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [{ index: true, element: <HomePage /> }],
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
