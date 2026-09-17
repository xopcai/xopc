import { Stack } from 'expo-router';
import { useThemedStackScreenOptions } from '@/lib/stack-screen-theme';
export default function Layout() {
  const options = useThemedStackScreenOptions();
  return <Stack screenOptions={{ ...options, headerShown: false }} />;
}
