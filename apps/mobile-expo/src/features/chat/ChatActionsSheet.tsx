import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Switch, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useMessages } from '../../i18n/messages';
import { radii, spacing, typography, useTheme } from '../../theme';

type ChatActionRowProps = {
  icon: string;
  label: string;
  description?: string;
  onPress: () => void;
  isLast?: boolean;
  trailing?: React.ReactNode;
  accessibilityRole?: 'button' | 'switch';
  selected?: boolean;
};

function ChatActionRow({
  icon,
  label,
  description,
  onPress,
  isLast = false,
  trailing,
  accessibilityRole = 'button',
  selected,
}: ChatActionRowProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={label}
      accessibilityState={accessibilityRole === 'switch' ? { checked: selected } : undefined}
      style={({ pressed }) => [
        styles.row,
        !isLast && {
          borderBottomColor: colors.border.subtle,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        pressed && { backgroundColor: colors.surface.pressed },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.surface.grouped }]}>
        <Icon source={icon} size={20} color={colors.text.secondary} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.text.primary }]}>
          {label}
        </Text>
        {description ? (
          <Text style={[styles.rowDescription, { color: colors.text.tertiary }]} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      {trailing ?? <Icon source="chevron-right" size={20} color={colors.text.tertiary} />}
    </Pressable>
  );
}

export const ChatActionsSheet = memo(function ChatActionsSheet({
  visible,
  agentName,
  autoReadAloudEnabled,
  onDismiss,
  onAgentPress,
  onAutoReadAloudToggle,
  onFilesPress,
  onNewChat,
}: {
  visible: boolean;
  agentName: string;
  autoReadAloudEnabled: boolean;
  onDismiss: () => void;
  onAgentPress: () => void;
  onAutoReadAloudToggle: () => void;
  onFilesPress?: () => void;
  onNewChat: () => void;
}) {
  const { colors } = useTheme();
  const m = useMessages();

  return (
    <BottomSheetModal
      visible={visible}
      onDismiss={onDismiss}
      title={m.chat.headerSettingsTitle}
      maxHeight="68%"
      testID="chat-actions-sheet"
    >
      <View style={styles.content}>
        <Text style={[styles.sectionLabel, { color: colors.text.tertiary }]}>
          {m.chat.headerCurrentConversation}
        </Text>
        <View
          style={[
            styles.group,
            { backgroundColor: colors.surface.panel, borderColor: colors.border.default },
          ]}
        >
          <ChatActionRow
            icon="account-outline"
            label={m.chat.headerCurrentAgent}
            description={agentName}
            onPress={onAgentPress}
          />
          <ChatActionRow
            icon={autoReadAloudEnabled ? 'volume-high' : 'volume-off'}
            label={m.chat.headerAutoReadAloud}
            description={m.chat.headerAutoReadAloudHint}
            onPress={onAutoReadAloudToggle}
            isLast
            accessibilityRole="switch"
            selected={autoReadAloudEnabled}
            trailing={(
              <Switch
                value={autoReadAloudEnabled}
                pointerEvents="none"
                color={colors.accent.primary}
              />
            )}
          />
        </View>

        <Text style={[styles.sectionLabel, styles.actionsLabel, { color: colors.text.tertiary }]}>
          {m.chat.headerQuickActions}
        </Text>
        <View
          style={[
            styles.group,
            { backgroundColor: colors.surface.panel, borderColor: colors.border.default },
          ]}
        >
          <ChatActionRow
            icon="square-edit-outline"
            label={m.chat.headerNewChat}
            description={m.chat.headerNewChatHint}
            onPress={onNewChat}
            isLast={!onFilesPress}
          />
          {onFilesPress ? (
            <ChatActionRow
              icon="folder-outline"
              label={m.chat.openSessionFiles}
              description={m.chat.headerSessionFilesHint}
              onPress={onFilesPress}
              isLast
            />
          ) : null}
        </View>
      </View>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
  },
  sectionLabel: {
    ...typography.label,
    fontWeight: '600',
    marginBottom: spacing.sm,
    marginLeft: spacing.md,
  },
  actionsLabel: {
    marginTop: spacing.xl,
  },
  group: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    ...typography.ui,
    fontWeight: '600',
  },
  rowDescription: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
});
