import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { Icon, Text } from 'react-native-paper';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { motion, useReducedMotion } from '../../motion';
import { radii, spacing, typography, useTheme } from '../../theme';
import type { ComposerSheetAction } from './composer-action-sheet';

const PAGE_SIZE = 8;

/** A keyboard-sized, paged accessory surface that keeps the conversation visible. */
export const ComposerActionPanel = memo(function ComposerActionPanel({ visible, items, onClose }: {
  visible: boolean;
  items: ComposerSheetAction[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { height: screenHeight, fontScale } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const keyboard = useReanimatedKeyboardAnimation();
  const expansion = useSharedValue(0);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const pagerRef = useRef<ScrollView>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  const rowHeight = spacing.xxxl + spacing.lg + spacing.sm + typography.label.lineHeight * fontScale * 2;
  const panelHeight = Math.min(screenHeight * 0.45, rowHeight * 2 + spacing.xl * 2 + spacing.lg);
  const pageCount = Math.ceil(items.length / PAGE_SIZE);

  const finishClose = useCallback(() => {
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  }, []);

  useEffect(() => {
    if (visible) {
      pendingAction.current = null;
      setPage(0);
      pagerRef.current?.scrollTo({ x: 0, animated: false });
    }
    expansion.value = withTiming(visible ? panelHeight : 0, {
      duration: reducedMotion ? 0 : motion.duration.standard,
      easing: visible ? motion.easing.enter : motion.easing.exit,
    }, finished => {
      if (finished && !visible) scheduleOnRN(finishClose);
    });
    return () => cancelAnimation(expansion);
  }, [expansion, finishClose, panelHeight, reducedMotion, visible]);

  useEffect(() => {
    setPage(0);
    pagerRef.current?.scrollTo({ x: 0, animated: false });
  }, [width]);

  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose, visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    // The sticky composer already follows the keyboard; reserve only the remaining space.
    height: Math.max(0, expansion.value - Math.abs(keyboard.height.value)),
  }));

  return (
    <Animated.View
      style={[styles.panel, { backgroundColor: colors.surface.input, borderTopColor: colors.border.subtle }, animatedStyle]}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      <View style={{ height: panelHeight }}>
        <ScrollView ref={pagerRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always" style={styles.pager}
          onMomentumScrollEnd={event => {
            if (width > 0) setPage(Math.round(event.nativeEvent.contentOffset.x / width));
          }}
        >
          {Array.from({ length: pageCount }, (_, pageIndex) => (
            <ScrollView key={`${pageIndex}:${width}`} style={{ width }} contentContainerStyle={styles.grid}
              showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="always">
              {items.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE).map(item => (
                <Pressable key={item.key} style={[styles.cell, { minHeight: rowHeight, opacity: item.disabled ? 0.4 : 1 }]}
                  disabled={item.disabled} accessibilityRole="button" accessibilityLabel={item.label}
                  accessibilityHint={item.description} accessibilityState={{ disabled: !!item.disabled }}
                  onPress={() => {
                    if (pendingAction.current) return;
                    pendingAction.current = item.onPress;
                    onClose();
                  }}>
                  {({ pressed }) => <>
                    <View style={[styles.tile, { backgroundColor: pressed ? colors.surface.hover : colors.surface.panel }]}>
                      <Icon source={item.icon} size={spacing.xxl} color={colors.text.primary} />
                    </View>
                    <Text style={[styles.label, { color: colors.text.secondary }]}>{item.label}</Text>
                  </>}
                </Pressable>
              ))}
            </ScrollView>
          ))}
        </ScrollView>
        <View style={styles.dots} accessible={false}>
          {pageCount > 1 && Array.from({ length: pageCount }, (_, index) => (
            <View key={index} style={[styles.dot, { backgroundColor: index === page ? colors.text.primary : colors.border.strong }]} />
          ))}
        </View>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  panel: { overflow: 'hidden', marginHorizontal: -spacing.content, borderTopWidth: StyleSheet.hairlineWidth },
  pager: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md, paddingTop: spacing.xl },
  cell: { width: '25%', alignItems: 'center', paddingHorizontal: spacing.xs, paddingBottom: spacing.md, gap: spacing.sm },
  tile: { width: spacing.xxxl + spacing.lg, height: spacing.xxxl + spacing.lg, borderRadius: radii.xl, alignItems: 'center', justifyContent: 'center' },
  label: { ...typography.label, textAlign: 'center' },
  dots: { height: spacing.xl + spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  dot: { width: spacing.sm, height: spacing.sm, borderRadius: radii.full },
});
