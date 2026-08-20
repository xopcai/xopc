import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { dismissOrHome } from '../../lib/navigation';
import { fetchChatAgents } from '../../query/agents';
import { queryKeys } from '../../query/keys';
import { fetchProjects } from '../../query/projects';
import { cancelWorkflowRun, fetchWorkflowRun, fetchWorkflowRuns } from '../../query/workflows';
import { radii, spacing, typography, useTheme } from '../../theme';
import { resolveTaskAgentId } from '../tasks/task-create-input';

const activeStatuses = new Set(['queued', 'running']);

export function WorkflowRunsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const labels = useMessages().workflowsPage;
  const agents = useQuery({ queryKey: queryKeys.agents, queryFn: fetchChatAgents });
  const query = useQuery({
    queryKey: queryKeys.workflowRuns,
    queryFn: () => fetchWorkflowRuns(agents.data?.items.map((agent) => agent.id) ?? []),
    enabled: Boolean(agents.data),
    refetchInterval: ({ state }) => state.data?.some((run) => activeStatuses.has(run.status)) ? 3_000 : false,
  });

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={labels.title} onBack={() => dismissOrHome(router)} />
      {agents.isLoading || query.isLoading ? <ListSkeleton count={6} /> : agents.isError || query.isError ? (
        <View style={styles.center}>
          <Text style={{ color: colors.semantic.error }}>{labels.loadFailed}</Text>
          <Button onPress={() => void (agents.isError ? agents.refetch() : query.refetch())}>{labels.retry}</Button>
        </View>
      ) : (
        <FlatList
          data={query.data ?? []}
          keyExtractor={(run) => run.id}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}
          ListEmptyComponent={<View style={styles.center}><Icon source="source-branch" size={40} color={colors.text.tertiary} /><Text style={{ color: colors.text.tertiary }}>{labels.empty}</Text></View>}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/workflows/runs/${item.id}${item.ownerAgentId ? `?agentId=${encodeURIComponent(item.ownerAgentId)}` : ''}`)}
              style={({ pressed }) => [styles.card, {
                backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel,
                borderColor: colors.border.default,
              }]}
            >
              <View style={styles.row}>
                <Text numberOfLines={2} style={[styles.itemTitle, { color: colors.text.primary }]}>{item.title}</Text>
                <Text style={[styles.meta, { color: colors.accent.primary }]}>{labels.status[item.status]}</Text>
              </View>
              <Text style={[styles.meta, { color: colors.text.secondary }]}>{item.definitionId}</Text>
              <Text style={[styles.meta, { color: colors.text.tertiary }]}>
                {labels.progress.replace('{{done}}', String(item.metrics.doneAgentCount)).replace('{{total}}', String(item.metrics.agentCount))}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

export function WorkflowRunDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id = '', agentId: routeAgentId = '', projectId = '' } = useLocalSearchParams<{ id: string; agentId?: string; projectId?: string }>();
  const { colors } = useTheme();
  const labels = useMessages().workflowsPage;
  const agents = useQuery({ queryKey: queryKeys.agents, queryFn: fetchChatAgents });
  const projects = useQuery({ queryKey: queryKeys.projects, queryFn: fetchProjects, enabled: Boolean(projectId) });
  let ownerAgentId = '';
  if (agents.data) {
    try {
      ownerAgentId = resolveTaskAgentId({
        agents: agents.data,
        project: projects.data?.find((project) => project.id === projectId),
        selectedAgentId: routeAgentId,
      });
    } catch {
      ownerAgentId = '';
    }
  }
  const query = useQuery({
    queryKey: queryKeys.workflowRun(id, ownerAgentId),
    queryFn: () => fetchWorkflowRun(id, ownerAgentId),
    enabled: Boolean(id && ownerAgentId),
    refetchInterval: ({ state }) => activeStatuses.has(state.data?.run.status ?? '') ? 2_500 : false,
  });
  const cancel = useMutation({
    mutationFn: () => cancelWorkflowRun(id, ownerAgentId),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workflowRun(id, ownerAgentId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workflowRuns }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      ]);
    },
  });
  const view = query.data;

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={view?.run.title ?? labels.detailTitle} onBack={() => router.back()} />
      {agents.isLoading || (projectId && projects.isLoading) || query.isLoading ? <ListSkeleton count={5} /> : agents.isError || projects.isError || query.isError || !view ? (
        <View style={styles.center}>
          <Text style={{ color: colors.semantic.error }}>{labels.detailLoadFailed}</Text>
          <Button onPress={() => void Promise.all([
            agents.refetch(),
            ...(projectId ? [projects.refetch()] : []),
            ...(ownerAgentId ? [query.refetch()] : []),
          ])}>{labels.retry}</Button>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
            <View style={styles.row}>
              <Text style={[styles.heading, { color: colors.text.primary }]}>{view.run.title}</Text>
              <Text style={[styles.meta, { color: colors.accent.primary }]}>{labels.status[view.run.status]}</Text>
            </View>
            <Text style={[styles.meta, { color: colors.text.tertiary }]}>
              {labels.progress.replace('{{done}}', String(view.run.metrics.doneAgentCount)).replace('{{total}}', String(view.run.metrics.agentCount))}
            </Text>
            {view.run.goal ? <><Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.goal}</Text><Text style={[styles.body, { color: colors.text.secondary }]}>{view.run.goal}</Text></> : null}
            {view.run.error ? <Text style={[styles.body, { color: colors.semantic.error }]}>{view.run.error.message}</Text> : null}
            {view.controls.canCancel ? <Button mode="outlined" loading={cancel.isPending} disabled={cancel.isPending} onPress={() => cancel.mutate()}>{labels.cancel}</Button> : null}
            {cancel.isError ? <Text style={[styles.meta, { color: colors.semantic.error }]}>{labels.cancelFailed}</Text> : null}
          </View>

          {view.phases.length ? <Section title={labels.phases}>{view.phases.map((phase) => <StatusRow key={phase.id} title={phase.title} status={phase.status} />)}</Section> : null}
          {view.agents.length ? <Section title={labels.agents}>{view.agents.map((agent) => <StatusRow key={agent.id} title={agent.label} status={agent.status} detail={agent.error ?? agent.currentStep ?? agent.resultPreview} error={agent.status === 'error'} />)}</Section> : null}
          {view.nodes.length ? <Section title={labels.steps}>{view.nodes.map((node) => <StatusRow key={node.id} title={node.title} status={node.status} detail={node.error ?? node.resultPreview} error={node.status === 'error'} />)}</Section> : null}
          {view.artifacts.length ? <Section title={labels.artifacts}>{view.artifacts.map((artifact) => <StatusRow key={artifact.id} title={artifact.title ?? artifact.name} status={artifact.mimeType} />)}</Section> : null}
        </ScrollView>
      )}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}><Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{title}</Text>{children}</View>;
}

function StatusRow({ title, status, detail, error }: { title: string; status: string; detail?: string; error?: boolean }) {
  const { colors } = useTheme();
  return <View style={[styles.statusRow, { borderTopColor: colors.border.subtle }]}><View style={styles.row}><Text style={[styles.body, styles.flex, { color: colors.text.primary }]}>{title}</Text><Text style={[styles.meta, { color: error ? colors.semantic.error : colors.text.tertiary }]}>{status}</Text></View>{detail ? <Text style={[styles.meta, { color: error ? colors.semantic.error : colors.text.secondary }]}>{detail}</Text> : null}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1 },
  itemTitle: { ...typography.body, flex: 1, fontWeight: '600' },
  heading: { ...typography.heading, flex: 1 },
  sectionTitle: { ...typography.label },
  body: { ...typography.body },
  meta: { ...typography.caption },
  statusRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, gap: spacing.xs },
});
