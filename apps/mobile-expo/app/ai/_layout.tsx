import { Stack } from 'expo-router';

import { useThemedStackScreenOptions } from '@/lib/stack-screen-theme';

export default function AiLayout() {
  const themedScreenOptions = useThemedStackScreenOptions();

  return (
    <Stack screenOptions={{ headerShown: false, ...themedScreenOptions }}>
      <Stack.Screen name="agents" />
      <Stack.Screen name="agents/[id]" />
    </Stack>
  );
}
