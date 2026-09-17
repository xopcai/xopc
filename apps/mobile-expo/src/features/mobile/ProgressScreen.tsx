import { useMutation, useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { AppToast } from '../../components/AppToast';
import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { t, useMessages } from '../../i18n/messages';
import { fetchAutomationMetrics } from '../../query/automations';
import { queryKeys } from '../../query/keys';
import { fetchTasks } from '../../query/tasks';
import { useGatewayConfigured } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import { usePreferencesStore } from '../../stores/preferences-store';
import { radii, spacing, typography, useTheme } from '../../theme';
import { AttentionItemRow } from '../attention/AttentionItemRow';
import { useAttentionActions } from '../attention/use-attention-actions';
import { useAttentionFeed } from '../attention/use-attention-feed';
import { formatAutomationDate } from '../automation/automation-presentation';
import { HubEmpty, HubRow, HubSection } from './HubComponents';
import { recentClosedTasks } from './progress-sections';

export function ProgressScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const messages = useMessages();
  const m = messages.mobileExperience;
  const home = useAttentionFeed();
  const actions = useAttentionActions();
  const configured = useGatewayConfigured();
  const gatewayId = useGatewayStore(s => s.activeGatewayId);
  const language = usePreferencesStore(s => s.language);
  const tasks = useQuery({ queryKey: ['tasks', 'mobile-progress', gatewayId], queryFn: () => fetchTasks(), enabled: configured, refetchInterval: 15_000 });
  const automationMetrics = useQuery({ queryKey: queryKeys.automationMetrics, queryFn: fetchAutomationMetrics, enabled: configured, refetchInterval: 60_000 });
  const { refetch: refreshHome } = home;
  const { refetch: refreshTasks } = tasks;
  const { refetch: refreshAutomationMetrics } = automationMetrics;
  const refresh = useCallback(async () => {
    if (configured) await Promise.all([refreshHome(), refreshTasks(), refreshAutomationMetrics()]);
  }, [configured, refreshAutomationMetrics, refreshHome, refreshTasks]);
  const refreshMutation = useMutation({ mutationFn: refresh });
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const closed = recentClosedTasks(tasks.data ?? []).slice(0, 2);
  const needsCount = home.data?.needsUser.length ?? 0;
  const movingCount = home.data?.backgroundCount ?? home.data?.background.length ?? 0;
  const nextRun = automationMetrics.data?.nextRun;
  const nextRunAt = formatAutomationDate(nextRun?.runAtMs, language === 'zh' ? 'zh-CN' : 'en-US');
  return <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
    <NativeScreenHeader title={m.progress} largeTitle rightActions={[{ icon: 'format-list-checks', accessibilityLabel: m.allWork, onPress: () => router.push('/tasks') }]} />
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshMutation.isPending} onRefresh={() => { if (!refreshMutation.isPending) refreshMutation.mutate(); }} />}>
      {configured ? <View style={[styles.summaryCard, { backgroundColor: colors.accent.soft, borderColor: colors.accent.selectionBg }]}>
        <Icon source={needsCount ? 'alert-circle-outline' : 'check-circle-outline'} size={24} color={needsCount ? colors.semantic.warning : colors.semantic.success} />
        <View style={styles.summaryCopy}>
          <Text style={[styles.summaryTitle, { color: colors.text.primary }]}>
            {t(m.progressSummary, { needs: needsCount, moving: movingCount })}
          </Text>
          <Text style={[styles.summaryHint, { color: colors.text.secondary }]}>{m.progressHint}</Text>
        </View>
      </View> : null}
      {!configured ? <HubEmpty text={m.connectHint} /> : home.isLoading ? <ListSkeleton count={4} /> : <>
        {home.isError ? <HubRow title={m.loadFailed} summary={m.retry} icon="refresh" onPress={refresh} /> : <>
          {home.data?.needsUser.length ? <HubSection title={m.needsYou}>
            {home.data.needsUser.map(item => <AttentionItemRow key={item.id} item={item} pending={actions.pending} onAction={actions.runAction} />)}
          </HubSection> : null}
          {home.data?.background.length ? <HubSection title={m.ongoing}>
            {home.data.background.slice(0, 5).map(item => <HubRow key={item.id} title={item.title} summary={[item.statusLabel, item.summary].filter(Boolean).join(' · ')} icon="progress-clock" onPress={() => item.openAction && actions.runAction(item.openAction)} />)}
          </HubSection> : null}
        </>}
        {nextRun && nextRunAt ? <HubSection title={m.upcoming}>
          <HubRow title={nextRun.name} summary={nextRunAt} icon="clock-outline" onPress={() => router.push(`/automation/${nextRun.automationId}`)} />
        </HubSection> : null}
        {closed.length ? <HubSection title={m.recentClosed}>
          {tasks.isLoading ? <ListSkeleton count={2} /> : tasks.isError ? <HubRow title={m.loadFailed} icon="refresh" onPress={() => void tasks.refetch()} /> : closed.length ? closed.map(({ task }) => <HubRow key={task.id} title={task.title} summary={task.resolution ? m.closedState[task.resolution] : undefined} icon="check-circle-outline" onPress={() => router.push(`/tasks/${task.id}`)} />) : <HubEmpty text={m.noClosed} />}
        </HubSection> : null}
      </>}
      <View style={styles.toolsSection}>
        <Text style={[styles.toolsTitle, { color: colors.text.secondary }]}>{m.workTools}</Text>
        <View style={styles.toolGrid}>
          <WorkTool icon="source-branch" label={messages.workflowsPage.title} onPress={() => router.push('/workflows')} />
          <WorkTool icon="clock-outline" label={messages.automationPage.title} onPress={() => router.push('/automation')} />
        </View>
      </View>
    </ScrollView>
    <AppToast visible={Boolean(actions.feedback)} onDismiss={actions.clearFeedback}>{actions.feedback}</AppToast>
  </View>;
}

function WorkTool({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.toolCard, {
    backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel,
    borderColor: colors.border.subtle,
  }]}>
    <View style={[styles.toolIcon, { backgroundColor: colors.accent.soft }]}><Icon source={icon} size={21} color={colors.accent.primary} /></View>
    <Text style={[styles.toolLabel, { color: colors.text.primary }]}>{label}</Text>
    <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.content, paddingBottom: spacing.section, gap: spacing.sm },
  summaryCard: { minHeight: 92, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.lg },
  summaryCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  summaryTitle: { ...typography.heading },
  summaryHint: { ...typography.label },
  toolsSection: { gap: spacing.sm, marginTop: spacing.sm },
  toolsTitle: { ...typography.label, fontWeight: '600' },
  toolGrid: { flexDirection: 'row', gap: spacing.md },
  toolCard: { flex: 1, minHeight: 64, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toolIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  toolLabel: { ...typography.ui, flex: 1, fontWeight: '600' },
});
