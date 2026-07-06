import { Stack } from 'expo-router';

import { useMessages } from '@/i18n/messages';
import { useThemedStackScreenOptions } from '@/lib/stack-screen-theme';

export default function SettingsLayout() {
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
      <Stack.Screen name="index" options={{ title: s.title }} />
      <Stack.Screen name="gateway" options={{ headerShown: false }} />
      <Stack.Screen name="about" options={{ title: s.about }} />
    </Stack>
  );
}
