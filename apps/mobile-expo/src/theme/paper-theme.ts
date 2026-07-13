/**
 * Maps design tokens onto react-native-paper MD3 themes so Paper components
 * inherit the same contrast as the rest of the app (not Material defaults).
 */
import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';

import { darkColors, lightColors, type ColorScheme } from './tokens';

function buildPaperTheme(base: MD3Theme, colors: ColorScheme): MD3Theme {
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent.primary,
      onPrimary: '#FFFFFF',
      primaryContainer: colors.accent.soft,
      onPrimaryContainer: colors.accent.primary,
      secondary: colors.text.secondary,
      onSecondary: colors.text.primary,
      secondaryContainer: colors.surface.grouped,
      onSecondaryContainer: colors.text.primary,
      tertiary: colors.text.tertiary,
      onTertiary: colors.text.primary,
      background: colors.surface.base,
      onBackground: colors.text.primary,
      surface: colors.surface.panel,
      onSurface: colors.text.primary,
      surfaceVariant: colors.surface.grouped,
      onSurfaceVariant: colors.text.secondary,
      outline: colors.border.default,
      outlineVariant: colors.border.subtle,
      error: colors.semantic.error,
      onError: '#FFFFFF',
      elevation: {
        ...base.colors.elevation,
        level0: colors.surface.base,
        level1: colors.surface.panel,
        level2: colors.surface.elevated,
        level3: colors.surface.input,
        level4: colors.surface.hover,
        level5: colors.surface.active,
      },
    },
  };
}

export function createPaperTheme(isDark: boolean): MD3Theme {
  return isDark
    ? buildPaperTheme(MD3DarkTheme, darkColors)
    : buildPaperTheme(MD3LightTheme, lightColors);
}
