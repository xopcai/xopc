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
    <BottomSheetModal visible={visible && enabled} onDismiss={() => setVisible(false)} title={title} maxHeight="60%"
      onAfterDismiss={() => {
        const action = pending.current;
        pending.current = null;
        action?.();
      }}>
      <View style={styles.actions}>
        <View style={[styles.actionGroup, { backgroundColor: colors.surface.grouped }]}>
          {items.filter(item => !item.destructive).map(item => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.label}
            onPress={() => choose(item.run)} style={({ pressed }) => [styles.action, pressed && { backgroundColor: colors.surface.pressed }]}>
            <View style={[styles.iconTile, { backgroundColor: colors.surface.panel }]}>
              <Icon source={item.icon} size={21} color={colors.text.secondary} />
            </View>
            <Text style={[styles.label, { color: colors.text.primary }]}>{item.label}</Text>
          </Pressable>)}
        </View>
        {items.filter(item => item.destructive).map(item => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.label}
          onPress={() => choose(item.run)} style={({ pressed }) => [styles.action, styles.destructiveAction,
            { backgroundColor: pressed ? colors.surface.pressed : colors.surface.grouped }]}>
          <View style={[styles.iconTile, { backgroundColor: colors.surface.panel }]}>
            <Icon source={item.icon} size={21} color={colors.semantic.error} />
          </View>
          <Text style={[styles.label, { color: colors.semantic.error }]}>{item.label}</Text>
        </Pressable>)}
      </View>
    </BottomSheetModal>
  </>;
}
const styles = StyleSheet.create({
  actions: { paddingHorizontal: spacing.lg, gap: spacing.md },
  actionGroup: { padding: spacing.xs, borderRadius: radii.xl, gap: spacing.xxs },
  action: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radii.lg },
  destructiveAction: { marginTop: spacing.xxs },
  iconTile: { width: 36, height: 36, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  label: { ...typography.ui, flex: 1, fontWeight: '500' },
});
