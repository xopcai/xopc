/**
 * Home layout — single home screen (no bottom tabs).
 *
 * expo-router file-system route: app/(home)/_layout.tsx
 */
import { Stack } from 'expo-router';

import { useThemedStackScreenOptions } from '@/lib/stack-screen-theme';

export default function MainLayout() {
  const themedScreenOptions = useThemedStackScreenOptions();

  return (
    <Stack screenOptions={{ headerShown: false, ...themedScreenOptions }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
