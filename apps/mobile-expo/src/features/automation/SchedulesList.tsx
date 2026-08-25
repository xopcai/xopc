import type { Automation, AutomationRunStatus } from '@xopcai/gateway-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Button, Chip, Icon, IconButton, Menu, Text } from 'react-native-paper';

import { AppToast } from '../../components/AppToast';
import { ListSkeleton } from '../../components/ListSkeleton';
import { TOAST_DURATION_DEFAULT } from '../../constants/toast';
import { t, useMessages } from '../../i18n/messages';
import {
  AUTOMATION_RUNS_LIMIT,
  automationCronExpression,
  fetchAutomationMetrics,
  fetchAutomations,
  isMobileEditableAutomation,
  runAutomationNow,
  setAutomationEnabled,
} from '../../query/automations';
import { queryKeys } from '../../query/keys';
import { useGatewayConfigured } from '../../query/sessions';
import { usePreferencesStore } from '../../stores/preferences-store';
import { spacing, typography, useTheme } from '../../theme';

import { automationActionPreview, formatAutomationDate } from './automation-presentation';
import { formatScheduleLabel } from './cron-schedule';

export function SchedulesList() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const configured = useGatewayConfigured();
  const m = useMessages();
  const pm = m.schedulesPage;
  const runLabels = m.automationRunsPage;
  const language = usePreferencesStore((state) => state.language);
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const [toast, setToast] = useState('');
  const [menuAutomationId, setMenuAutomationId] = useState<string>();

  const automationsQuery = useQuery({ queryKey: queryKeys.automations, queryFn: () => fetchAutomations(), enabled: configured });
  const metricsQuery = useQuery({ queryKey: queryKeys.automationMetrics, queryFn: fetchAutomationMetrics, enabled: configured });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setAutomationEnabled(id, enabled),
    onSuccess: async () => {
      setMenuAutomationId(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.automations }),
        queryClient.invalidateQueries({ queryKey: queryKeys.automationMetrics }),
      ]);
    },
    onError: (error) => setToast(error instanceof Error ? error.message : pm.actionFailed),
  });
  const runMutation = useMutation({
    mutationFn: (id: string) => runAutomationNow(id),
    onSuccess: async () => {
      setToast(pm.runStartedToast);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.automations }),
        queryClient.invalidateQueries({ queryKey: queryKeys.automationMetrics }),
        queryClient.invalidateQueries({ queryKey: queryKeys.automationRuns(AUTOMATION_RUNS_LIMIT) }),
      ]);
    },
    onError: (error) => setToast(error instanceof Error ? error.message : pm.actionFailed),
  });

  const automations = automationsQuery.data ?? [];
  const scheduleLabels = useMemo(() => ({
    every15Min: pm.every15Min,
    every30Min: pm.every30Min,
    everyHour: pm.everyHour,
    dailyAt: pm.dailyAt,
    weekdaysAt: pm.weekdaysAt,
  }), [pm]);
  const statusLabels = useMemo<Record<AutomationRunStatus, string>>(() => ({
    queued: runLabels.statusQueued,
    running: runLabels.statusRunning,
    cancelling: runLabels.statusCancelling,
    succeeded: runLabels.statusSuccess,
    failed: runLabels.statusFailed,
    cancelled: runLabels.statusCancelled,
    timeout: runLabels.statusTimeout,
  }), [runLabels]);

  const refresh = useCallback(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.automations }),
      queryClient.invalidateQueries({ queryKey: queryKeys.automationMetrics }),
    ]);
  }, [queryClient]);

  const openAutomation = useCallback((automation: Automation) => {
    router.push(`/automation/${automation.id}`);
  }, [router]);

  const renderAutomation = useCallback(({ item }: { item: Automation }) => {
    const cronExpression = automationCronExpression(item);
    const trigger = cronExpression
      ? formatScheduleLabel(cronExpression, locale, scheduleLabels)
      : t(pm.triggerKind, { kind: item.trigger.kind });
    const lastRunAt = formatAutomationDate(item.state.lastRunAtMs, locale);
    const isRunningThis = runMutation.isPending && runMutation.variables === item.id;
    const isTogglingThis = toggleMutation.isPending && toggleMutation.variables?.id === item.id;
    const isBusy = isRunningThis || isTogglingThis;
    const lastStatus = item.state.lastRunStatus ? statusLabels[item.state.lastRunStatus] : undefined;
    const lastStatusColor = item.state.lastRunStatus === 'failed' || item.state.lastRunStatus === 'timeout'
      ? colors.semantic.error
      : colors.text.tertiary;

    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => openAutomation(item)}
        style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.base, borderColor: colors.border.subtle }]}
      >
        <View style={styles.rowMain}>
          <View style={styles.titleLine}>
            <Text style={[styles.title, { color: colors.text.primary }]} numberOfLines={1}>{item.name || pm.unnamedJob}</Text>
            <View style={[styles.badge, { backgroundColor: item.enabled ? colors.accent.selectionBg : colors.surface.input }]}>
              <Text style={[styles.badgeText, { color: item.enabled ? colors.semantic.success : colors.text.tertiary }]}>{item.enabled ? pm.enabled : pm.disabled}</Text>
            </View>
          </View>
          <Text style={[styles.meta, { color: colors.text.secondary }]}>{trigger}</Text>
          <Text style={[styles.preview, { color: colors.text.secondary }]} numberOfLines={2}>{automationActionPreview(item)}</Text>
          <View style={styles.statusLine}>
            {item.state.nextRunAtMs ? <Text style={[styles.meta, { color: colors.text.tertiary }]}>{pm.nextRun} · {formatAutomationDate(item.state.nextRunAtMs, locale)}</Text> : null}
            {lastStatus ? <Text style={[styles.meta, { color: lastStatusColor }]}>{pm.lastRun} · {lastStatus}{lastRunAt ? ` · ${lastRunAt}` : ''}</Text> : null}
          </View>
          {item.state.lastError ? <Text style={[styles.error, { color: colors.semantic.error }]} numberOfLines={2}>{item.state.lastError}</Text> : null}
        </View>
        <View style={styles.actions}>
          <IconButton icon="play" accessibilityLabel={pm.runNow} loading={isRunningThis} disabled={isBusy} onPress={() => runMutation.mutate(item.id)} />
          <Menu
            visible={menuAutomationId === item.id}
            onDismiss={() => setMenuAutomationId(undefined)}
            anchor={<IconButton icon="dots-horizontal" accessibilityLabel={pm.moreActions} disabled={isBusy} onPress={() => setMenuAutomationId(item.id)} />}
          >
            <Menu.Item leadingIcon={item.enabled ? 'pause' : 'play-pause'} title={item.enabled ? pm.disable : pm.enable} onPress={() => toggleMutation.mutate({ id: item.id, enabled: !item.enabled })} />
            {isMobileEditableAutomation(item) ? <Menu.Item leadingIcon="pencil-outline" title={pm.edit} onPress={() => router.push({ pathname: '/automation/form', params: { id: item.id } })} /> : null}
          </Menu>
        </View>
      </Pressable>
    );
  }, [colors, locale, menuAutomationId, openAutomation, pm, router, runMutation, scheduleLabels, statusLabels, toggleMutation]);

  if (automationsQuery.isLoading) return <View style={styles.skeleton}><ListSkeleton count={5} /></View>;
  if (automationsQuery.isError) {
    return <View style={styles.center}><Text style={{ color: colors.text.secondary }}>{pm.loadFailed}</Text><Button mode="outlined" onPress={refresh}>{m.common.retry}</Button></View>;
  }

  const metrics = metricsQuery.data;
  return (
    <>
      <FlatList
        data={automations}
        keyExtractor={(item) => item.id}
        renderItem={renderAutomation}
        ListHeaderComponent={metrics ? (
          <View style={[styles.briefing, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
            <View style={styles.briefingLine}>
              <Icon source="pulse" size={20} color={colors.accent.primary} />
              <Text style={[styles.briefingTitle, { color: colors.text.primary }]}>{t(pm.operationsSummary, { running: metrics.runningRuns, failed: metrics.failedLastHour })}</Text>
            </View>
            {metrics.nextRun ? <Text style={[styles.meta, { color: colors.text.secondary }]}>{t(pm.nextAutomation, { name: metrics.nextRun.name, time: formatAutomationDate(metrics.nextRun.runAtMs, locale) ?? '' })}</Text> : null}
          </View>
        ) : null}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={automationsQuery.isFetching && !automationsQuery.isLoading} onRefresh={refresh} />}
        ListEmptyComponent={<View style={styles.empty}><Chip icon="timer-off-outline" mode="outlined">{pm.empty}</Chip><Button mode="contained" icon="plus" onPress={() => router.push('/automation/form')}>{pm.createFirst}</Button></View>}
      />
      <AppToast visible={Boolean(toast)} onDismiss={() => setToast('')} duration={TOAST_DURATION_DEFAULT}>{toast}</AppToast>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  skeleton: { paddingHorizontal: spacing.xl },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  briefing: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.md },
  briefingLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  briefingTitle: { ...typography.ui, fontWeight: '600', flex: 1 },
  row: { minHeight: 112, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.md, flexDirection: 'row', gap: spacing.sm },
  rowMain: { flex: 1, minWidth: 0, gap: spacing.xxs },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.ui, fontWeight: '600', flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { ...typography.micro, fontWeight: '600' },
  preview: { ...typography.body },
  meta: { ...typography.label },
  statusLine: { gap: spacing.xxs, marginTop: spacing.xs },
  error: { ...typography.label },
  actions: { justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
});
