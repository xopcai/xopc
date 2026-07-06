import { Stack } from 'expo-router';

import { useMessages } from '@/i18n/messages';
import { useThemedStackScreenOptions } from '@/lib/stack-screen-theme';

export default function GatewaySettingsLayout() {
  const m = useMessages();
  const s = m.settings;
  const themedScreenOptions = useThemedStackScreenOptions();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        ...themedScreenOptions,
      }}
    >
      <Stack.Screen name="index" options={{ title: s.gateway }} />
      <Stack.Screen name="[id]" options={{ title: s.editGateway }} />
    </Stack>
  );
}
