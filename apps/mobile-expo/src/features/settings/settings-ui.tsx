import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { radii, spacing, typography, useTheme } from '../../theme';

export function useSettingsColors() {
  const { colors } = useTheme();
  return {
    pageBg: colors.surface.base,
    card: colors.surface.panel,
    iconBg: colors.surface.grouped,
    pressed: colors.surface.pressed,
    text: colors.text.primary,
    textMuted: colors.text.tertiary,
    border: colors.border.default,
    accent: colors.accent.primary,
    accentSoft: colors.accent.selectionBg,
    success: colors.semantic.success,
    warning: colors.semantic.warning,
    error: colors.semantic.error,
    sectionLabel: colors.text.tertiary,
  };
}

type SettingsSectionProps = {
  title?: string;
  children: React.ReactNode;
  style?: ViewStyle;
};

export function SettingsSection({ title, children, style }: SettingsSectionProps) {
  const colors = useSettingsColors();
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <Text style={[styles.sectionTitle, { color: colors.sectionLabel }]}>{title}</Text>
      ) : null}
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

type SettingsRowProps = {
  icon: string;
  iconColor?: string;
  label: string;
  value?: string;
  rightAccessory?: React.ReactNode;
  showChevron?: boolean;
  isLast?: boolean;
  onPress?: () => void;
};

export function SettingsRow({
  icon,
  iconColor,
  label,
  value,
  rightAccessory,
  showChevron = true,
  isLast = false,
  onPress,
}: SettingsRowProps) {
  const colors = useSettingsColors();
  const resolvedIconColor = iconColor ?? colors.accent;
  const content = (
    <View style={[styles.row, !isLast && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.iconBg }]}>
        <Icon source={icon} size={18} color={resolvedIconColor} />
      </View>
      <Text style={[styles.rowLabel, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <Text style={[styles.rowValue, { color: colors.textMuted }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {rightAccessory ?? (showChevron ? <Icon source="chevron-right" size={20} color={colors.textMuted} /> : null)}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => pressed && { backgroundColor: colors.pressed }}
    >
      {content}
    </Pressable>
  );
}

type SettingsOptionRowProps = {
  label: string;
  description?: string;
  selected?: boolean;
  isLast?: boolean;
  onPress: () => void;
};

export function SettingsOptionRow({
  label,
  description,
  selected,
  isLast = false,
  onPress,
}: SettingsOptionRowProps) {
  const colors = useSettingsColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        !isLast && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
        pressed && { backgroundColor: colors.pressed },
      ]}
    >
      <View style={styles.optionText}>
        <Text style={[styles.optionLabel, { color: colors.text }]}>{label}</Text>
        {description ? (
          <Text style={[styles.optionDescription, { color: colors.textMuted }]} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon source="check" size={20} color={colors.accent} /> : null}
    </Pressable>
  );
}

type SettingsAgentRowProps = {
  name: string;
  agentId: string;
  description?: string;
  selected?: boolean;
  isLast?: boolean;
  chatLoading?: boolean;
  onSelect: () => void;
  onChat: () => void;
};

export function SettingsAgentRow({
  name,
  agentId,
  description,
  selected,
  isLast = false,
  chatLoading,
  onSelect,
  onChat,
}: SettingsAgentRowProps) {
  const colors = useSettingsColors();
  return (
    <View style={[styles.agentRow, !isLast && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <Pressable
        onPress={onSelect}
        style={({ pressed }) => [styles.agentRowMain, pressed && { backgroundColor: colors.pressed }]}
      >
        <View style={[styles.iconWrap, { backgroundColor: colors.iconBg }]}>
          <Icon source="robot-outline" size={18} color={colors.accent} />
        </View>
        <View style={styles.optionText}>
          <Text style={[styles.optionLabel, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.optionDescription, { color: colors.textMuted }]} numberOfLines={1}>
            {description || agentId}
          </Text>
        </View>
        {selected ? <Icon source="check-circle" size={22} color={colors.accent} /> : null}
      </Pressable>
      <Pressable
        onPress={onChat}
        disabled={chatLoading}
        style={({ pressed }) => [styles.agentChatBtn, pressed && { backgroundColor: colors.pressed }]}
        hitSlop={8}
      >
        <Icon source="chat-outline" size={22} color={colors.accent} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.xxl,
  },
  sectionTitle: {
    ...typography.label,
    fontWeight: '600',
    marginBottom: spacing.sm,
    marginLeft: spacing.md,
  },
  card: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowPressed: {
    opacity: 0.68,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    ...typography.ui,
    fontWeight: '500',
  },
  rowValue: {
    ...typography.ui,
    maxWidth: '42%',
    textAlign: 'right',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  optionLabel: {
    ...typography.ui,
    fontWeight: '500',
  },
  optionText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  optionDescription: {
    ...typography.label,
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 6,
  },
  agentRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.md,
    paddingVertical: 12,
    gap: spacing.md,
    minWidth: 0,
  },
  agentChatBtn: {
    width: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
