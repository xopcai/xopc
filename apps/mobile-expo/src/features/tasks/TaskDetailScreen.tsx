import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { commandTask, fetchTask } from '../../query/tasks';
import { queryKeys } from '../../query/keys';
import { radii, spacing, typography, useTheme } from '../../theme';

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
  const command = useMutation({
    mutationFn: (value: import('@xopcai/gateway-contract').TaskCommand) => commandTask(
      id, value, query.data?.task.version ?? 0,
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.task(id) }),
  });

  const phaseLabels = {
    backlog: hm.taskStatusPending,
    ready: hm.taskStatusPlanning,
    active: hm.taskStatusRunning,
    review: hm.taskStatusVerifying,
    closed: hm.taskStatusCompleted,
  } as const;
  const phaseLabel = query.data ? phaseLabels[query.data.task.phase] : '';
  const verificationLabels = {
    passed: hm.verificationPassed,
    failed: hm.verificationFailed,
    unverified: hm.verificationPending,
  } as const;

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={query.data?.task.title ?? ''} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        {query.isLoading ? <ListSkeleton count={3} /> : query.isError || !query.data ? (
          <Text style={[styles.empty, { color: colors.semantic.error }]}>{hm.taskLoadFailed}</Text>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
              <Text style={[styles.eyebrow, { color: colors.accent.primary }]}>{phaseLabel} · {query.data.operationalState}</Text>
              <Text style={[styles.title, { color: colors.text.primary }]}>{query.data.task.title}</Text>
              {query.data.task.body ? <Text style={[styles.body, { color: colors.text.secondary }]}>{query.data.task.body}</Text> : null}
              {query.data.task.phase !== 'closed' ? (
                <View style={styles.actions}>
                  {query.data.waits.length > 0 ? (
                    <Button mode="contained" disabled={command.isPending} onPress={() => command.mutate({ type: 'resolve_wait', waitId: query.data!.waits[0]!.id })}>
                      {hm.taskResume}
                    </Button>
                  ) : query.data.allowedCommands.includes('start') ? (
                    <Button mode="contained" disabled={command.isPending} onPress={() => command.mutate({ type: 'start', executor: { kind: 'agent', agentId: query.data!.task.delegateAgentId ?? 'main' } })}>
                      {hm.taskRun}
                    </Button>
                  ) : query.data.allowedCommands.includes('add_wait') ? (
                    <Button mode="outlined" disabled={command.isPending} onPress={() => command.mutate({ type: 'add_wait', wait: { kind: 'paused', reason: 'Paused by user', condition: {} } })}>
                      {hm.taskPause}
                    </Button>
                  ) : null}
                  <Button mode="text" disabled={command.isPending} onPress={() => command.mutate({ type: 'close', resolution: 'cancelled' })}>
                    {hm.taskCancel}
                  </Button>
                </View>
              ) : null}
              {command.isError ? <Text style={[styles.meta, { color: colors.semantic.error }]}>{hm.taskActionFailed}</Text> : null}
              {query.data.task.dueAt ? <Text style={[styles.meta, { color: colors.accent.primary }]}>{hm.taskNextCheck}: {new Date(query.data.task.dueAt).toLocaleString()}</Text> : null}
            </View>

            {query.data.dependencies.length > 0 || query.data.dependents.length > 0 ? (
              <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
                <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{hm.taskRelations}</Text>
                {query.data.dependencies.length > 0 ? <Text style={[styles.subheading, { color: colors.text.secondary }]}>{hm.taskDependencies}</Text> : null}
                {query.data.dependencies.map((dependency) => (
                  <Text key={dependency.id} onPress={() => router.push(`/tasks/${dependency.id}`)} style={[styles.body, { color: colors.accent.primary }]}>• {dependency.title} · {phaseLabels[dependency.phase]}</Text>
                ))}
                {query.data.dependents.length > 0 ? <Text style={[styles.subheading, { color: colors.text.secondary }]}>{hm.taskDependents}</Text> : null}
                {query.data.dependents.map((dependent) => (
                  <Text key={dependent.id} onPress={() => router.push(`/tasks/${dependent.id}`)} style={[styles.body, { color: colors.accent.primary }]}>• {dependent.title} · {phaseLabels[dependent.phase]}</Text>
                ))}
              </View>
            ) : null}

            {query.data.attention.length > 0 ? (
              <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
                <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{hm.taskCurrentPlan}</Text>
                {query.data.attention.map((item, index) => <Text key={`${item.kind}-${index}`} style={[styles.body, { color: colors.semantic.warning }]}>{item.summary}</Text>)}
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
