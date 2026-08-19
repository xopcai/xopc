import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { actOnTask, fetchTask } from '../../query/tasks';
import { queryKeys } from '../../query/keys';
import { radii, spacing, typography, useTheme } from '../../theme';

const TERMINAL_TASK_STATUSES = new Set(['completed', 'cancelled']);
const RESUMABLE_TASK_STATUSES = new Set(['paused', 'needs_user', 'blocked']);

export function TaskDetailScreen() {
  const router = useRouter();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const hm = useMessages().homePage;
  const query = useQuery({
    queryKey: queryKeys.task(id),
    queryFn: () => fetchTask(id),
    enabled: Boolean(id),
  });
  const action = useMutation({
    mutationFn: (value: 'run' | 'pause' | 'resume' | 'cancel') => actOnTask(
      id,
      value,
      query.data?.task.updatedAt ?? 0,
      value === 'run' || value === 'resume'
        ? query.data?.task.contract?.approvalRequired
        : undefined,
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.task(id) }),
  });

  const statusLabels = {
    pending: hm.taskStatusPending,
    planning: hm.taskStatusPlanning,
    waiting_dependency: hm.taskStatusWaitingDependency,
    running: hm.taskStatusRunning,
    verifying: hm.taskStatusVerifying,
    needs_user: hm.taskStatusNeedsYou,
    blocked: hm.taskStatusBlocked,
    paused: hm.taskStatusPaused,
    completed: hm.taskStatusCompleted,
    cancelled: hm.taskStatusCancelled,
  } as const;
  const statusLabel = query.data ? statusLabels[query.data.task.status] : '';
  const verificationLabels = {
    passed: hm.verificationPassed,
    failed: hm.verificationFailed,
    unverified: hm.verificationPending,
  } as const;

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={query.data?.task.objective ?? ''} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        {query.isLoading ? <ListSkeleton count={3} /> : query.isError || !query.data ? (
          <Text style={[styles.empty, { color: colors.semantic.error }]}>{hm.taskLoadFailed}</Text>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
              <Text style={[styles.eyebrow, { color: colors.accent.primary }]}>{statusLabel}</Text>
              <Text style={[styles.title, { color: colors.text.primary }]}>{query.data.task.objective}</Text>
              {!TERMINAL_TASK_STATUSES.has(query.data.task.status) ? (
                <View style={styles.actions}>
                  {RESUMABLE_TASK_STATUSES.has(query.data.task.status) ? (
                    <Button mode="contained" disabled={action.isPending} onPress={() => action.mutate('resume')}>
                      {hm.taskResume}
                    </Button>
                  ) : query.data.task.status === 'pending' ? (
                    <Button mode="contained" disabled={action.isPending} onPress={() => action.mutate('run')}>
                      {hm.taskRun}
                    </Button>
                  ) : query.data.task.status !== 'waiting_dependency' ? (
                    <Button mode="outlined" disabled={action.isPending} onPress={() => action.mutate('pause')}>
                      {hm.taskPause}
                    </Button>
                  ) : null}
                  <Button mode="text" disabled={action.isPending} onPress={() => action.mutate('cancel')}>
                    {hm.taskCancel}
                  </Button>
                </View>
              ) : null}
              {action.isError ? <Text style={[styles.meta, { color: colors.semantic.error }]}>{hm.taskActionFailed}</Text> : null}
              {query.data.nextCheckAt ? <Text style={[styles.meta, { color: colors.accent.primary }]}>{hm.taskNextCheck}: {new Date(query.data.nextCheckAt).toLocaleString()}</Text> : null}
            </View>

            {query.data.dependencies.length > 0 || query.data.dependents.length > 0 ? (
              <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
                <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{hm.taskRelations}</Text>
                {query.data.dependencies.length > 0 ? <Text style={[styles.subheading, { color: colors.text.secondary }]}>{hm.taskDependencies}</Text> : null}
                {query.data.dependencies.map((dependency) => (
                  <Text key={dependency.id} onPress={() => router.push(`/tasks/${dependency.id}`)} style={[styles.body, { color: colors.accent.primary }]}>• {dependency.objective} · {statusLabels[dependency.status]}</Text>
                ))}
                {query.data.dependents.length > 0 ? <Text style={[styles.subheading, { color: colors.text.secondary }]}>{hm.taskDependents}</Text> : null}
                {query.data.dependents.map((dependent) => (
                  <Text key={dependent.id} onPress={() => router.push(`/tasks/${dependent.id}`)} style={[styles.body, { color: colors.accent.primary }]}>• {dependent.objective} · {statusLabels[dependent.status]}</Text>
                ))}
              </View>
            ) : null}

            {query.data.progress ? (
              <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
                <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{hm.taskCurrentPlan} · {query.data.progress.completed}/{query.data.progress.total}</Text>
                {query.data.progress.items.map((item) => (
                  <View key={item.id} style={styles.row}>
                    <Icon source={item.status === 'completed' ? 'check-circle' : item.status === 'in_progress' ? 'progress-clock' : 'circle-outline'} size={18} color={item.status === 'completed' ? colors.semantic.success : colors.accent.primary} />
                    <Text style={[styles.body, styles.rowText, { color: colors.text.primary }]}>{item.title}</Text>
                  </View>
                ))}
                {query.data.attention ? <Text style={[styles.body, { color: colors.semantic.warning }]}>{query.data.attention.summary}</Text> : null}
              </View>
            ) : query.data.attention ? (
              <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
                <Text style={[styles.body, { color: colors.semantic.warning }]}>{query.data.attention.summary}</Text>
              </View>
            ) : null}

            <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
              <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{hm.taskDefinition}</Text>
              {(query.data.task.contract?.acceptanceCriteria.length ?? 0) === 0 ? (
                <Text style={[styles.body, { color: colors.text.secondary }]}>{hm.taskDefinitionPending}</Text>
              ) : query.data.task.contract?.acceptanceCriteria.map((criterion) => (
                <View key={criterion} style={styles.row}>
                  <Icon source="check-circle-outline" size={18} color={colors.semantic.success} />
                  <Text style={[styles.body, styles.rowText, { color: colors.text.primary }]}>{criterion}</Text>
                </View>
              ))}
              {(query.data.task.contract?.expectedOutputs.length ?? 0) > 0 ? (
                <>
                  <Text style={[styles.subheading, { color: colors.text.secondary }]}>{hm.taskExpectedOutputs}</Text>
                  {query.data.task.contract?.expectedOutputs.map((expectedOutput) => (
                    <Text key={expectedOutput} style={[styles.body, { color: colors.text.primary }]}>• {expectedOutput}</Text>
                  ))}
                </>
              ) : null}
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
              <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{hm.taskReceipts}</Text>
              {query.data.receipts.length === 0 ? (
                <Text style={[styles.body, { color: colors.text.secondary }]}>{hm.taskReceiptsEmpty}</Text>
              ) : query.data.receipts.map((receipt) => (
                <View key={receipt.runId} style={[styles.receipt, { borderColor: colors.border.subtle }]}>
                  <Text style={[styles.body, { color: colors.text.primary }]}>{receipt.summary}</Text>
                  <Text style={[styles.meta, { color: colors.text.tertiary }]}>{verificationLabels[receipt.verification.status]}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  eyebrow: { ...typography.micro },
  title: { ...typography.title },
  sectionTitle: { ...typography.heading, marginBottom: spacing.xs },
  subheading: { ...typography.label, marginTop: spacing.sm },
  body: { ...typography.body },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowText: { flex: 1 },
  receipt: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md, marginTop: spacing.xs, gap: spacing.xs },
  meta: { ...typography.caption },
  empty: { ...typography.body, padding: spacing.lg, textAlign: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
});
