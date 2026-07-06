import { memo, useCallback } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Button } from 'react-native-paper';

import type { ChecklistMutationOp, GoalWebchatAction, WebchatPersistentGoalWire } from '../../query/goals';
import { useTheme } from '../../theme';
import type { GoalMessages } from './goal-utils';

type Props = {
  goal: WebchatPersistentGoalWire;
  canEditChecklist: boolean;
  mutationBusy: boolean;
  t: GoalMessages;
  onAction: (action: GoalWebchatAction) => void | Promise<void>;
  onChecklist: (mutation: ChecklistMutationOp) => void | Promise<void>;
};

export const GoalActionsBar = memo(function GoalActionsBar({
  goal,
  canEditChecklist,
  mutationBusy,
  t,
  onAction,
  onChecklist,
}: Props) {
  const { colors } = useTheme();
  const confirm = useCallback((title: string, message: string, run: () => void) => {
    Alert.alert(title, message, [
      { text: t.cancel, style: 'cancel' },
      { text: t.confirm, style: 'destructive', onPress: run },
    ]);
  }, [t.cancel, t.confirm]);

  return (
    <View style={styles.wrap}>
      <Button
        compact
        mode="contained-tonal"
        disabled={mutationBusy || goal.status !== 'active'}
        onPress={() => void onAction('pause')}
      >
        {t.pause}
      </Button>
      <Button
        compact
        mode="contained-tonal"
        disabled={mutationBusy || (goal.status !== 'paused' && goal.status !== 'done')}
        onPress={() => void onAction('resume')}
      >
        {t.resume}
      </Button>
      <Button
        compact
        mode="outlined"
        disabled={mutationBusy}
        onPress={() => confirm(t.restart, t.restartConfirm, () => void onAction('restart'))}
      >
        {t.restart}
      </Button>
      <Button
        compact
        mode="outlined"
        disabled={mutationBusy || !canEditChecklist}
        onPress={() => confirm(t.resetChecklist, t.resetChecklistConfirm, () => void onChecklist({ op: 'reset' }))}
      >
        {t.resetChecklist}
      </Button>
      <Button
        compact
        mode="text"
        textColor={colors.semantic.errorBold}
        disabled={mutationBusy}
        onPress={() => confirm(t.clear, t.clearConfirm, () => void onAction('clear'))}
      >
        {t.clear}
      </Button>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
});
