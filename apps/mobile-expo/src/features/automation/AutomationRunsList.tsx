import type { AutomationRun, AutomationRunStatus } from '@xopcai/gateway-contract';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { Button, Chip, Icon, Text } from 'react-native-paper';

import { ListSkeleton } from '../../components/ListSkeleton';
import { useMessages } from '../../i18n/messages';
import { AUTOMATION_RUNS_LIMIT, fetchAutomationRuns } from '../../query/automations';
import { queryKeys } from '../../query/keys';
import { useGatewayConfigured } from '../../query/sessions';
import { usePreferencesStore } from '../../stores/preferences-store';
import { spacing, typography, useTheme } from '../../theme';

import {
  automationRunStart,
  formatAutomationDate,
  formatAutomationDuration,
  isAutomationRunActive,
  isAutomationRunProblem,
} from './automation-presentation';

export function AutomationRunsList() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const configured = useGatewayConfigured();
  const m = useMessages();
  const pm = m.automationRunsPage;
  const language = usePreferencesStore((state) => state.language);
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';

  const runsQuery = useQuery({
    queryKey: queryKeys.automationRuns(AUTOMATION_RUNS_LIMIT),
    queryFn: () => fetchAutomationRuns(AUTOMATION_RUNS_LIMIT),
    enabled: configured,
    refetchInterval: (query) => query.state.data?.some(isAutomationRunActive) ? 5_000 : false,
  });

  const runs = runsQuery.data ?? [];
  const sections = useMemo(() => [
    { key: 'active', title: pm.activeSection, data: runs.filter(isAutomationRunActive) },
    { key: 'attention', title: pm.attentionSection, data: runs.filter(isAutomationRunProblem) },
    { key: 'recent', title: pm.recentSection, data: runs.filter((run) => !isAutomationRunActive(run) && !isAutomationRunProblem(run)) },
  ].filter((section) => section.data.length > 0), [pm, runs]);

  const statusLabel = useMemo<Record<AutomationRunStatus, string>>(() => ({
    queued: pm.statusQueued,
    running: pm.statusRunning,
    cancelling: pm.statusCancelling,
    succeeded: pm.statusSuccess,
    failed: pm.statusFailed,
    cancelled: pm.statusCancelled,
    timeout: pm.statusTimeout,
  }), [pm]);

  const statusColor = useCallback((status: AutomationRunStatus) => {
    if (status === 'succeeded') return colors.semantic.success;
    if (status === 'failed' || status === 'timeout') return colors.semantic.error;
    if (status === 'queued' || status === 'running' || status === 'cancelling') return colors.accent.primary;
    return colors.text.secondary;
  }, [colors]);

  const onRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.automationRuns(AUTOMATION_RUNS_LIMIT) });
  }, [queryClient]);

  const openRun = useCallback((run: AutomationRun) => {
    router.push(`/automation/runs/${run.id}`);
  }, [router]);

  const renderRun = useCallback(({ item }: { item: AutomationRun }) => {
    const start = formatAutomationDate(automationRunStart(item), locale);
    const duration = formatAutomationDuration(item.durationMs);
    const content = (
      <>
        <View style={styles.cardHeader}>
          <Icon source="play-circle-outline" size={24} color={colors.text.secondary} />
          <View style={styles.cardTitleArea}>
            <Text style={[styles.cardTitle, { color: colors.text.primary }]} numberOfLines={1}>
              {item.automationName}
            </Text>
            <Text style={[styles.row, { color: colors.text.secondary }]}>
              {[start, duration].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: colors.accent.selectionBg }]}>
            <Text style={{ color: statusColor(item.status), fontSize: 11, fontWeight: '700' }}>
              {statusLabel[item.status]}
            </Text>
          </View>
          <Icon source="chevron-right" size={20} color={colors.text.secondary} />
        </View>
        {item.summary ? <Text style={[styles.summary, { color: colors.text.secondary }]} numberOfLines={4}>{item.summary}</Text> : null}
        {item.error ? <Text style={[styles.error, { color: colors.semantic.error }]} numberOfLines={3}>{item.error}</Text> : null}
      </>
    );

    return (
      <Pressable
        onPress={() => openRun(item)}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: pressed ? colors.surface.pressed : colors.surface.base,
            borderColor: colors.border.subtle,
          },
        ]}
      >
        {content}
      </Pressable>
    );
  }, [colors, locale, openRun, statusColor, statusLabel]);

  if (runsQuery.isLoading) {
    return <View style={styles.skeleton}><ListSkeleton count={5} /></View>;
  }
  if (runsQuery.isError) {
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.text.secondary, marginBottom: 12 }}>{pm.loadFailed}</Text>
        <Button mode="outlined" onPress={onRefresh}>{m.common.retry}</Button>
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={renderRun}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => <Text style={[styles.sectionHeader, { color: section.key === 'attention' ? colors.semantic.error : colors.text.primary }]}>{section.title} · {section.data.length}</Text>}
      ListHeaderComponent={<View style={styles.headerBlock}><Text style={[styles.subtitle, { color: colors.text.secondary }]}>{pm.subtitle}</Text></View>}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={runsQuery.isFetching && !runsQuery.isLoading} onRefresh={onRefresh} />}
      ListEmptyComponent={<View style={styles.empty}><Chip icon="playlist-remove" mode="outlined">{pm.empty}</Chip></View>}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  skeleton: { paddingHorizontal: spacing.xl },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  headerBlock: { marginBottom: spacing.md },
  subtitle: typography.label,
  sectionHeader: { ...typography.heading, paddingTop: spacing.md, paddingBottom: spacing.xs },
  card: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.md, gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  cardTitleArea: { flex: 1, minWidth: 0 },
  cardTitle: { ...typography.ui, fontWeight: '600' },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  row: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  summary: { fontSize: 12, lineHeight: 17 },
  error: { fontSize: 12, lineHeight: 17 },
  empty: { alignItems: 'center', paddingVertical: 32 },
});
