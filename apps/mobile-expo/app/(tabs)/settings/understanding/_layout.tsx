import { Stack } from 'expo-router';

import { useThemedStackScreenOptions } from '@/lib/stack-screen-theme';

export default function UnderstandingLayout() {
  return <Stack screenOptions={{ headerShown: false, ...useThemedStackScreenOptions() }} />;
}
