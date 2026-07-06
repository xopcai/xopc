import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';

interface NoteDetailHeaderProps {
  onBack: () => void;
  backLabel: string;
  rightActions?: Array<{
    icon: string;
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }>;
}

export function NoteDetailHeader({ onBack, backLabel, rightActions = [] }: NoteDetailHeaderProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const backgroundColor = colors.surface.input;

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>
      <Pressable
        style={[styles.iconButton, { backgroundColor }]}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
      >
        <Icon source="chevron-left" size={24} color={colors.text.secondary} />
      </Pressable>
      <View style={styles.spacer} />
      {rightActions.length ? rightActions.map((action) => (
        <Pressable
          key={`${action.icon}:${action.label}`}
          style={[styles.iconButton, { backgroundColor, opacity: action.disabled ? 0.35 : 1 }]}
          onPress={action.onPress}
          disabled={action.disabled}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled: Boolean(action.disabled) }}
        >
          <Icon source={action.icon} size={21} color={colors.text.secondary} />
        </Pressable>
      )) : (
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
  spacer: { flex: 1 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPlaceholder: {
    width: 44,
    height: 44,
  },
});
