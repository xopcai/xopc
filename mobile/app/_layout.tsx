import '../src/shims';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';

import { queryClient } from '../src/query/query-client';
import { useGatewayStore } from '../src/stores/gateway-store';

export default function RootLayout() {
  const scheme = useColorScheme();
  const paperTheme = scheme === 'dark' ? MD3DarkTheme : MD3LightTheme;
  const hydrateFromStorage = useGatewayStore((s) => s.hydrateFromStorage);

  useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <PaperProvider theme={paperTheme}>
          <Stack>
            <Stack.Screen name="index" options={{ title: 'Sessions' }} />
            <Stack.Screen name="settings" options={{ title: 'Gateway settings' }} />
            <Stack.Screen name="chat" options={{ title: 'Chat' }} />
          </Stack>
        </PaperProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
