import { useQuery, useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from 'react-native-paper';

import {
  fetchWebchatGoal,
  postWebchatChecklistMutation,
  postWebchatGoalAction,
  type ChecklistMutationOp,
  type GoalWebchatAction,
} from '../../query/goals';
import { queryKeys } from '../../query/keys';
import { useMessages } from '../../i18n/messages';
import { usePreferencesStore } from '../../stores/preferences-store';
import { useTheme } from '../../theme';
import { GoalActionsBar } from './GoalActionsBar';
import { GoalChecklistBoard } from './GoalChecklistBoard';
import { GoalJudgementSummary } from './GoalJudgementSummary';
import { GoalLatestRun } from './GoalLatestRun';
import { GoalMissionHeader } from './GoalMissionHeader';
import { GoalProgressMeter } from './GoalProgressMeter';
import { goalUiPhase, goalMissionExpandedMaxHeight, shouldShowGoal } from './goal-utils';

type Props = {
  sessionKey: string;
  agentBusy: boolean;
};

export const GoalMissionCard = memo(function GoalMissionCard({ sessionKey, agentBusy }: Props) {
  const { height: windowHeight } = useWindowDimensions();
  const expandedMaxHeight = useMemo(
    () => goalMissionExpandedMaxHeight(windowHeight),
    [windowHeight],
  );
  const queryClient = useQueryClient();
  const m = useMessages();
  const { colors } = useTheme();
  const t = m.chat.goal;
  const language = usePreferencesStore((s) => s.language);
  const [collapsed, setCollapsed] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goalQuery = useQuery({
    queryKey: queryKeys.webchatGoal(sessionKey),
    queryFn: () => fetchWebchatGoal(sessionKey, { uiLocale: language }),
    enabled: Boolean(sessionKey),
    refetchInterval: agentBusy ? 2_500 : false,
  });

  const refreshGoal = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.webchatGoal(sessionKey) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.webchatGoalRuns(sessionKey, 1) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessionHistory(sessionKey) });
  }, [queryClient, sessionKey]);

  const runAction = useCallback(async (action: GoalWebchatAction) => {
    setMutationBusy(true);
    setError(null);
    try {
      await postWebchatGoalAction(sessionKey, action, { uiLocale: language });
      refreshGoal();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.actionFailed);
    } finally {
      setMutationBusy(false);
    }
  }, [language, refreshGoal, sessionKey, t.actionFailed]);

  const runChecklistMutation = useCallback(async (mutation: ChecklistMutationOp) => {
    setMutationBusy(true);
    setError(null);
    try {
      await postWebchatChecklistMutation(sessionKey, mutation, { uiLocale: language });
      refreshGoal();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.actionFailed);
    } finally {
      setMutationBusy(false);
    }
  }, [language, refreshGoal, sessionKey, t.actionFailed]);

  const goal = goalQuery.data?.persistentGoal ?? null;
  if (goalQuery.isLoading || !shouldShowGoal(goal)) {
    return null;
  }

  const phase = goalUiPhase(goal, agentBusy);
  const canEditChecklist = goal.status === 'active' || goal.status === 'paused';
  const bg = colors.surface.panel;
  const border = colors.border.default;

  return (
    <View style={styles.outer}>
      <View style={[styles.card, { backgroundColor: bg, borderColor: border }]}> 
        <GoalMissionHeader
          goal={goal}
          phase={phase}
          collapsed={collapsed}
          t={t}
          onToggleCollapsed={() => setCollapsed((v) => !v)}
        />

        {!collapsed ? (
          <ScrollView
            style={{ maxHeight: expandedMaxHeight }}
            contentContainerStyle={styles.content}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            <GoalProgressMeter goal={goal} t={t} />
            <GoalJudgementSummary goal={goal} t={t} />
            <GoalChecklistBoard
              goal={goal}
              canEdit={canEditChecklist}
              mutationBusy={mutationBusy}
              t={t}
              onMutate={runChecklistMutation}
            />
            <GoalActionsBar
              goal={goal}
              canEditChecklist={canEditChecklist}
              mutationBusy={mutationBusy}
              t={t}
              onAction={runAction}
              onChecklist={runChecklistMutation}
            />
            <GoalLatestRun sessionKey={sessionKey} t={t} />
          </ScrollView>
        ) : null}

        {error || goalQuery.error ? (
          <Text variant="bodySmall" style={[styles.error, { color: colors.semantic.errorBold }]}>
            {error || (goalQuery.error instanceof Error ? goalQuery.error.message : t.loadFailed)}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  outer: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    zIndex: 1,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    padding: 12,
    gap: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  content: {
    gap: 12,
  },
  error: {
  },
});
