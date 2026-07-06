import { useQuery } from '@tanstack/react-query';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { fetchWebchatGoalRuns } from '../../query/goals';
import { queryKeys } from '../../query/keys';
import { useTheme } from '../../theme';
import { runVerdictLabel, type GoalMessages } from './goal-utils';

type Props = {
  sessionKey: string;
  t: GoalMessages;
};

export const GoalLatestRun = memo(function GoalLatestRun({ sessionKey, t }: Props) {
  const { colors } = useTheme();
  const q = useQuery({
    queryKey: queryKeys.webchatGoalRuns(sessionKey, 1),
    queryFn: () => fetchWebchatGoalRuns(sessionKey, { limit: 1 }),
    enabled: Boolean(sessionKey),
    staleTime: 5_000,
  });
  const run = q.data?.runs?.[0];
  if (!run) return null;

  const panelBg = colors.surface.input;
  const verdict = runVerdictLabel(run.verdict, t);
  const checklist = run.checklistProgress;

  return (
    <View style={[styles.wrap, { backgroundColor: panelBg }]}> 
      <View style={styles.head}>
        <Text variant="labelMedium" style={styles.title}>{t.latestRunTitle}</Text>
        <Text style={[styles.verdict, { backgroundColor: colors.surface.input, color: colors.semantic.success }]}>
          {verdict}
        </Text>
      </View>
      {run.reason ? (
        <Text variant="bodySmall" style={styles.reason} numberOfLines={3}>
          {run.reason}
        </Text>
      ) : null}
      <View style={styles.metaRow}>
        <Text style={[styles.meta, { backgroundColor: colors.accent.selectionBg, color: colors.accent.primary }]}>
          {run.willContinue ? t.nextStepContinue : t.nextStepStop}
        </Text>
        <Text style={[styles.meta, { backgroundColor: colors.accent.selectionBg, color: colors.accent.primary }]}>
          {`${run.turnsUsed}/${run.maxTurns}`}
        </Text>
        {checklist ? (
          <Text style={[styles.meta, { backgroundColor: colors.accent.selectionBg, color: colors.accent.primary }]}>
            {`${checklist.done}/${checklist.total}`}
          </Text>
        ) : null}
      </View>
      {run.assistantPreview ? (
        <Text variant="bodySmall" style={styles.preview} numberOfLines={2}>
          {run.assistantPreview}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 14,
    padding: 10,
    gap: 7,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: {
    fontWeight: '800',
  },
  verdict: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '900',
  },
  reason: {
    opacity: 0.72,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  meta: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '800',
  },
  preview: {
    opacity: 0.58,
    lineHeight: 18,
  },
});
