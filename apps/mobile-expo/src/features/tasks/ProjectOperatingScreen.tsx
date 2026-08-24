import type { ProjectTaskCard, TaskRunReceipt } from '@xopcai/gateway-contract';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { t, useMessages } from '../../i18n/messages';
import { dismissOrHome } from '../../lib/navigation';
import { queryKeys } from '../../query/keys';
import { fetchProjectOperatingView } from '../../query/projects';
import { useGatewayConfigured } from '../../query/sessions';
import { radii, spacing, typography, useTheme } from '../../theme';

import { groupProjectTasks } from './project-presentation';

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export function ProjectOperatingScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const projectId = firstParam(id);
  const configured = useGatewayConfigured();
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  const view = useQuery({
    queryKey: queryKeys.projectOperatingView(projectId),
    queryFn: () => fetchProjectOperatingView(projectId),
    enabled: configured && Boolean(projectId),
  });
  const grouped = useMemo(() => groupProjectTasks(view.data?.tasks ?? []), [view.data?.tasks]);
  const sections = useMemo(() => [
    { key: 'needsUser', title: labels.projectNeedsYou, data: grouped.needsUser },
    { key: 'moving', title: labels.projectMoving, data: grouped.moving },
    { key: 'other', title: labels.projectOtherTasks, data: grouped.other },
  ].filter((section) => section.data.length > 0), [grouped, labels]);

  if (view.isLoading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
        <NativeScreenHeader title={labels.projectsTitle} onBack={() => dismissOrHome(router)} />
        <View style={styles.skeleton}><ListSkeleton count={5} /></View>
      </View>
    );
  }

  if (view.isError || !view.data) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
        <NativeScreenHeader title={labels.projectsTitle} onBack={() => dismissOrHome(router)} />
        <View style={styles.center}>
          <Text style={{ color: colors.semantic.error }}>{labels.projectLoadFailed}</Text>
          <Button onPress={() => void view.refetch()}>{labels.retry}</Button>
        </View>
      </View>
    );
  }

  const data = view.data;
  const focusTask = grouped.needsUser[0] ?? grouped.moving[0] ?? grouped.other.find((task) => task.phase === 'ready');
  const healthColor = data.digest.health === 'attention'
    ? colors.semantic.warning
    : data.digest.health === 'healthy'
      ? colors.semantic.success
      : colors.text.tertiary;

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader
        title={data.project.name}
        onBack={() => dismissOrHome(router)}
        rightActions={[{ icon: 'plus', onPress: () => router.push(`/tasks/create?projectId=${projectId}`), accessibilityLabel: labels.create }]}
      />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={view.isFetching} onRefresh={() => void view.refetch()} />}
        ListHeaderComponent={(
          <View style={[styles.pulse, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
            <View style={styles.pulseTitleRow}>
              <View style={[styles.healthDot, { backgroundColor: healthColor }]} />
              <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.projectPulse}</Text>
            </View>
            <Text style={[styles.body, { color: colors.text.secondary }]}>
              {data.tasks.length
                ? t(labels.projectPulseSummary, { moving: grouped.moving.length, needsUser: grouped.needsUser.length })
                : labels.projectEmptyPulse}
            </Text>
            {data.digest.recommendedAction ? (
              <Text style={[styles.recommendation, { color: colors.text.primary }]}>{data.digest.recommendedAction}</Text>
            ) : null}
            <Button
              mode="contained"
              icon={focusTask ? 'arrow-right' : 'plus'}
              onPress={() => focusTask
                ? router.push(`/tasks/${focusTask.id}`)
                : router.push(`/tasks/create?projectId=${projectId}`)}
            >
              {focusTask ? labels.projectContinue : labels.create}
            </Button>
          </View>
        )}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionHeader, { color: section.key === 'needsUser' ? colors.semantic.warning : colors.text.primary }]}>
            {section.title} · {section.data.length}
          </Text>
        )}
        renderItem={({ item }) => <ProjectTaskRow task={item} onPress={() => router.push(`/tasks/${item.id}`)} />}
        ListFooterComponent={data.recentResults.length ? (
          <View style={styles.results}>
            <Text style={[styles.sectionHeader, { color: colors.text.primary }]}>{labels.recentResults}</Text>
            {data.recentResults.slice(0, 5).map((result) => (
              <ProjectReceiptRow
                key={result.receipt.runId}
                receipt={result.receipt}
                taskTitle={result.taskTitle}
                onPress={() => router.push(`/tasks/${result.taskId}`)}
              />
            ))}
          </View>
        ) : null}
      />
    </View>
  );
}

function ProjectTaskRow({ task, onPress }: { task: ProjectTaskCard; onPress: () => void }) {
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  const needsUser = task.attention.some((item) => item.kind === 'input_required' || item.kind === 'approval_required');
  const phaseLabel = {
    backlog: labels.projectBacklog,
    ready: labels.projectReady,
    active: labels.projectActive,
    review: labels.projectReview,
    closed: labels.projectDone,
  }[task.phase];
  const stateLabel = needsUser
    ? labels.projectNeedsYou
    : task.operationalState === 'waiting' || task.operationalState === 'blocked'
      ? labels.projectWaiting
      : task.operationalState === 'queued' || task.operationalState === 'running' || task.operationalState === 'verifying'
        ? labels.projectMoving
        : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.taskRow, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.base, borderColor: colors.border.subtle }]}
    >
      <View style={styles.taskBody}>
        <Text style={[styles.taskTitle, { color: colors.text.primary }]} numberOfLines={2}>{task.title}</Text>
        <Text style={[styles.meta, { color: needsUser ? colors.semantic.warning : colors.text.tertiary }]}>
          {stateLabel ? `${phaseLabel} · ${stateLabel}` : phaseLabel}
        </Text>
        {task.attention[0] ? <Text style={[styles.body, { color: colors.text.secondary }]} numberOfLines={2}>{task.attention[0].summary}</Text> : null}
      </View>
      <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
    </Pressable>
  );
}

function ProjectReceiptRow({ receipt, taskTitle, onPress }: { receipt: TaskRunReceipt; taskTitle: string; onPress: () => void }) {
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  const verification = {
    passed: labels.resultPassed,
    failed: labels.resultFailed,
    unverified: labels.resultUnverified,
  }[receipt.verification.status];
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.receipt, { borderColor: colors.border.subtle, backgroundColor: pressed ? colors.surface.pressed : colors.surface.base }]}>
      <View style={styles.receiptBody}>
        <Text style={[styles.taskTitle, { color: colors.text.primary }]} numberOfLines={1}>{taskTitle}</Text>
        <Text style={[styles.body, { color: colors.text.secondary }]} numberOfLines={2}>{receipt.summary}</Text>
        <Text style={[styles.meta, { color: receipt.verification.status === 'failed' ? colors.semantic.error : colors.text.tertiary }]}>{verification}</Text>
      </View>
      <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  skeleton: { padding: spacing.lg },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  pulse: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm, marginBottom: spacing.lg },
  pulseTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  healthDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { ...typography.heading },
  recommendation: { ...typography.body, fontWeight: '600' },
  sectionHeader: { ...typography.heading, paddingTop: spacing.md, paddingBottom: spacing.sm },
  taskRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.md },
  taskBody: { flex: 1, minWidth: 0, gap: spacing.xxs },
  taskTitle: { ...typography.ui, fontWeight: '600' },
  body: { ...typography.body },
  meta: { ...typography.label },
  results: { paddingTop: spacing.md },
  receipt: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.md, gap: spacing.sm, flexDirection: 'row', alignItems: 'center' },
  receiptBody: { flex: 1, minWidth: 0, gap: spacing.xs },
});
