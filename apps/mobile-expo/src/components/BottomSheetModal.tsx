import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Text } from 'react-native-paper';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { motion, useReducedMotion } from '../motion';
import { radii, spacing, typography, useTheme } from '../theme';

export type BottomSheetModalProps = {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  subtitle?: string;
  headerAction?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxHeight?: `${number}%` | number;
  scroll?: boolean;
  keyboardAvoiding?: boolean;
  testID?: string;
};

export function BottomSheetModal({
  visible,
  onDismiss,
  title,
  subtitle,
  headerAction,
  children,
  footer,
  maxHeight = '70%',
  scroll = false,
  keyboardAvoiding = false,
  testID,
}: BottomSheetModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { height: screenHeight } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);
  const dragY = useSharedValue(0);
  const closingRef = useRef(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const completeClose = useCallback((notify: boolean) => {
    closingRef.current = false;
    setMounted(false);
    if (notify) onDismissRef.current();
  }, []);

  const close = useCallback((notify = true) => {
    if (closingRef.current) return;
    closingRef.current = true;
    cancelAnimation(progress);
    if (reducedMotion) {
      progress.value = 0;
      completeClose(notify);
      return;
    }
    progress.value = withTiming(
      0,
      { duration: motion.duration.standard, easing: motion.easing.exit },
      (finished) => {
        if (finished) scheduleOnRN(completeClose, notify);
      },
    );
  }, [completeClose, progress, reducedMotion]);

  const requestDismiss = useCallback(() => close(true), [close]);

  useEffect(() => {
    if (!visible) {
      if (mounted) close(false);
      return;
    }

    closingRef.current = false;
    setMounted(true);
    cancelAnimation(progress);
    dragY.value = 0;
    if (reducedMotion) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: motion.duration.standard,
      easing: motion.easing.enter,
    });
  }, [close, dragY, mounted, progress, reducedMotion, visible]);

  const dismissGesture = Gesture.Pan()
    .enabled(!reducedMotion)
    .activeOffsetY(8)
    .failOffsetX([-24, 24])
    .onUpdate((event) => {
      dragY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (dragY.value > 72 || event.velocityY > 850) {
        scheduleOnRN(requestDismiss);
        return;
      }
      dragY.value = withSpring(0, motion.spring.settle);
    });

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value * Math.max(0, 1 - dragY.value / (screenHeight * 0.7)),
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: reducedMotion ? progress.value : 1,
    transform: [{
      translateY: reducedMotion
        ? 0
        : (1 - progress.value) * screenHeight + dragY.value,
    }],
  }));

  if (!mounted) return null;

  const content = (
    <View style={styles.overlay}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay.scrim }, scrimStyle]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={requestDismiss}
          accessible={false}
        />
      </Animated.View>
      <Animated.View
        testID={testID}
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface.panel,
            maxHeight,
            paddingBottom: Math.max(insets.bottom, spacing.xl),
          },
          sheetStyle,
        ]}
        accessibilityViewIsModal
        onAccessibilityEscape={requestDismiss}
      >
        <GestureDetector gesture={dismissGesture}>
          <View style={styles.handleTarget} accessible={false}>
            <View style={[styles.handle, { backgroundColor: colors.border.strong }]} />
          </View>
        </GestureDetector>
        {title ? (
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: colors.text.primary }]}>{title}</Text>
              {subtitle ? (
                <Text style={[styles.subtitle, { color: colors.text.tertiary }]}>{subtitle}</Text>
              ) : null}
            </View>
            {headerAction}
          </View>
        ) : null}
        {scroll ? (
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {children}
          </ScrollView>
        ) : (
          children
        )}
        {footer ? <View style={[styles.footer, { borderTopColor: colors.border.subtle }]}>{footer}</View> : null}
      </Animated.View>
    </View>
  );

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={requestDismiss}
      onShow={() => {
        if (title) AccessibilityInfo.announceForAccessibility(title);
      }}
    >
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {content}
        </KeyboardAvoidingView>
      ) : content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    overflow: 'hidden',
  },
  handleTarget: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 40,
    height: 6,
    borderRadius: 3,
    opacity: 0.7,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.heading,
  },
  subtitle: {
    ...typography.caption,
  },
  scrollArea: {
    paddingHorizontal: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.xs,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
});
