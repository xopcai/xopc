import type { Automation, AutomationRunStatus } from '@xopcai/gateway-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import {
  automationCronExpression,
  fetchAutomation,
  fetchAutomationRuns,
  isMobileEditableAutomation,
  runAutomationNow,
  setAutomationEnabled,
} from '../../query/automations';
import { queryKeys } from '../../query/keys';
import { usePreferencesStore } from '../../stores/preferences-store';
import { radii, spacing, typography, useTheme } from '../../theme';

import { automationActionPreview, formatAutomationDate } from './automation-presentation';
import { formatScheduleLabel } from './cron-schedule';

export function AutomationDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const m = useMessages();
  const labels = m.automationDetail;
  const scheduleLabels = m.schedulesPage;
  const runLabels = m.automationRunsPage;
  const language = usePreferencesStore((state) => state.language);
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const automationQuery = useQuery({ queryKey: queryKeys.automation(id), queryFn: () => fetchAutomation(id), enabled: Boolean(id) });
  const runsQuery = useQuery({
    queryKey: queryKeys.automationRuns(10, id),
    queryFn: () => fetchAutomationRuns(10, id),
    enabled: Boolean(id),
  });
  const runMutation = useMutation({
    mutationFn: () => runAutomationNow(id),
    onSuccess: async (run) => {
      await invalidateAutomation(queryClient, id);
      router.push(`/automation/runs/${run.id}`);
    },
  });
  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => setAutomationEnabled(id, enabled),
    onSuccess: () => invalidateAutomation(queryClient, id),
  });

  if (automationQuery.isLoading) {
    return <View style={[styles.screen, { backgroundColor: colors.surface.base }]}><NativeScreenHeader title={labels.title} onBack={() => router.back()} /><View style={styles.content}><ListSkeleton count={4} /></View></View>;
  }
  const automation = automationQuery.data;
  if (automationQuery.isError || !automation) {
    return <View style={[styles.screen, { backgroundColor: colors.surface.base }]}><NativeScreenHeader title={labels.title} onBack={() => router.back()} /><View style={styles.center}><Text style={{ color: colors.semantic.error }}>{labels.loadFailed}</Text><Button onPress={() => void automationQuery.refetch()}>{m.common.retry}</Button></View></View>;
  }

  const statusLabels: Record<AutomationRunStatus, string> = {
    queued: runLabels.statusQueued,
    running: runLabels.statusRunning,
    cancelling: runLabels.statusCancelling,
    succeeded: runLabels.statusSuccess,
    failed: runLabels.statusFailed,
    cancelled: runLabels.statusCancelled,
    timeout: runLabels.statusTimeout,
  };
  const editable = isMobileEditableAutomation(automation);
  const trigger = automationTriggerText(automation, locale, scheduleLabels, labels);
  const busy = runMutation.isPending || toggleMutation.isPending;

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader
        title={automation.name}
        onBack={() => router.back()}
        rightActions={editable ? [{ icon: 'pencil-outline', accessibilityLabel: labels.edit, onPress: () => router.push({ pathname: '/automation/form', params: { id } }) }] : undefined}
      />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={automationQuery.isFetching} onRefresh={() => void Promise.all([automationQuery.refetch(), runsQuery.refetch()])} />}>
        <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
          <View style={styles.titleLine}>
            <Text style={[styles.title, { color: colors.text.primary }]}>{automation.name}</Text>
            <Text style={[styles.status, { color: automation.enabled ? colors.semantic.success : colors.text.tertiary }]}>{automation.enabled ? labels.enabled : labels.paused}</Text>
          </View>
          {automation.description ? <Text style={[styles.body, { color: colors.text.secondary }]}>{automation.description}</Text> : null}
          <Button mode="contained" icon="play" loading={runMutation.isPending} disabled={busy} onPress={() => runMutation.mutate()}>{labels.runNow}</Button>
          <Button mode="outlined" icon={automation.enabled ? 'pause' : 'play-pause'} loading={toggleMutation.isPending} disabled={busy} onPress={() => toggleMutation.mutate(!automation.enabled)}>{automation.enabled ? labels.pause : labels.resume}</Button>
          {runMutation.isError || toggleMutation.isError ? <Text style={{ color: colors.semantic.error }}>{labels.actionFailed}</Text> : null}
        </View>

        <InfoCard title={labels.definition} rows={[
          [labels.trigger, trigger],
          [labels.action, `${labels.actionKinds[automation.action.kind]} · ${automationActionPreview(automation)}`],
          [labels.output, labels.afterRunKinds[automation.afterRun?.kind ?? 'none']],
        ]} />
        <InfoCard title={labels.statusTitle} rows={[
          [labels.nextRun, formatAutomationDate(automation.state.nextRunAtMs, locale) ?? labels.notScheduled],
          [labels.lastRun, automation.state.lastRunStatus ? `${statusLabels[automation.state.lastRunStatus]}${automation.state.lastRunAtMs ? ` · ${formatAutomationDate(automation.state.lastRunAtMs, locale)}` : ''}` : labels.neverRun],
          ...(automation.state.consecutiveFailures ? [[labels.failures, String(automation.state.consecutiveFailures)] as const] : []),
        ]} />
        {automation.state.lastError ? <Text style={[styles.error, { color: colors.semantic.error }]}>{automation.state.lastError}</Text> : null}
        {!editable ? <Text style={[styles.hint, { color: colors.text.secondary }]}>{labels.desktopEditHint}</Text> : null}

        <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.recentRuns}</Text>
        {runsQuery.isLoading ? <ListSkeleton count={2} /> : (runsQuery.data ?? []).length ? runsQuery.data!.map((run) => (
          <Pressable key={run.id} accessibilityRole="button" onPress={() => router.push(`/automation/runs/${run.id}`)} style={[styles.runRow, { borderColor: colors.border.subtle }]}>
            <View style={styles.runBody}><Text style={[styles.body, { color: colors.text.primary }]}>{statusLabels[run.status]}</Text><Text style={[styles.meta, { color: colors.text.tertiary }]}>{formatAutomationDate(run.startedAtMs ?? run.createdAtMs, locale)}</Text></View>
            <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
          </Pressable>
        )) : <Text style={[styles.hint, { color: colors.text.tertiary }]}>{labels.noRuns}</Text>}
      </ScrollView>
    </View>
  );
}

function InfoCard({ title, rows }: { title: string; rows: ReadonlyArray<readonly [string, string]> }) {
  const { colors } = useTheme();
  return <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}><Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{title}</Text>{rows.map(([label, value]) => <View key={label} style={styles.infoRow}><Text style={[styles.meta, { color: colors.text.tertiary }]}>{label}</Text><Text style={[styles.body, styles.infoValue, { color: colors.text.primary }]}>{value}</Text></View>)}</View>;
}

function automationTriggerText(automation: Automation, locale: string, scheduleLabels: ReturnType<typeof useMessages>['schedulesPage'], labels: ReturnType<typeof useMessages>['automationDetail']): string {
  if (automation.trigger.kind !== 'schedule') return labels.triggerKinds[automation.trigger.kind];
  const schedule = automation.trigger.schedule;
  if (schedule.kind === 'cron') return formatScheduleLabel(automationCronExpression(automation), locale, scheduleLabels);
  if (schedule.kind === 'once') return formatAutomationDate(Date.parse(schedule.at), locale) ?? schedule.at;
  return labels.interval.replace('{{duration}}', String(schedule.everyMs));
}

async function invalidateAutomation(queryClient: ReturnType<typeof useQueryClient>, id: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.automations }),
    queryClient.invalidateQueries({ queryKey: queryKeys.automation(id) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.automationMetrics }),
    queryClient.invalidateQueries({ queryKey: ['automations', 'runs'] }),
  ]);
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }, center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.sm },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, title: { ...typography.title, flex: 1 }, status: { ...typography.label, fontWeight: '600' },
  sectionTitle: { ...typography.heading }, body: { ...typography.body }, meta: { ...typography.label }, hint: { ...typography.body }, error: { ...typography.body },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, infoValue: { flex: 1, textAlign: 'right' },
  runRow: { minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm }, runBody: { flex: 1, gap: spacing.xxs },
});
