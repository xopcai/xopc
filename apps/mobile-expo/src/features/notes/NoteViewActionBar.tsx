import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FLOATING_BOTTOM_OFFSET, floatingBottomPadding, useTheme } from '../../theme';

export interface NoteViewActionBarItem {
  key: string;
  icon: string;
  label: string;
  active?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

interface NoteViewActionBarProps {
  items: readonly NoteViewActionBarItem[];
}

export function NoteViewActionBar({ items }: NoteViewActionBarProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const barBg = isDark ? colors.surface.panel : colors.surface.base;
  const iconColor = colors.text.secondary;
  const labelColor = colors.text.tertiary;

  return (
    <KeyboardStickyView
      offset={{ closed: 0, opened: 0 }}
      style={styles.sticky}
    >
      <View style={[styles.wrap, { paddingBottom: floatingBottomPadding(insets.bottom) }]}>
        <View
          style={[
            styles.bar,
            {
              backgroundColor: barBg,
              borderColor: colors.border.default,
              shadowColor: colors.text.primary,
            },
          ]}
        >
          {items.map((item) => (
            <Pressable
              key={item.key}
              style={({ pressed }) => [
                styles.action,
                (item.disabled || item.loading) && styles.actionDisabled,
                pressed && !item.disabled && !item.loading && styles.actionPressed,
              ]}
              onPress={item.onPress}
              disabled={item.disabled || item.loading}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{
                selected: Boolean(item.active),
                busy: Boolean(item.loading),
                disabled: Boolean(item.disabled || item.loading),
              }}
            >
              <Icon source={item.loading ? 'loading' : item.icon} size={18} color={item.active ? colors.accent.primary : iconColor} />
              <Text numberOfLines={1} style={[styles.label, { color: item.active ? colors.accent.primary : labelColor }]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </KeyboardStickyView>
  );
}

const styles = StyleSheet.create({
  sticky: {
    marginBottom: FLOATING_BOTTOM_OFFSET,
  },
  wrap: {
    alignItems: 'center',
    paddingTop: 6,
    zIndex: 20,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 28,
    paddingVertical: 7,
    paddingHorizontal: 8,
    maxWidth: '96%',
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 44,
    minWidth: 54,
    flexShrink: 1,
  },
  actionPressed: {
    opacity: 0.55,
  },
  actionDisabled: {
    opacity: 0.48,
  },
  label: {
    fontSize: 10,
    fontWeight: '400',
    lineHeight: 13,
  },
});
