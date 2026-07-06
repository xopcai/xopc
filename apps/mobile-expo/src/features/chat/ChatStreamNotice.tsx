import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';

import { getColors } from '../../theme';

type ChatStreamNoticeProps = {
  isDark: boolean;
  reconnecting?: boolean;
  reconnectingLabel: string;
  resumeVisible?: boolean;
  resumeLabel: string;
  resumeActionLabel: string;
  onResume?: () => void;
};

export const ChatStreamNotice = memo(function ChatStreamNotice({
  isDark,
  reconnecting,
  reconnectingLabel,
  resumeVisible,
  resumeLabel,
  resumeActionLabel,
  onResume,
}: ChatStreamNoticeProps) {
  const colors = getColors(isDark);
  if (reconnecting) {
    return (
      <View
        style={[
          styles.bar,
          {
            backgroundColor: colors.accent.selectionBg,
            borderBottomColor: colors.border.default,
          },
        ]}
      >
        <ActivityIndicator size={14} color={colors.accent.primary} />
        <Text style={[styles.message, { color: colors.accent.primary }]} numberOfLines={2}>
          {reconnectingLabel}
        </Text>
      </View>
    );
  }

  if (resumeVisible) {
    return (
      <View
        style={[
          styles.bar,
          {
            backgroundColor: colors.surface.panel,
            borderBottomColor: colors.border.default,
          },
        ]}
      >
        <Icon source="sync" size={16} color={colors.text.secondary} />
        <Text style={[styles.message, { color: colors.text.secondary }]} numberOfLines={2}>
          {resumeLabel}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onResume}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: colors.accent.selectionBg,
              opacity: pressed ? 0.82 : 1,
            },
          ]}
        >
          <Text style={[styles.actionLabel, { color: colors.accent.primary }]}>{resumeActionLabel}</Text>
        </Pressable>
      </View>
    );
  }

  return null;
});

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  message: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  action: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
});
