import '../src/shims';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';

import { useMessages } from '../src/i18n/messages';
import { queryClient } from '../src/query/query-client';
import { useGatewayStore } from '../src/stores/gateway-store';
import {
  subscribeSystemAppearance,
  usePreferencesStore,
} from '../src/stores/preferences-store';

export default function RootLayout() {
  const resolvedTheme = usePreferencesStore((s) => s.resolvedTheme);
  const hydratePrefs = usePreferencesStore((s) => s.hydrate);
  const hydrateGateway = useGatewayStore((s) => s.hydrateFromStorage);
  const m = useMessages();

  const paperTheme = resolvedTheme === 'dark' ? MD3DarkTheme : MD3LightTheme;

  useEffect(() => {
    hydrateGateway();
    hydratePrefs();
    return subscribeSystemAppearance();
  }, [hydrateGateway, hydratePrefs]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <PaperProvider theme={paperTheme}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(drawer)" />
            <Stack.Screen
              name="settings"
              options={{
                headerShown: true,
                title: m.settings.title,
                presentation: 'modal',
              }}
            />
            <Stack.Screen
              name="agents"
              options={{
                headerShown: true,
                title: m.agentsPage.title,
                presentation: 'modal',
              }}
            />
            <Stack.Screen
              name="skills"
              options={{
                headerShown: true,
                title: m.skillsPage.title,
                presentation: 'modal',
              }}
            />
            <Stack.Screen
              name="channels"
              options={{
                headerShown: true,
                title: m.channelsPage.title,
                presentation: 'modal',
              }}
            />
          </Stack>
        </PaperProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
