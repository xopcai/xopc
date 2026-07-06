import { useMemo } from 'react';

import { usePreferencesStore } from '../stores/preferences-store';
import { getColors } from '../theme';

export type ThemedStackScreenOptions = {
  headerStyle: { backgroundColor: string };
  headerTintColor: string;
  headerTitleStyle: { color: string };
  headerShadowVisible: boolean;
  contentStyle: { backgroundColor: string };
};

/** Effective dark mode from user preference (not raw system scheme). */
export function useResolvedIsDark(): boolean {
  return usePreferencesStore((s) => s.resolvedTheme === 'dark');
}

export function themedStackScreenOptions(isDark: boolean): ThemedStackScreenOptions {
  const c = getColors(isDark);
  return {
    headerStyle: { backgroundColor: c.surface.base },
    headerTintColor: c.text.primary,
    headerTitleStyle: { color: c.text.primary },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: c.surface.base },
  };
}

export function useThemedStackScreenOptions(): ThemedStackScreenOptions {
  const isDark = useResolvedIsDark();
  return useMemo(() => themedStackScreenOptions(isDark), [isDark]);
}
