import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast } from '@/components/AppToast';
import { useMessages } from '@/i18n/messages';
import { radii, spacing, typography, useTheme } from '@/theme';

import type { ContentIntakeIntent, ContentIntakeSource, ContentIntakeType } from './content-intent';

export type ContentIntakeModalProps = {
  visible: boolean;
  source?: ContentIntakeSource | null;
  intent: ContentIntakeIntent | null;
  saving: boolean;
  toast: string;
  onSave: () => void;
  onExplore: () => void;
  onDismiss?: () => void;
  onToastDismiss: () => void;
};

export function ContentIntakeModal({
  visible,
  source = null,
  intent,
  saving,
  toast,
  onSave,
  onExplore,
  onDismiss,
  onToastDismiss,
}: ContentIntakeModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const m = useMessages();
  const progressRef = useRef(new Animated.Value(0));
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!visible) {
      progressRef.current.setValue(0);
      setClosing(false);
      return;
    }
    Animated.timing(progressRef.current, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible]);

  const runAction = useCallback((action: () => void) => {
    if (saving || closing || !intent) return;
    setClosing(true);
    Animated.timing(progressRef.current, {
      toValue: 0,
      duration: 140,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      setClosing(false);
      if (finished) action();
    });
  }, [closing, intent, saving]);

  const disabled = saving || closing;
  const sourceLabel = source === 'share' ? m.contentIntake.sourceShare : m.contentIntake.sourceClipboard;
  const title = source === 'share' ? m.contentIntake.titleShare : m.contentIntake.titleClipboard;
  const headerIcon = source === 'share' ? 'share-variant-outline' : 'clipboard-text-outline';
  const typeLabel = intent ? contentTypeLabel(m, intent.type) : '';

  const cardStyle = {
    opacity: progressRef.current,
    transform: [
      {
        scale: progressRef.current.interpolate({
          inputRange: [0, 1],
          outputRange: [0.99, 1],
        }),
      },
      {
        translateY: progressRef.current.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0],
        }),
      },
    ],
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss ?? (() => {})}>
        <View
          style={[
            styles.scrim,
            {
              backgroundColor: colors.overlay.scrim,
              paddingBottom: Math.max(insets.bottom, spacing.md),
            },
          ]}
        >
          <Animated.View
            style={[
              styles.card,
              cardStyle,
              {
                backgroundColor: colors.surface.panel,
                borderColor: colors.border.default,
              },
            ]}
          >
            <View style={styles.header}>
              <View style={[styles.iconWrap, { backgroundColor: colors.accent.soft }]}>
                <Icon source={headerIcon} size={20} color={colors.accent.primary} />
              </View>
              <View style={styles.headerCopy}>
                <Text style={[styles.title, { color: colors.text.primary }]}>
                  {title}
                </Text>
                <Text style={[styles.subtitle, { color: colors.text.secondary }]}>
                  {m.contentIntake.subtitle}
                </Text>
              </View>
            </View>

            <View style={styles.metaRow}>
              <View style={[styles.chip, { backgroundColor: colors.surface.input, borderColor: colors.border.default }]}>
                <Text style={[styles.chipText, { color: colors.text.secondary }]}>{sourceLabel}</Text>
              </View>
              {typeLabel ? (
                <View style={[styles.chip, { backgroundColor: colors.surface.input, borderColor: colors.border.default }]}>
                  <Text style={[styles.chipText, { color: colors.text.secondary }]}>{typeLabel}</Text>
                </View>
              ) : null}
              {intent?.isSensitive ? (
                <View style={[styles.chip, { backgroundColor: colors.accent.soft, borderColor: colors.border.strong }]}>
                  <Icon source="shield-check-outline" size={14} color={colors.accent.primary} />
                  <Text style={[styles.chipText, { color: colors.accent.primary }]}>
                    {m.contentIntake.sensitiveHidden}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.previewBox, { backgroundColor: colors.surface.input, borderColor: colors.border.default }]}>
              <Text style={[styles.previewLabel, { color: colors.text.secondary }]}>
                {m.contentIntake.previewLabel}
              </Text>
              <Text style={[styles.preview, { color: colors.text.primary }]} numberOfLines={7}>
                {intent?.previewText ?? ''}
              </Text>
            </View>

            <View style={styles.actions} accessibilityLabel={m.contentIntake.chooseAction}>
              <Pressable
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => runAction(onSave)}
                style={({ pressed }) => [
                  styles.actionRow,
                  {
                    borderColor: colors.border.default,
                    backgroundColor: colors.surface.panel,
                  },
                  pressed && styles.pressed,
                  disabled && styles.disabled,
                ]}
              >
                <View style={[styles.actionIcon, { backgroundColor: colors.surface.input }]}>
                  <Icon source="note-plus-outline" size={20} color={colors.text.primary} />
                </View>
                <View style={styles.actionCopy}>
                  <Text style={[styles.actionTitle, { color: colors.text.primary }]}>
                    {m.contentIntake[intent?.saveActionKey ?? 'saveToNote']}
                  </Text>
                  <Text style={[styles.actionHint, { color: colors.text.secondary }]}>
                    {m.contentIntake.saveHint}
                  </Text>
                </View>
                <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => runAction(onExplore)}
                style={({ pressed }) => [
                  styles.actionRow,
                  {
                    backgroundColor: colors.accent.primary,
                    borderColor: colors.accent.primary,
                  },
                  pressed && styles.pressed,
                  disabled && styles.disabled,
                ]}
              >
                <View style={styles.primaryActionIcon}>
                  <Icon source="message-text-outline" size={20} color={colors.accent.onPrimary} />
                </View>
                <View style={styles.actionCopy}>
                  <Text style={[styles.actionTitle, { color: colors.accent.onPrimary }]}>
                    {m.contentIntake[intent?.chatActionKey ?? 'exploreInChat']}
                  </Text>
                  <Text style={[styles.actionHint, { color: colors.accent.onPrimary }]}>
                    {m.contentIntake.chatHint}
                  </Text>
                </View>
                <Icon source="chevron-right" size={20} color={colors.accent.onPrimary} />
              </Pressable>
            </View>

            {onDismiss ? (
              <Pressable
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => runAction(onDismiss)}
                style={({ pressed }) => [
                  styles.dismissButton,
                  { borderColor: colors.border.subtle },
                  pressed && styles.pressed,
                  disabled && styles.disabled,
                ]}
              >
                <Text style={[styles.dismissText, { color: colors.text.secondary }]}>
                  {m.contentIntake.dismiss}
                </Text>
                <Text style={[styles.dismissHint, { color: colors.text.tertiary }]}>
                  {m.contentIntake.dismissHint}
                </Text>
              </Pressable>
            ) : null}
          </Animated.View>
        </View>
      </Modal>
      <AppToast visible={Boolean(toast)} onDismiss={onToastDismiss}>
        {toast}
      </AppToast>
    </>
  );
}

function contentTypeLabel(m: ReturnType<typeof useMessages>, type: ContentIntakeType): string {
  switch (type) {
    case 'url':
      return m.contentIntake.typeUrl;
    case 'code':
      return m.contentIntake.typeCode;
    case 'todo':
      return m.contentIntake.typeTodo;
    case 'longText':
      return m.contentIntake.typeLongText;
    case 'text':
      return m.contentIntake.typeText;
  }
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.heading,
  },
  subtitle: {
    ...typography.label,
    marginTop: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  chip: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
  },
  chipText: {
    ...typography.micro,
  },
  previewBox: {
    marginTop: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  previewLabel: {
    ...typography.micro,
    marginBottom: spacing.sm,
  },
  preview: {
    ...typography.body,
    lineHeight: 22,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  actionRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  actionCopy: {
    flex: 1,
    minWidth: 0,
  },
  actionTitle: {
    ...typography.ui,
  },
  actionHint: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
  dismissButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dismissText: {
    ...typography.label,
  },
  dismissHint: {
    ...typography.caption,
    marginTop: spacing.xxs,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.5,
  },
});
