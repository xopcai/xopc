import { Stack } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useMessages } from '../i18n/messages';
import { spacing, useTheme } from '../theme';
import { XopcLogo } from './XopcLogo';

type HeaderAction = {
  icon: string;
  onPress: () => void;
  accessibilityLabel?: string;
};

interface NativeScreenHeaderProps {
  title?: string;
  showLogo?: boolean;
  onBack?: () => void;
  rightIcon?: string;
  onRightPress?: () => void;
  rightActions?: HeaderAction[];
  searchPlaceholder?: string;
  onSearchPress?: () => void;
  onTitlePress?: () => void;
  titleAccessibilityLabel?: string;
}

function HeaderTitleButton({
  title,
  onPress,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={styles.titleButton}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={[styles.titleText, { color: colors.text.primary }]} numberOfLines={1}>
        {title}
      </Text>
      <Icon source="chevron-down" size={17} color={colors.text.tertiary} />
    </Pressable>
  );
}

function HeaderIconButton({ action }: { action: HeaderAction }) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={styles.button}
      onPress={action.onPress}
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel}
      hitSlop={4}
    >
      <Icon source={action.icon} size={22} color={colors.text.primary} />
    </Pressable>
  );
}

/** Configures the route's native navigation bar; it renders no in-content chrome. */
export function NativeScreenHeader({
  title,
  showLogo,
  onBack,
  rightIcon,
  onRightPress,
  rightActions,
  searchPlaceholder,
  onSearchPress,
  onTitlePress,
  titleAccessibilityLabel,
}: NativeScreenHeaderProps) {
  const m = useMessages();
  const actions = [
    ...(onSearchPress ? [{
      icon: 'magnify',
      onPress: onSearchPress,
      accessibilityLabel: searchPlaceholder ?? m.common.search,
    }] : []),
    ...(rightActions ?? (rightIcon && onRightPress ? [{ icon: rightIcon, onPress: onRightPress }] : [])),
  ];

  return (
    <Stack.Screen
      options={{
        headerShown: true,
        title: title ?? '',
        headerTitle: onTitlePress && title
          ? () => (
              <HeaderTitleButton
                title={title}
                onPress={onTitlePress}
                accessibilityLabel={titleAccessibilityLabel}
              />
            )
          : undefined,
        headerLargeTitle: false,
        headerShadowVisible: false,
        headerBackVisible: !onBack,
        headerLeft: onBack
          ? () => (
              <HeaderIconButton
                action={{ icon: 'chevron-left', onPress: onBack, accessibilityLabel: m.common.back }}
              />
            )
          : showLogo
            ? () => <View style={styles.logo}><XopcLogo size={28} /></View>
            : undefined,
        headerRight: actions.length > 0
          ? () => (
              <View style={styles.actions}>
                {actions.map((action, index) => <HeaderIconButton key={`${action.icon}:${index}`} action={action} />)}
              </View>
            )
          : undefined,
      }}
    />
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titleButton: {
    maxWidth: 220,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  titleText: { maxWidth: 185, fontSize: 16, fontWeight: '600' },
});
