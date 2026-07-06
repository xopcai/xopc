import { Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { radii, spacing, typography, useTheme } from '../../theme';

export function useSettingsColors() {
  const { colors } = useTheme();
  return {
    pageBg: colors.surface.base,
    card: colors.surface.panel,
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
          Platform.OS === 'web' ? styles.cardRaisedWeb : styles.cardRaisedNative,
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
  onPress,
}: SettingsRowProps) {
  const colors = useSettingsColors();
  const resolvedIconColor = iconColor ?? colors.accent;
  const content = (
    <View style={styles.row}>
      <View style={[styles.iconWrap, { backgroundColor: colors.accentSoft }]}>
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
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.rowPressed}>
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
  onPress,
}: SettingsOptionRowProps) {
  const colors = useSettingsColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        pressed && styles.rowPressed,
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
  chatLoading,
  onSelect,
  onChat,
}: SettingsAgentRowProps) {
  const colors = useSettingsColors();
  return (
    <View style={styles.agentRow}>
      <Pressable
        onPress={onSelect}
        style={({ pressed }) => [styles.agentRowMain, pressed && styles.rowPressed]}
      >
        <View style={[styles.iconWrap, { backgroundColor: colors.accentSoft }]}>
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
        style={({ pressed }) => [styles.agentChatBtn, pressed && styles.rowPressed]}
        hitSlop={8}
      >
        <Icon source="chat-outline" size={22} color={colors.accent} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.micro,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  card: {
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cardRaisedNative: {
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardRaisedWeb: {
    boxShadow: '0 2px 10px rgba(17, 19, 24, 0.07)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
  },
  rowPressed: {
    opacity: 0.65,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '400',
  },
  rowValue: {
    fontSize: 15,
    maxWidth: '42%',
    textAlign: 'right',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  optionLabel: {
    fontSize: 16,
  },
  optionText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  optionDescription: {
    fontSize: 13,
    lineHeight: 18,
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
    paddingLeft: 14,
    paddingVertical: 12,
    gap: 12,
    minWidth: 0,
  },
  agentChatBtn: {
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
