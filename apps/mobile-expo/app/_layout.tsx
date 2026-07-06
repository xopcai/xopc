import { QueryClientProvider } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { PaperProvider } from 'react-native-paper';

import { ClipboardIntakeModal } from '@/features/clipboard-intake/ClipboardIntakeModal';
import { tryConsumeGatewayDeeplink } from '@/features/gateway/apply-gateway-deeplink';
import { themedStackScreenOptions } from '@/lib/stack-screen-theme';
import { createPaperTheme, getColors } from '@/theme';
import { GatewayConnectLandingContext } from '@/features/gateway/gateway-connect-context';
import { GatewayConnectLandingModal } from '@/features/gateway/GatewayConnectLandingModal';
import { useGatewayConnectionWatch } from '@/features/gateway/use-gateway-connection-watch';
import { useGatewaySse } from '@/features/gateway/use-gateway-sse';
import { refreshNetworkSnapshotWithDeadline } from '@/features/gateway/network-info';
import { queryClient } from '@/query/query-client';
import { useGatewayConfigured } from '@/query/sessions';
import { useGatewayStore } from '@/stores/gateway-store';
import {
  subscribeSystemAppearance,
  usePreferencesStore,
} from '@/stores/preferences-store';
import { useNoteTagsStore } from '@/stores/note-tags-store';

export default function RootLayout() {
  const router = useRouter();
  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const resolvedTheme = usePreferencesStore((s) => s.resolvedTheme);
  const clipboardIntakeEnabled = usePreferencesStore((s) => s.clipboardIntakeEnabled);
  const hydratePrefs = usePreferencesStore((s) => s.hydrate);
  const hydrateNoteTags = useNoteTagsStore((s) => s.hydrate);
  const hydrateGateway = useGatewayStore((s) => s.hydrateFromStorage);
  const configured = useGatewayConfigured();
  const unauthorized = useGatewayStore((s) => s.unauthorized);
  const [userDismissedConnect, setUserDismissedConnect] = useState(false);

  useGatewaySse();
  useGatewayConnectionWatch(configured);

  const isDark = resolvedTheme === 'dark';
  const paperTheme = useMemo(() => createPaperTheme(isDark), [isDark]);
  const stackScreenOptions = useMemo(
    () => ({
      headerShown: false,
      ...themedStackScreenOptions(isDark),
    }),
    [isDark],
  );
  const rootBackgroundColor = getColors(isDark).surface.base;

  useEffect(() => {
    // Eagerly refresh the network snapshot before/while we hydrate so the
    // very first dual-fire decision (LAN viable? cellular? offline?) is
    // based on real OS state instead of the 'unknown' default. Bounded so
    // a slow OS query never blocks app start.
    void refreshNetworkSnapshotWithDeadline(150);
    hydrateGateway();
    hydratePrefs();
    hydrateNoteTags();
    return subscribeSystemAppearance();
  }, [hydrateGateway, hydrateNoteTags, hydratePrefs]);
  useEffect(() => {
    if (configured) setUserDismissedConnect(false);
  }, [configured]);

  /** 401 — same as web: force gateway landing until credentials are fixed. */
  useEffect(() => {
    if (unauthorized) setUserDismissedConnect(false);
  }, [unauthorized]);

  useEffect(() => {
    let alive = true;
    const run = (url: string) => {
      void tryConsumeGatewayDeeplink(url, router);
    };
    void Linking.getInitialURL().then((url) => {
      if (alive && url) run(url);
    });
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (alive) run(url);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [router]);

  const connectLandingVisible =
    (!configured && !userDismissedConnect) || unauthorized;

  const openGatewayConnectLanding = useCallback(() => {
    setUserDismissedConnect(false);
  }, []);

  const onConnectLandingClose = useCallback(() => {
    if (useGatewayStore.getState().unauthorized) return;
    setUserDismissedConnect(true);
    router.replace('/');
  }, [router]);
  const gatewayConnectCtx = useMemo(
    () => ({ openGatewayConnectLanding }),
    [openGatewayConnectLanding],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: rootBackgroundColor }}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        translucent
        backgroundColor="transparent"
      />
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <PaperProvider theme={paperTheme}>
            <GatewayConnectLandingContext.Provider value={gatewayConnectCtx}>
              <Stack screenOptions={stackScreenOptions}>
              {/**
               * (home) is the default landing group — single home screen.
               * chat/[k] pushes a full-screen chat detail on top.
               */}
                <Stack.Screen name="(home)" options={{ headerShown: false }} />
                <Stack.Screen name="chat" options={{ headerShown: false }} />
                <Stack.Screen name="inbox" options={{ headerShown: false }} />
                <Stack.Screen name="notes/index" options={{ headerShown: false }} />
                <Stack.Screen name="sessions" options={{ headerShown: false }} />
                <Stack.Screen name="items/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="files/index" options={{ headerShown: false }} />
                <Stack.Screen
                  name="intake"
                  options={{
                    headerShown: false,
                    presentation: 'transparentModal',
                  }}
                />
                <Stack.Screen
                  name="settings"
                  options={{
                    headerShown: false,
                    presentation: 'modal',
                  }}
                />
                <Stack.Screen
                  name="ai"
                  options={{
                    headerShown: false,
                    presentation: 'modal',
                  }}
                />
                <Stack.Screen
                  name="automation"
                  options={{
                    headerShown: false,
                    presentation: 'modal',
                  }}
                />
                <Stack.Screen
                  name="sharing"
                  options={{
                    headerShown: false,
                    presentation: 'modal',
                  }}
                />
              </Stack>
              <GatewayConnectLandingModal
                visible={connectLandingVisible}
                onRequestClose={onConnectLandingClose}
              />
              <ClipboardIntakeModal enabled={prefsHydrated && clipboardIntakeEnabled && configured && !connectLandingVisible} />
            </GatewayConnectLandingContext.Provider>
          </PaperProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
