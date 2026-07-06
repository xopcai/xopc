import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMessages } from '../i18n/messages';
import { useTheme } from '../theme';
import { XopcLogo } from './XopcLogo';

type FloatingHeaderAction = {
  icon: string;
  onPress: () => void;
  accessibilityLabel?: string;
};

interface FloatingHeaderProps {
  title?: string;
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

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>
      {onBack ? (
        <Pressable style={[styles.iconButton, { backgroundColor }]} onPress={onBack}>
          <Icon source="chevron-left" size={24} color={colors.text.secondary} />
        </Pressable>
      ) : showLogo ? (
        <View style={[styles.iconButton, styles.logoButton, { backgroundColor }]}>
          <XopcLogo size={32} />
        </View>
      ) : (
        <View style={styles.iconPlaceholder} />
      )}

      {onSearchPress ? (
        <Pressable
          style={[styles.titlePill, styles.searchPill, { backgroundColor }]}
          onPress={onSearchPress}
          accessibilityRole="search"
          accessibilityLabel={searchPlaceholder ?? m.common.search}
        >
          <Icon source="magnify" size={20} color={colors.text.tertiary} />
          <Text numberOfLines={1} style={[styles.searchPlaceholder, { color: colors.text.tertiary }]}>
            {searchPlaceholder ?? m.common.search}
          </Text>
        </Pressable>
      ) : (
        <View style={[styles.titlePill, { backgroundColor }]}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.text.primary }]}>{title}</Text>
        </View>
      )}

      {showRightCluster ? (
        <View style={styles.actionsRow}>
          {actions.map((action) => (
            <Pressable
              key={action.icon}
              style={[styles.iconButton, { backgroundColor }]}
              onPress={action.onPress}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel}
            >
              <Icon source={action.icon} size={22} color={colors.text.secondary} />
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.iconPlaceholder} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoButton: {
    overflow: 'hidden',
    padding: 0,
  },
  iconPlaceholder: {
    width: 44,
    height: 44,
  },
  titlePill: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  searchPill: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: 14,
    gap: 8,
  },
  searchPlaceholder: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
});
