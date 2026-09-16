import { useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useMessages } from '../i18n/messages';
import { radii, spacing, typography, useTheme } from '../theme';
import { BottomSheetModal } from './BottomSheetModal';

export type ListItemAction = {
  key: string;
  icon: string;
  label: string;
  destructive?: boolean;
};

export function ListItemMenu({ title, actions, onActionPress, onSelect, enabled = true, children }: {
  title: string;
  actions: ListItemAction[];
  onActionPress: (action: ListItemAction) => void;
  onSelect?: () => void;
  enabled?: boolean;
  children: (openMenu: () => void) => ReactNode;
}) {
  const { colors } = useTheme();
  const labels = useMessages().listInteraction;
  const [visible, setVisible] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const choose = (action: () => void) => {
    if (pending.current) return;
    pending.current = action;
    setVisible(false);
  };
  const items = [
    ...actions.map(action => ({ ...action, run: () => onActionPress(action) })),
    ...(onSelect ? [{ key: 'select', icon: 'checkbox-multiple-marked-outline', label: labels.multiSelect, destructive: false, run: onSelect }] : []),
  ].sort((a, b) => Number(Boolean(a.destructive)) - Number(Boolean(b.destructive)));
  return <>
    {children(() => { if (enabled) setVisible(true); })}
    <BottomSheetModal visible={visible && enabled} onDismiss={() => setVisible(false)} title={title} scroll
      onAfterDismiss={() => {
        const action = pending.current;
        pending.current = null;
        action?.();
      }}>
      <View style={styles.actions}>
        {items.map(item => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.label}
          onPress={() => choose(item.run)} style={({ pressed }) => [styles.action, pressed && { backgroundColor: colors.surface.pressed }]}>
          <Icon source={item.icon} size={22} color={item.destructive ? colors.semantic.error : colors.text.secondary} />
          <Text style={[styles.label, { color: item.destructive ? colors.semantic.error : colors.text.primary }]}>{item.label}</Text>
        </Pressable>)}
      </View>
    </BottomSheetModal>
  </>;
}
const styles = StyleSheet.create({
  actions: { paddingHorizontal: spacing.md, gap: spacing.xs },
  action: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radii.md },
  label: { ...typography.ui, flex: 1 },
});
