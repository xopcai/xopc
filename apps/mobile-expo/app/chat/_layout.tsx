/**
 * Chat detail stack — pushed on top of the home navigator.
 *
 * Route: /chat/[k]   (k = session key)
 */
import { Stack } from 'expo-router';

import { useThemedStackScreenOptions } from '@/lib/stack-screen-theme';

export default function ChatDetailLayout() {
  const themedScreenOptions = useThemedStackScreenOptions();

  return (
    <Stack screenOptions={{ headerShown: false, ...themedScreenOptions }}>
      <Stack.Screen name="[k]" />
    </Stack>
  );
}
