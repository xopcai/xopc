/**
 * Theme hook — resolves the active color scheme from user preferences.
 *
 * Usage:
 *   const { colors, isDark } = useTheme();
 *   <View style={{ backgroundColor: colors.surface.base }} />
 */
import { useMemo } from 'react';

import { usePreferencesStore } from '../stores/preferences-store';

import { colors as tokenColors, type ColorScheme } from './tokens';

export type ThemeContext = {
  isDark: boolean;
  colors: ColorScheme;
};

export function useTheme(): ThemeContext {
  const resolvedTheme = usePreferencesStore((s) => s.resolvedTheme);
  return useMemo(
    () => ({
      isDark: resolvedTheme === 'dark',
      colors: resolvedTheme === 'dark' ? tokenColors.dark : tokenColors.light,
    }),
    [resolvedTheme],
  );
}

/** Non-hook helper for callbacks / static code that already has `isDark`. */
export function getColors(isDark: boolean): ColorScheme {
  return isDark ? tokenColors.dark : tokenColors.light;
}
