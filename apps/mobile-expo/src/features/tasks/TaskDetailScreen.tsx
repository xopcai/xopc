import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { openChat } from '../../lib/navigation';
import { fetchChatAgents } from '../../query/agents';
import { queryKeys } from '../../query/keys';
import { fetchProjects } from '../../query/projects';
import { commandTask, ensureTaskConversation, fetchTask, TaskApiError } from '../../query/tasks';
import { radii, spacing, typography, useTheme } from '../../theme';

export function TaskDetailScreen() {
  const router = useRouter();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { homePage: hm, tasksPage: labels } = useMessages();
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const query = useQuery({ queryKey: queryKeys.task(id), queryFn: () => fetchTask(id), enabled: Boolean(id) });
  const agents = useQuery({ queryKey: queryKeys.agents, queryFn: fetchChatAgents });
  const projects = useQuery({ queryKey: queryKeys.projects, queryFn: fetchProjects });
  const conversation = useQuery({
    queryKey: queryKeys.taskConversation(id),
    queryFn: () => ensureTaskConversation(id),
    enabled: Boolean(id && query.data && !query.data.conversation.activeSessionKey),
    retry: 1,
  });

  const invalidateTaskViews = async () => {
    const projectId = query.data?.task.projectId;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.task(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      ...(projectId ? [queryClient.invalidateQueries({ queryKey: queryKeys.projectOperatingView(projectId) })] : []),
    ]);
  };
  const command = useMutation({
    mutationFn: (value: import('@xopcai/gateway-contract').TaskCommand) => commandTask(id, value, query.data?.task.version ?? 0),
    onSettled: invalidateTaskViews,
  });

  const detail = query.data;
  const sessionKey = detail?.conversation.activeSessionKey ?? conversation.data?.sessionKey;
  const executorAgentId = detail?.conversation.currentExecutorAgentId ?? conversation.data?.agentId ?? detail?.task.delegateAgentId;
  const executor = agents.data?.items.find((agent) => agent.id === executorAgentId);
  const project = projects.data?.find((item) => item.id === detail?.task.projectId);
  const activeWait = detail?.waits.find((wait) => wait.status === 'active');
  const waitingForUser = activeWait?.kind === 'user_input' || activeWait?.kind === 'approval';
  const phaseLabels = {
    backlog: hm.taskStatusPending,
    ready: hm.taskStatusPlanning,
    active: hm.taskStatusRunning,
    review: hm.taskStatusVerifying,
    closed: hm.taskStatusCompleted,
  } as const;
  const verificationLabels = {
    passed: hm.verificationPassed,
    failed: hm.verificationFailed,
    unverified: hm.verificationPending,
  } as const;
  const openTaskChat = () => {
    if (sessionKey) openChat(router, sessionKey, { taskId: id });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={labels.detailTitle} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}>
        {query.isLoading ? <ListSkeleton count={4} /> : query.isError || !detail ? (
          <View style={styles.emptyState}>
            <Icon source="cloud-alert-outline" size={36} color={colors.semantic.error} />
            <Text style={[styles.empty, { color: colors.text.secondary }]}>{hm.taskLoadFailed}</Text>
            <Button onPress={() => void query.refetch()}>{labels.retry}</Button>
          </View>
        ) : (
          <>
            <View style={styles.hero}>
              <View style={styles.statusLine}>
                <View style={[styles.statusDot, { backgroundColor: detail.attention.length ? colors.semantic.warning : colors.accent.primary }]} />
                <Text style={[styles.eyebrow, { color: detail.attention.length ? colors.semantic.warning : colors.text.secondary }]}>{phaseLabels[detail.task.phase]}</Text>
              </View>
              <Text style={[styles.title, { color: colors.text.primary }]}>{detail.task.title}</Text>
              {detail.task.body ? <Text style={[styles.body, { color: colors.text.secondary }]}>{detail.task.body}</Text> : null}
              <View style={styles.metadata}>
                {project ? <MetaItem icon="folder-outline" label={project.name} /> : null}
                {executorAgentId ? <MetaItem icon="account-outline" label={executor?.name ?? executorAgentId} /> : null}
                {detail.task.dueAt ? <MetaItem icon="calendar-outline" label={new Date(detail.task.dueAt).toLocaleString()} /> : null}
              </View>
            </View>

            {detail.attention.length ? (
              <View style={[styles.attention, { backgroundColor: colors.accent.soft, borderColor: colors.border.subtle }]}>
                <Icon source="alert-circle-outline" size={20} color={colors.semantic.warning} />
                <View style={styles.flex}>
                  <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.needsAttention}</Text>
                  {detail.attention.map((item, index) => <Text key={`${item.kind}-${index}`} style={[styles.body, { color: colors.text.secondary }]}>{item.summary}</Text>)}
                </View>
              </View>
            ) : null}

            <View style={[styles.agentPanel, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
              <View style={styles.agentHeading}>
                <View style={[styles.agentIcon, { backgroundColor: colors.accent.soft }]}><Icon source="message-processing-outline" size={22} color={colors.accent.primary} /></View>
                <View style={styles.flex}>
                  <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.agentConversation}</Text>
                  <Text style={[styles.meta, { color: colors.text.secondary }]}>
                    {conversation.isFetching && !sessionKey ? labels.conversationCreating : executor?.name ?? executorAgentId ?? labels.automaticAgent}
                  </Text>
                </View>
              </View>
              {conversation.isError && !sessionKey ? (
                <View style={styles.inlineError}>
                  <Text style={[styles.meta, styles.flex, { color: colors.semantic.error }]}>{labels.conversationFailed}</Text>
                  <Button compact onPress={() => void conversation.refetch()}>{labels.retry}</Button>
                </View>
              ) : null}
              <View style={styles.actions}>
                {waitingForUser && sessionKey ? (
                  <Button mode="contained" icon="message-reply-outline" onPress={openTaskChat}>{hm.taskContinueInChat}</Button>
                ) : !activeWait && detail.allowedCommands.includes('start') && executorAgentId ? (
                  <Button mode="contained" icon="play" disabled={command.isPending} loading={command.isPending && command.variables?.type === 'start'} onPress={() => command.mutate({ type: 'start', executor: { kind: 'agent', agentId: executorAgentId } })}>{hm.taskRun}</Button>
                ) : sessionKey ? (
                  <Button mode="contained" icon="message-outline" onPress={openTaskChat}>{labels.openConversation}</Button>
                ) : conversation.isError ? null : (
                  <Button mode="contained" disabled loading={conversation.isFetching}>{labels.conversationCreating}</Button>
                )}
                {sessionKey && !waitingForUser && detail.allowedCommands.includes('start') ? <Button mode="outlined" icon="message-outline" onPress={openTaskChat}>{labels.openConversation}</Button> : null}
                {activeWait && !waitingForUser && detail.allowedCommands.includes('resolve_wait') ? (
                  <Button mode="outlined" disabled={command.isPending} onPress={() => command.mutate({ type: 'resolve_wait', waitId: activeWait.id })}>{hm.taskResume}</Button>
                ) : detail.allowedCommands.includes('add_wait') ? (
                  <Button mode="outlined" disabled={command.isPending} onPress={() => command.mutate({ type: 'add_wait', wait: { kind: 'paused', reason: hm.taskPauseReason, condition: {} } })}>{hm.taskPause}</Button>
                ) : null}
              </View>
              {command.isError ? <Text style={[styles.meta, { color: colors.semantic.error }]}>{command.error instanceof TaskApiError && command.error.status === 409 ? hm.taskChangedRetry : hm.taskActionFailed}</Text> : null}
              {waitingForUser && !sessionKey ? <Text style={[styles.meta, { color: colors.semantic.warning }]}>{activeWait?.reason}</Text> : null}
            </View>

            <Section title={hm.taskDefinition}>
              {(detail.task.contract?.acceptanceCriteria.length ?? 0) === 0 ? <Text style={[styles.body, { color: colors.text.secondary }]}>{hm.taskDefinitionPending}</Text> : detail.task.contract?.acceptanceCriteria.map((criterion) => (
                <View key={criterion} style={styles.row}><Icon source="check-circle-outline" size={18} color={colors.semantic.success} /><Text style={[styles.body, styles.flex, { color: colors.text.primary }]}>{criterion}</Text></View>
              ))}
              {(detail.task.contract?.expectedOutputs.length ?? 0) > 0 ? (
                <View style={styles.subsection}><Text style={[styles.subheading, { color: colors.text.secondary }]}>{hm.taskExpectedOutputs}</Text>{detail.task.contract?.expectedOutputs.map((output) => <Text key={output} style={[styles.body, { color: colors.text.primary }]}>• {output}</Text>)}</View>
              ) : null}
            </Section>

            <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsExpanded }} onPress={() => setDetailsExpanded((value) => !value)} style={({ pressed }) => [styles.disclosure, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel }]}>
              <View style={styles.flex}><Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.taskDetails}</Text><Text style={[styles.meta, { color: colors.text.tertiary }]}>{labels.taskDetailsHint}</Text></View>
              <Icon source={detailsExpanded ? 'chevron-up' : 'chevron-down'} size={22} color={colors.text.tertiary} />
            </Pressable>

            {detailsExpanded ? (
              <View style={styles.details}>
                {detail.dependencies.length || detail.dependents.length ? (
                  <Section title={hm.taskRelations}>
                    {detail.dependencies.map((item) => <RelationRow key={`dependency:${item.id}`} title={item.title} phase={phaseLabels[item.phase]} onPress={() => router.push(`/tasks/${item.id}`)} />)}
                    {detail.dependents.map((item) => <RelationRow key={`dependent:${item.id}`} title={item.title} phase={phaseLabels[item.phase]} onPress={() => router.push(`/tasks/${item.id}`)} />)}
                  </Section>
                ) : null}
                {detail.context.length ? (
                  <Section title={labels.context}>{detail.context.map((edge) => <View key={edge.id} style={styles.row}><Icon source="link-variant" size={18} color={colors.text.tertiary} /><View style={styles.flex}><Text style={[styles.body, { color: colors.text.primary }]}>{edge.title ?? edge.targetId}</Text><Text style={[styles.meta, { color: colors.text.tertiary }]}>{edge.role} · {edge.targetKind}</Text></View></View>)}</Section>
                ) : null}
                {detail.runs.length ? (
                  <Section title={labels.runs}>{detail.runs.map((run) => <View key={run.id} style={[styles.detailRow, { borderBottomColor: colors.border.subtle }]}><Text style={[styles.body, { color: colors.text.primary }]}>{run.executorKind} · {run.status}</Text><Text style={[styles.meta, { color: colors.text.tertiary }]}>#{run.attempt} · {new Date(run.startedAt ?? run.queuedAt).toLocaleString()}</Text></View>)}</Section>
                ) : null}
                <Section title={hm.taskReceipts}>
                  {detail.receipts.length === 0 ? <Text style={[styles.body, { color: colors.text.secondary }]}>{hm.taskReceiptsEmpty}</Text> : detail.receipts.map((receipt) => <View key={receipt.runId} style={[styles.detailRow, { borderBottomColor: colors.border.subtle }]}><Text style={[styles.body, { color: colors.text.primary }]}>{receipt.summary}</Text><Text style={[styles.meta, { color: colors.text.tertiary }]}>{verificationLabels[receipt.verification.status]}</Text>{receipt.failure ? <Text style={[styles.meta, { color: colors.semantic.error }]}>{receipt.failure.recoveryAction}</Text> : null}</View>)}
                </Section>
                {detail.allowedCommands.includes('close') ? <Button mode="text" textColor={colors.semantic.error} disabled={command.isPending} onPress={() => command.mutate({ type: 'close', resolution: 'cancelled' })}>{hm.taskCancel}</Button> : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function MetaItem({ icon, label }: { icon: string; label: string }) {
  const { colors } = useTheme();
  return <View style={styles.metaItem}><Icon source={icon} size={16} color={colors.text.tertiary} /><Text numberOfLines={1} style={[styles.meta, { color: colors.text.secondary }]}>{label}</Text></View>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={styles.section}><Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{title}</Text><View style={styles.sectionBody}>{children}</View></View>;
}

function RelationRow({ title, phase, onPress }: { title: string; phase: string; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.relationRow, pressed && { backgroundColor: colors.surface.pressed }]}><View style={styles.flex}><Text style={[styles.body, { color: colors.text.primary }]}>{title}</Text><Text style={[styles.meta, { color: colors.text.tertiary }]}>{phase}</Text></View><Icon source="chevron-right" size={18} color={colors.text.tertiary} /></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.content, paddingTop: spacing.lg, gap: spacing.section, paddingBottom: spacing.xxl },
  hero: { gap: spacing.sm },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: spacing.sm, height: spacing.sm, borderRadius: radii.full },
  eyebrow: { ...typography.label, fontWeight: '600' },
  title: { ...typography.title },
  body: { ...typography.body },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs },
  metaItem: { maxWidth: '100%', minHeight: spacing.xl, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  meta: { ...typography.caption },
  attention: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md },
  agentPanel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, gap: spacing.md, padding: spacing.lg },
  agentHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  agentIcon: { width: spacing.xxl, height: spacing.xxl, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  inlineError: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { gap: spacing.md },
  sectionTitle: { ...typography.heading },
  sectionBody: { gap: spacing.md },
  subsection: { gap: spacing.sm, marginTop: spacing.xs },
  subheading: { ...typography.label, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  disclosure: { minHeight: 64, borderRadius: radii.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  details: { gap: spacing.section },
  relationRow: { minHeight: 52, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
  detailRow: { borderBottomWidth: StyleSheet.hairlineWidth, gap: spacing.xs, paddingBottom: spacing.md },
  empty: { ...typography.body, textAlign: 'center' },
  emptyState: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
});
