/**
 * SwipeableRow — shared swipeable list item wrapper.
 *
 * Renders right-side action buttons (archive, delete, pin, etc.) behind the
 * content row. Uses react-native-gesture-handler's Reanimated Swipeable so the
 * drag stays on the native/UI thread.
 *
 * Design spec (AGENTS.md):
 * - Circular action buttons 44×44
 * - Color semantics: green=pin, blue=archive, red=delete
 * - Mutually exclusive open (via swipe-open-registry)
 * - Disabled when selectionMode is active
 */

import { memo, useCallback, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from 'react-native-paper';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { colors as tokenColors, useTheme } from '../theme';
import {
  registerSwipeOpen,
  unregisterSwipeOpen,
} from './swipe-open-registry';

// ── Action types ────────────────────────────────────────────

export type SwipeActionColor = 'green' | 'blue' | 'red';

export type SwipeAction = {
  key: string;
  icon: string;
  color: SwipeActionColor;
  label: string;
  destructive?: boolean;
};

export const ACTION_COLOR_MAP: Record<SwipeActionColor, string> = {
  green: tokenColors.light.semantic.success,
  blue: tokenColors.light.accent.primary,
  red: tokenColors.light.semantic.error,
};

// ── Props ────────────────────────────────────────────────────

export type SwipeableRowProps = {
  actions: SwipeAction[];
  onActionPress: (action: SwipeAction) => void;
  enabled?: boolean;
  children: React.ReactNode;
};

// ── Dock sizing ──────────────────────────────────────────────

const ACTION_BUTTON_SIZE = 44;
const ACTION_GAP = 8;
const DOCK_HORIZONTAL_PADDING = 8;
const ACTION_PANEL_MARGIN_LEFT = 12;
const ACTION_PANEL_MARGIN_RIGHT = 8;
// Rows expose right-side actions only. Keep both directions deliberate so
// vertical scrolling does not get stolen by tiny horizontal drift, while an
// opened row can still be swiped right to close.
const SWIPE_DRAG_OFFSET = 24;

function actionPanelWidth(actionCount: number): number {
  if (actionCount <= 0) return 0;
  return (actionCount * ACTION_BUTTON_SIZE)
    + ((actionCount - 1) * ACTION_GAP)
    + (DOCK_HORIZONTAL_PADDING * 2)
    + ACTION_PANEL_MARGIN_LEFT
    + ACTION_PANEL_MARGIN_RIGHT;
}

type ActionColorMap = Record<SwipeActionColor, string>;

type RightActionsProps = {
  actions: SwipeAction[];
  onActionPress: (action: SwipeAction) => void;
  close: () => void;
  actionColors: ActionColorMap;
  dockBackgroundColor: string;
  dockBorderColor: string;
  actionIconColor: string;
};

function RightActions({
  actions,
  onActionPress,
  close,
  actionColors,
  dockBackgroundColor,
  dockBorderColor,
  actionIconColor,
}: RightActionsProps) {
  const width = actionPanelWidth(actions.length);

  return (
    <View style={[styles.actionsContainer, { width }]}>
      <View
        style={[
          styles.actionsDock,
          {
            backgroundColor: dockBackgroundColor,
            borderColor: dockBorderColor,
          },
        ]}
      >
        {actions.map((action) => (
          <DockActionButton
            key={action.key}
            action={action}
            color={actionColors[action.color]}
            iconColor={actionIconColor}
            close={close}
            onActionPress={onActionPress}
          />
        ))}
      </View>
    </View>
  );
}

type DockActionButtonProps = {
  action: SwipeAction;
  color: string;
  iconColor: string;
  close: () => void;
  onActionPress: (action: SwipeAction) => void;
};

function DockActionButton({
  action,
  color,
  iconColor,
  close,
  onActionPress,
}: DockActionButtonProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.actionButton,
        { backgroundColor: color },
        pressed && styles.actionButtonPressed,
      ]}
      onPress={() => {
        close();
        onActionPress(action);
      }}
      accessibilityRole="button"
      accessibilityLabel={action.label}
    >
      <Icon source={action.icon} size={21} color={iconColor} />
    </Pressable>
  );
}

// ── Component ────────────────────────────────────────────────

export const SwipeableRow = memo(function SwipeableRow({
  actions,
  onActionPress,
  enabled = true,
  children,
}: SwipeableRowProps) {
  const { colors, isDark } = useTheme();
  const swipeableRef = useRef<SwipeableMethods | null>(null);
  const panelWidth = actionPanelWidth(actions.length);
  const actionColors = useMemo<ActionColorMap>(() => ({
    green: colors.semantic.success,
    blue: colors.accent.primary,
    red: colors.semantic.error,
  }), [colors.accent.primary, colors.semantic.error, colors.semantic.success]);
  const dockBackgroundColor = isDark ? colors.surface.input : colors.surface.panel;
  const dockBorderColor = colors.border.default;
  const actionIconColor = colors.accent.onPrimary;

  const handleClose = useCallback(() => {
    swipeableRef.current?.close();
  }, []);

  const handleSwipeableOpen = useCallback(() => {
    registerSwipeOpen(handleClose);
  }, [handleClose]);

  const handleSwipeableClose = useCallback(() => {
    unregisterSwipeOpen(handleClose);
  }, [handleClose]);

  const renderRightActions = useCallback(
    () => (
      <RightActions
        actions={actions}
        onActionPress={onActionPress}
        close={handleClose}
        actionColors={actionColors}
        dockBackgroundColor={dockBackgroundColor}
        dockBorderColor={dockBorderColor}
        actionIconColor={actionIconColor}
      />
    ),
    [
      actionColors,
      actions,
      dockBackgroundColor,
      dockBorderColor,
      actionIconColor,
      handleClose,
      onActionPress,
    ],
  );

  if (!enabled) {
    return <View>{children}</View>;
  }

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      friction={1}
      rightThreshold={Math.min(panelWidth * 0.42, 72)}
      dragOffsetFromRightEdge={SWIPE_DRAG_OFFSET}
      dragOffsetFromLeftEdge={SWIPE_DRAG_OFFSET}
      overshootRight={false}
      enableTrackpadTwoFingerGesture
      containerStyle={styles.swipeableContainer}
      onSwipeableWillOpen={handleSwipeableOpen}
      onSwipeableClose={handleSwipeableClose}
    >
      {children}
    </ReanimatedSwipeable>
  );
});

const styles = StyleSheet.create({
  swipeableContainer: {
    overflow: 'visible',
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingLeft: ACTION_PANEL_MARGIN_LEFT,
    paddingRight: ACTION_PANEL_MARGIN_RIGHT,
  },
  actionsDock: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: ACTION_GAP,
    paddingHorizontal: DOCK_HORIZONTAL_PADDING,
    borderRadius: 29,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionButton: {
    width: ACTION_BUTTON_SIZE,
    height: ACTION_BUTTON_SIZE,
    borderRadius: ACTION_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonPressed: {
    opacity: 0.74,
  },
});
