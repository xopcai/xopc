import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { AppToast } from '@/components/AppToast';
import { useMessages } from '@/i18n/messages';
import { radii, spacing, typography, useTheme } from '@/theme';

import type { ContentIntakeIntent } from './content-intent';

export type ContentIntakeModalProps = {
  visible: boolean;
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
  intent,
  saving,
  toast,
  onSave,
  onExplore,
  onDismiss,
  onToastDismiss,
}: ContentIntakeModalProps) {
  const { colors } = useTheme();
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

  const cardStyle = {
    opacity: progressRef.current,
    transform: [
      {
        scale: progressRef.current.interpolate({
          inputRange: [0, 1],
          outputRange: [0.97, 1],
        }),
      },
      {
        translateY: progressRef.current.interpolate({
          inputRange: [0, 1],
          outputRange: [8, 0],
        }),
      },
    ],
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss ?? (() => {})}>
        <View style={[styles.scrim, { backgroundColor: colors.overlay.scrim }]}>
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
            <Text style={[styles.preview, { color: colors.text.primary }]} numberOfLines={6}>
              {intent?.previewText ?? ''}
            </Text>
            <View style={styles.actions}>
              {onDismiss ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={disabled}
                  onPress={() => runAction(onDismiss)}
                  style={({ pressed }) => [
                    styles.dismissButton,
                    pressed && styles.pressed,
                    disabled && styles.disabled,
                  ]}
                >
                  <Text style={[styles.dismissText, { color: colors.text.tertiary }]}>
                    {m.contentIntake.dismiss}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => runAction(onSave)}
                style={({ pressed }) => [
                  styles.button,
                  {
                    borderColor: colors.border.default,
                    backgroundColor: colors.surface.input,
                  },
                  pressed && styles.pressed,
                  disabled && styles.disabled,
                ]}
              >
                <Text style={[styles.buttonText, { color: colors.text.primary }]}>
                  {m.contentIntake[intent?.saveActionKey ?? 'saveToNote']}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => runAction(onExplore)}
                style={({ pressed }) => [
                  styles.button,
                  {
                    backgroundColor: colors.accent.primary,
                    borderColor: colors.accent.primary,
                  },
                  pressed && styles.pressed,
                  disabled && styles.disabled,
                ]}
              >
                <Text style={[styles.buttonText, { color: colors.accent.onPrimary }]}>
                  {m.contentIntake[intent?.chatActionKey ?? 'exploreInChat']}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </Modal>
      <AppToast visible={Boolean(toast)} onDismiss={onToastDismiss}>
        {toast}
      </AppToast>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  preview: {
    ...typography.body,
    lineHeight: 22,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  button: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  buttonText: {
    ...typography.label,
  },
  dismissButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  dismissText: {
    ...typography.label,
  },
  pressed: {
    opacity: 0.78,
  },
  disabled: {
    opacity: 0.5,
  },
});
