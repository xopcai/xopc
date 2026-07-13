import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMessages } from '../i18n/messages';
import { spacing, typography, useTheme } from '../theme';
import { XopcLogo } from './XopcLogo';

type FloatingHeaderAction = {
  icon: string;
  onPress: () => void;
  accessibilityLabel?: string;
};

interface FloatingHeaderProps {
  title?: string;
  variant?: 'compact' | 'large';
  showLogo?: boolean;
  onBack?: () => void;
  rightIcon?: string;
  onRightPress?: () => void;
  rightActions?: FloatingHeaderAction[];
  searchPlaceholder?: string;
  onSearchPress?: () => void;
}

export function FloatingHeader({
  title,
  variant = 'compact',
  showLogo,
  onBack,
  rightIcon,
  onRightPress,
  rightActions,
  searchPlaceholder,
  onSearchPress,
}: FloatingHeaderProps) {
  const { colors } = useTheme();
  const m = useMessages();
  const insets = useSafeAreaInsets();
  const backgroundColor = colors.surface.input;
  const actions = rightActions ?? (rightIcon && onRightPress ? [{ icon: rightIcon, onPress: onRightPress }] : []);
  const showRightCluster = actions.length > 0;

  const leading = onBack ? (
    <Pressable
      style={styles.iconButton}
      onPress={onBack}
      accessibilityRole="button"
      accessibilityLabel={m.common.back}
      hitSlop={6}
    >
      <Icon source="chevron-left" size={26} color={colors.text.primary} />
    </Pressable>
  ) : showLogo ? (
    <View style={styles.logoButton}>
      <XopcLogo size={30} />
    </View>
  ) : (
    <View style={styles.iconPlaceholder} />
  );

  const actionCluster = showRightCluster ? (
    <View style={styles.actionsRow}>
      {actions.map((action) => (
        <Pressable
          key={action.icon}
          style={styles.iconButton}
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel}
          hitSlop={6}
        >
          <Icon source={action.icon} size={22} color={colors.text.primary} />
        </Pressable>
      ))}
    </View>
  ) : (
    <View style={styles.iconPlaceholder} />
  );

  if (variant === 'large' && !onSearchPress) {
    return (
      <View style={[styles.largeWrap, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.largeTopRow}>
          {onBack ? leading : <View style={styles.iconPlaceholder} />}
          {actionCluster}
        </View>
        <Text numberOfLines={1} style={[styles.largeTitle, { color: colors.text.primary }]}>
          {title}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.sm }]}>
      {leading}

      {onSearchPress ? (
        <Pressable
          style={[styles.titlePill, styles.searchPill, { backgroundColor }]}
          onPress={onSearchPress}
          accessibilityRole="search"
          accessibilityLabel={searchPlaceholder ?? m.common.search}
        >
          <Icon source="magnify" size={19} color={colors.text.tertiary} />
          <Text numberOfLines={1} style={[styles.searchPlaceholder, { color: colors.text.tertiary }]}>
            {searchPlaceholder ?? m.common.search}
          </Text>
        </Pressable>
      ) : (
        <View style={styles.titlePill}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.text.primary }]}>{title}</Text>
        </View>
      )}

      {actionCluster}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.content,
    paddingBottom: spacing.sm,
  },
  largeWrap: {
    paddingHorizontal: spacing.content,
    paddingBottom: spacing.md,
  },
  largeTopRow: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPlaceholder: {
    width: 44,
    height: 44,
  },
  titlePill: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  title: {
    ...typography.ui,
    fontWeight: '600',
  },
  largeTitle: {
    ...typography.largeTitle,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  searchPill: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  searchPlaceholder: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
});
