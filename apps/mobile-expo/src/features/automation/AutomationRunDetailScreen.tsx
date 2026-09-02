import type { AutomationRunStatus } from '@xopcai/gateway-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { openChat } from '../../lib/navigation';
import {
  cancelAutomationRun,
  fetchAutomationRun,
  fetchAutomationRunEvents,
  rerunAutomation,
} from '../../query/automations';
import { queryKeys } from '../../query/keys';
import { usePreferencesStore } from '../../stores/preferences-store';
import { radii, spacing, typography, useTheme } from '../../theme';
import { MarkdownView } from '../chat/MarkdownView';

import {
  formatAutomationDate,
  formatAutomationDuration,
  isAutomationRunActive,
  isAutomationRunProblem,
} from './automation-presentation';

export function AutomationRunDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { runId = '' } = useLocalSearchParams<{ runId: string }>();
  const { colors } = useTheme();
  const m = useMessages();
  const labels = m.automationRunDetail;
  const statusMessages = m.automationRunsPage;
  const language = usePreferencesStore((state) => state.language);
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const runQuery = useQuery({
    queryKey: queryKeys.automationRun(runId),
    queryFn: () => fetchAutomationRun(runId),
    enabled: Boolean(runId),
    refetchInterval: (query) => query.state.data && isAutomationRunActive(query.state.data) ? 3_000 : false,
  });
  const eventsQuery = useQuery({
    queryKey: queryKeys.automationRunEvents(runId),
    queryFn: () => fetchAutomationRunEvents(runId),
    enabled: Boolean(runId),
    refetchInterval: () => runQuery.data && isAutomationRunActive(runQuery.data) ? 3_000 : false,
  });
  const rerunMutation = useMutation({
    mutationFn: () => rerunAutomation(runId),
    onSuccess: async (run) => {
      await invalidateRuns(queryClient);
      router.replace(`/automation/runs/${run.id}`);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelAutomationRun(runId),
    onSuccess: async () => {
      await invalidateRuns(queryClient);
      await runQuery.refetch();
    },
  });

  if (runQuery.isLoading) {
    return <View style={[styles.screen, { backgroundColor: colors.surface.base }]}><NativeScreenHeader title={labels.title} onBack={() => router.back()} /><View style={styles.content}><ListSkeleton count={4} /></View></View>;
  }
  const run = runQuery.data;
  if (runQuery.isError || !run) {
    return <View style={[styles.screen, { backgroundColor: colors.surface.base }]}><NativeScreenHeader title={labels.title} onBack={() => router.back()} /><View style={styles.center}><Text style={{ color: colors.semantic.error }}>{labels.loadFailed}</Text><Button onPress={() => void runQuery.refetch()}>{m.common.retry}</Button></View></View>;
  }

  const statusLabels: Record<AutomationRunStatus, string> = {
    queued: statusMessages.statusQueued,
    running: statusMessages.statusRunning,
    cancelling: statusMessages.statusCancelling,
    succeeded: statusMessages.statusSuccess,
    failed: statusMessages.statusFailed,
    cancelled: statusMessages.statusCancelled,
    timeout: statusMessages.statusTimeout,
  };
  const active = isAutomationRunActive(run);
  const canRerun = isAutomationRunProblem(run) || run.status === 'cancelled';
  const refresh = () => void Promise.all([runQuery.refetch(), eventsQuery.refetch()]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={run.automationName} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={runQuery.isFetching} onRefresh={refresh} />}>
        <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
          <View style={styles.titleLine}>
            <Icon
              source={active ? 'progress-clock' : isAutomationRunProblem(run) ? 'alert-circle-outline' : run.status === 'succeeded' ? 'check-circle-outline' : 'close-circle-outline'}
              size={24}
              color={isAutomationRunProblem(run) ? colors.semantic.error : active ? colors.accent.primary : run.status === 'succeeded' ? colors.semantic.success : colors.text.tertiary}
            />
            <View style={styles.titleBody}><Text style={[styles.title, { color: colors.text.primary }]}>{statusLabels[run.status]}</Text><Text style={[styles.meta, { color: colors.text.tertiary }]}>{formatAutomationDate(run.startedAtMs ?? run.createdAtMs, locale)}{run.durationMs !== undefined ? ` · ${formatAutomationDuration(run.durationMs)}` : ''}</Text></View>
          </View>
          {run.summary ? <MarkdownView content={run.summary} allowTrailingMargin /> : null}
          {run.error ? <Text style={[styles.body, { color: colors.semantic.error }]}>{run.error}</Text> : null}
          {active ? <Button mode="outlined" icon="stop" textColor={colors.semantic.error} loading={cancelMutation.isPending} disabled={cancelMutation.isPending} onPress={() => cancelMutation.mutate()}>{labels.cancel}</Button> : null}
          {canRerun ? <Button mode="contained" icon="refresh" loading={rerunMutation.isPending} disabled={rerunMutation.isPending} onPress={() => rerunMutation.mutate()}>{labels.rerun}</Button> : null}
          {rerunMutation.isError || cancelMutation.isError ? <Text style={{ color: colors.semantic.error }}>{labels.actionFailed}</Text> : null}
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
          <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.result}</Text>
          {run.sessionKey ? <Button mode="contained-tonal" icon="message-outline" onPress={() => openChat(router, run.sessionKey!)}>{labels.openChat}</Button> : null}
          {run.workflowRunId ? <Button mode="contained-tonal" icon="source-branch" onPress={() => router.push(`/workflows/runs/${run.workflowRunId}${run.actionSnapshot.kind === 'workflow' && run.actionSnapshot.agentId ? `?agentId=${encodeURIComponent(run.actionSnapshot.agentId)}` : ''}`)}>{labels.openWorkflow}</Button> : null}
          {!run.sessionKey && !run.workflowRunId ? <Text style={[styles.body, { color: colors.text.tertiary }]}>{labels.noLinkedResult}</Text> : null}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.timeline}</Text>
        {eventsQuery.isLoading ? <ListSkeleton count={3} /> : (eventsQuery.data ?? []).length ? eventsQuery.data!.map((event) => (
          <View key={event.id} style={[styles.event, { borderColor: colors.border.subtle }]}>
            <View style={styles.eventDotColumn}><View style={[styles.eventDot, { backgroundColor: colors.accent.primary }]} /></View>
            <View style={styles.eventBody}><Text style={[styles.body, { color: colors.text.primary }]}>{event.message}</Text><Text style={[styles.meta, { color: colors.text.tertiary }]}>{formatAutomationDate(event.createdAtMs, locale)}</Text></View>
          </View>
        )) : <Text style={[styles.body, { color: colors.text.tertiary }]}>{labels.noEvents}</Text>}
      </ScrollView>
    </View>
  );
}

async function invalidateRuns(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.automations }),
    queryClient.invalidateQueries({ queryKey: queryKeys.automationMetrics }),
    queryClient.invalidateQueries({ queryKey: ['automations', 'runs'] }),
  ]);
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }, center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.sm },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm }, titleLine: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, titleBody: { flex: 1, gap: spacing.xxs },
  title: { ...typography.title }, sectionTitle: { ...typography.heading }, body: { ...typography.body }, meta: { ...typography.label },
  event: { borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', paddingVertical: spacing.md }, eventDotColumn: { width: 20, paddingTop: 6 }, eventDot: { width: 8, height: 8, borderRadius: 4 }, eventBody: { flex: 1, gap: spacing.xxs },
});
