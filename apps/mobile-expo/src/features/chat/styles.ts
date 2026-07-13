/** Shared style constants for chat components. */
import { StyleSheet } from 'react-native';

import { colors } from '../../theme';

export const chatColors = {
  userBubbleBg: colors.light.accent.selectionBg,
  userBubbleBgDark: colors.dark.accent.selectionBg,
  assistantBg: 'transparent',
  assistantBgDark: 'transparent',
  thinkingBg: colors.light.surface.hover,
  thinkingBgDark: colors.dark.surface.active,
  thinkingBorder: colors.light.border.default,
  thinkingBorderDark: colors.dark.border.default,
  toolRunning: colors.light.accent.primary,
  toolDone: colors.light.semantic.success,
  toolError: colors.light.semantic.error,
  toolBg: colors.light.surface.panel,
  toolBgDark: colors.dark.surface.active,
  timestamp: colors.light.text.tertiary,
  roleLabelUser: colors.light.accent.primary,
  roleLabelAssistant: colors.light.text.secondary,
  accent: colors.light.accent.primary,
  accentSoft: colors.light.accent.selectionBg,
  accentSoftDark: colors.dark.accent.selectionBg,
  cursorBlink: colors.light.accent.primary,
  stepsBg: colors.light.surface.panel,
  stepsBgDark: colors.dark.surface.active,
  stepsBorder: colors.light.border.default,
  stepsBorderDark: colors.dark.border.default,
  stepsTimeline: colors.light.border.default,
  stepsTimelineDark: colors.dark.border.default,
} as const;

export const chatLayout = StyleSheet.create({
  messageBubbleRow: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  userBubbleContainer: {
    alignSelf: 'flex-end',
    maxWidth: '82%',
  },
  assistantBubbleContainer: {
    alignSelf: 'flex-start',
    width: '100%',
    maxWidth: '100%',
  },
  userBubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  assistantBubble: {
    paddingHorizontal: 0,
    paddingVertical: 4,
  },
});
