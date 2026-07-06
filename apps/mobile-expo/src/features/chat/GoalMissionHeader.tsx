import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';

import type { WebchatPersistentGoalWire } from '../../query/goals';
import { useTheme } from '../../theme';
import {
  computeGoalWallElapsedMs,
  formatGoalElapsedMs,
  phaseLabel,
  statusLabel,
  type GoalMessages,
  type GoalUiPhase,
} from './goal-utils';

type Props = {
  goal: WebchatPersistentGoalWire;
  phase: GoalUiPhase;
  collapsed: boolean;
  t: GoalMessages;
  onToggleCollapsed: () => void;
};

export const GoalMissionHeader = memo(function GoalMissionHeader({
  goal,
  phase,
  collapsed,
  t,
  onToggleCollapsed,
}: Props) {
  const { colors } = useTheme();
  const accent = goal.status === 'paused'
    ? colors.semantic.warning
    : goal.status === 'done'
      ? colors.semantic.success
      : colors.accent.primary;
  const badgeBg = colors.surface.input;
  const elapsed = formatGoalElapsedMs(computeGoalWallElapsedMs(goal));

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <View style={[styles.iconDot, { backgroundColor: accent }]} />
        <View style={styles.titleBox}>
          <Text variant="labelMedium" style={[styles.phase, { color: accent }]} numberOfLines={1}>
            {phaseLabel(phase, t)}
          </Text>
          <Text variant="titleSmall" style={styles.title} numberOfLines={2}>
            {goal.goal}
          </Text>
        </View>
        <IconButton
          icon={collapsed ? 'chevron-down' : 'chevron-up'}
          size={20}
          style={styles.collapseButton}
          accessibilityLabel={collapsed ? t.expand : t.collapse}
          onPress={onToggleCollapsed}
        />
      </View>

      <Pressable style={styles.metaRow} onPress={onToggleCollapsed}>
        <Text style={[styles.badge, { backgroundColor: badgeBg }]} numberOfLines={1}>
          {statusLabel(goal, t)}
        </Text>
        <Text style={[styles.badge, { backgroundColor: badgeBg }]} numberOfLines={1}>
          {t.turnsShort.replace('{{used}}', String(goal.turnsUsed)).replace('{{total}}', String(goal.maxTurns))}
        </Text>
        <Text style={[styles.badge, { backgroundColor: badgeBg }]} numberOfLines={1}>
          {t.elapsed.replace('{{time}}', elapsed)}
        </Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  iconDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 7,
  },
  titleBox: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  phase: {
    fontWeight: '700',
  },
  title: {
    fontWeight: '700',
    lineHeight: 20,
  },
  collapseButton: {
    margin: -8,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '700',
    opacity: 0.82,
  },
});
