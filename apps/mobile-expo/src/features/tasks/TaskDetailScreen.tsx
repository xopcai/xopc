import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { fetchChatAgents } from '../../query/agents';
import { queryKeys } from '../../query/keys';
import { fetchProjects } from '../../query/projects';
import { commandTask, fetchTask, TaskApiError } from '../../query/tasks';
import { radii, spacing, typography, useTheme } from '../../theme';
import { resolveTaskAgentId } from './task-create-input';

export function TaskDetailScreen() {
  const router = useRouter();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { homePage: hm, tasksPage: labels } = useMessages();
  const query = useQuery({
    queryKey: queryKeys.task(id),
    queryFn: () => fetchTask(id),
    enabled: Boolean(id),
  });
  const agents = useQuery({ queryKey: queryKeys.agents, queryFn: fetchChatAgents });
  const projects = useQuery({ queryKey: queryKeys.projects, queryFn: fetchProjects });
  const invalidateTaskViews = async () => {
    const projectId = query.data?.task.projectId;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.task(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      ...(projectId
        ? [queryClient.invalidateQueries({ queryKey: queryKeys.projectOperatingView(projectId) })]
        : []),
    ]);
  };
  const command = useMutation({
    mutationFn: (value: import('@xopcai/gateway-contract').TaskCommand) => commandTask(
      id, value, query.data?.task.version ?? 0,
    ),
    onSettled: invalidateTaskViews,
  });

  let executorAgentId = '';
  if (agents.data && query.data) {
    try {
      executorAgentId = resolveTaskAgentId({
        agents: agents.data,
        project: projects.data?.find((project) => project.id === query.data?.task.projectId),
        selectedAgentId: query.data.task.delegateAgentId,
      });
    } catch {
      executorAgentId = '';
    }
  }

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
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}>
        {query.isLoading ? <ListSkeleton count={3} /> : query.isError || !query.data ? (
          <View style={styles.emptyState}>
            <Text style={[styles.empty, { color: colors.semantic.error }]}>{hm.taskLoadFailed}</Text>
            <Button onPress={() => void query.refetch()}>{labels.retry}</Button>
          </View>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
              <Text style={[styles.eyebrow, { color: colors.accent.primary }]}>{phaseLabel} · {query.data.operationalState}</Text>
              <Text style={[styles.title, { color: colors.text.primary }]}>{query.data.task.title}</Text>
              {query.data.task.body ? <Text style={[styles.body, { color: colors.text.secondary }]}>{query.data.task.body}</Text> : null}
              {query.data.task.phase !== 'closed' ? (
                <View style={styles.actions}>
                  {query.data.waits.length > 0 && query.data.allowedCommands.includes('resolve_wait') ? (
                    <Button mode="contained" disabled={command.isPending} onPress={() => command.mutate({ type: 'resolve_wait', waitId: query.data!.waits[0]!.id })}>
                      {hm.taskResume}
                    </Button>
                  ) : query.data.allowedCommands.includes('start') && executorAgentId ? (
                    <Button mode="contained" disabled={command.isPending} onPress={() => command.mutate({ type: 'start', executor: { kind: 'agent', agentId: executorAgentId } })}>
                      {hm.taskRun}
                    </Button>
                  ) : query.data.allowedCommands.includes('add_wait') ? (
                    <Button mode="outlined" disabled={command.isPending} onPress={() => command.mutate({ type: 'add_wait', wait: { kind: 'paused', reason: hm.taskPauseReason, condition: {} } })}>
                      {hm.taskPause}
                    </Button>
                  ) : null}
                  {query.data.allowedCommands.includes('close') ? (
                    <Button mode="text" disabled={command.isPending} onPress={() => command.mutate({ type: 'close', resolution: 'cancelled' })}>
                      {hm.taskCancel}
                    </Button>
                  ) : null}
                </View>
              ) : null}
              {query.data.allowedCommands.includes('start') && !executorAgentId && !agents.isLoading ? (
                <Text style={[styles.meta, { color: colors.semantic.error }]}>{labels.agentUnavailable}</Text>
              ) : null}
              {command.isError ? (
                <Text style={[styles.meta, { color: colors.semantic.error }]}>
                  {command.error instanceof TaskApiError && command.error.status === 409
                    ? hm.taskChangedRetry
                    : hm.taskActionFailed}
                </Text>
              ) : null}
              {query.data.task.dueAt ? <Text style={[styles.meta, { color: colors.accent.primary }]}>{hm.taskNextCheck}: {new Date(query.data.task.dueAt).toLocaleString()}</Text> : null}
            </View>

            {query.data.dependencies.length > 0 || query.data.dependents.length > 0 ? (
              <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
                <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{hm.taskRelations}</Text>
                {query.data.dependencies.length > 0 ? <Text style={[styles.subheading, { color: colors.text.secondary }]}>{hm.taskDependencies}</Text> : null}
                {query.data.dependencies.map((dependency) => (
                  <Pressable accessibilityRole="button" accessibilityLabel={dependency.title} key={dependency.id} onPress={() => router.push(`/tasks/${dependency.id}`)} style={styles.relationRow}>
                    <Text style={[styles.body, { color: colors.accent.primary }]}>• {dependency.title} · {phaseLabels[dependency.phase]}</Text>
                  </Pressable>
                ))}
                {query.data.dependents.length > 0 ? <Text style={[styles.subheading, { color: colors.text.secondary }]}>{hm.taskDependents}</Text> : null}
                {query.data.dependents.map((dependent) => (
                  <Pressable accessibilityRole="button" accessibilityLabel={dependent.title} key={dependent.id} onPress={() => router.push(`/tasks/${dependent.id}`)} style={styles.relationRow}>
                    <Text style={[styles.body, { color: colors.accent.primary }]}>• {dependent.title} · {phaseLabels[dependent.phase]}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {query.data.attention.length > 0 ? (
              <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
                <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{hm.taskCurrentPlan}</Text>
                {query.data.attention.map((item, index) => <Text key={`${item.kind}-${index}`} style={[styles.body, { color: colors.semantic.warning }]}>{item.summary}</Text>)}
              </View>
            ) : null}

            {query.data.context.length > 0 ? (
              <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
                <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.context}</Text>
                {query.data.context.map((edge) => (
                  <View key={edge.id} style={styles.row}>
                    <Icon source="link-variant" size={18} color={colors.text.tertiary} />
                    <View style={styles.rowText}>
                      <Text style={[styles.body, { color: colors.text.primary }]}>{edge.title ?? edge.targetId}</Text>
                      <Text style={[styles.meta, { color: colors.text.tertiary }]}>{edge.role} · {edge.targetKind}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {query.data.runs.length > 0 ? (
              <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
                <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.runs}</Text>
                {query.data.runs.map((run) => (
                  <View key={run.id} style={[styles.receipt, { borderColor: colors.border.subtle }]}>
                    <Text style={[styles.body, { color: colors.text.primary }]}>{run.executorKind} · {run.status}</Text>
                    <Text style={[styles.meta, { color: colors.text.tertiary }]}>#{run.attempt} · {new Date(run.startedAt ?? run.queuedAt).toLocaleString()}</Text>
                  </View>
                ))}
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
                  {receipt.needsUser ? <Text style={[styles.meta, { color: colors.semantic.warning }]}>{labels.needsYou}</Text> : null}
                  {receipt.evidence.length > 0 ? (
                    <>
                      <Text style={[styles.subheading, { color: colors.text.secondary }]}>{labels.evidence}</Text>
                      {receipt.evidence.map((evidence) => <Text key={`${evidence.kind}:${evidence.title}`} style={[styles.meta, { color: colors.text.secondary }]}>• {evidence.title}: {evidence.summary}</Text>)}
                    </>
                  ) : null}
                  {receipt.remainingWork.length > 0 ? (
                    <>
                      <Text style={[styles.subheading, { color: colors.text.secondary }]}>{labels.remainingWork}</Text>
                      {receipt.remainingWork.map((item) => <Text key={item} style={[styles.meta, { color: colors.text.secondary }]}>• {item}</Text>)}
                    </>
                  ) : null}
                  {receipt.failure ? <Text style={[styles.meta, { color: colors.semantic.error }]}>{receipt.failure.recoveryAction}</Text> : null}
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
  relationRow: { minHeight: 44, justifyContent: 'center' },
  receipt: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md, marginTop: spacing.xs, gap: spacing.xs },
  meta: { ...typography.caption },
  empty: { ...typography.body, padding: spacing.lg, textAlign: 'center' },
  emptyState: { alignItems: 'center', padding: spacing.lg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
});
