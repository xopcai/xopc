import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import type { WebchatPersistentGoalWire } from '../../query/goals';
import { useTheme } from '../../theme';
import { goalChecklistProgress, goalTurnProgress, type GoalMessages } from './goal-utils';

type Props = {
  goal: WebchatPersistentGoalWire;
  t: GoalMessages;
};

function MeterRow({ label, value, percent, accent }: { label: string; value: string; percent: number; accent: string }) {
  const { colors } = useTheme();

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text variant="labelSmall" style={styles.label}>{label}</Text>
        <Text variant="labelSmall" style={styles.value}>{value}</Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.surface.input }]}> 
        <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: accent }]} />
      </View>
    </View>
  );
}

export const GoalProgressMeter = memo(function GoalProgressMeter({ goal, t }: Props) {
  const { colors } = useTheme();
  const turn = goalTurnProgress(goal);
  const checklist = goalChecklistProgress(goal);
  const accent = goal.status === 'paused'
    ? colors.semantic.warning
    : goal.status === 'done'
      ? colors.semantic.success
      : colors.accent.primary;
  const mutedAccent = colors.accent.primaryHover;

  return (
    <View style={styles.wrap}>
      <MeterRow
        label={t.turnProgress}
        value={`${turn.used}/${turn.total}`}
        percent={turn.percent}
        accent={accent}
      />
      {checklist.total > 0 ? (
        <MeterRow
          label={t.checklistProgressTitle}
          value={`${checklist.done}/${checklist.total}`}
          percent={checklist.percent}
          accent={mutedAccent}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  row: {
    gap: 5,
  },
  rowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    opacity: 0.68,
  },
  value: {
    fontWeight: '700',
    opacity: 0.78,
  },
  track: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
});
