import { Stack } from 'expo-router';

import { useThemedStackScreenOptions } from '@/lib/stack-screen-theme';

export default function AutomationLayout() {
  const themedScreenOptions = useThemedStackScreenOptions();

  return (
    <Stack screenOptions={{ headerShown: false, ...themedScreenOptions }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="form" />
    </Stack>
  );
}
