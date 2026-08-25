import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import PagerView from 'react-native-pager-view';
import { Button, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { t, useMessages } from '../../i18n/messages';
import { dismissOrHome } from '../../lib/navigation';
import { queryKeys } from '../../query/keys';
import { fetchProjects, type Project } from '../../query/projects';
import { useGatewayConfigured } from '../../query/sessions';
import { fetchTasks, type TaskListItem } from '../../query/tasks';
import { usePreferencesStore } from '../../stores/preferences-store';
import { radii, spacing, typography, useTheme } from '../../theme';

import {
  formatProjectRelativeTime,
  selectWorkOverviewProjects,
  selectWorkOverviewTasks,
  sortProjectPortfolio,
} from './project-presentation';

type WorkTab = 'overview' | 'projects' | 'tasks';

const TAB_INDEX: Record<WorkTab, number> = {
  overview: 0,
  projects: 1,
  tasks: 2,
};

export function TaskListScreen() {
  const router = useRouter();
  const configured = useGatewayConfigured();
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  const [tab, setTab] = useState<WorkTab>('overview');
  const pagerRef = useRef<PagerView>(null);
  const tasks = useQuery({ queryKey: queryKeys.tasks, queryFn: fetchTasks, enabled: configured });
  const projects = useQuery({ queryKey: queryKeys.projects, queryFn: fetchProjects, enabled: configured });

  const selectTab = useCallback((next: WorkTab) => {
    setTab(next);
    pagerRef.current?.setPage(TAB_INDEX[next]);
  }, []);

  const onPageSelected = useCallback((position: number) => {
    setTab(position === 0 ? 'overview' : position === 1 ? 'projects' : 'tasks');
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader
        title={labels.title}
        onBack={() => dismissOrHome(router)}
        rightActions={[{
          icon: 'plus',
          onPress: () => router.push('/tasks/create'),
          accessibilityLabel: labels.create,
        }]}
      />
      <View style={[styles.tabBar, { backgroundColor: colors.surface.input }]}>
        <WorkTabButton label={labels.overviewTab} active={tab === 'overview'} onPress={() => selectTab('overview')} />
        <WorkTabButton label={labels.projectsTab} active={tab === 'projects'} onPress={() => selectTab('projects')} />
        <WorkTabButton label={labels.tasksTab} active={tab === 'tasks'} onPress={() => selectTab('tasks')} />
      </View>
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={TAB_INDEX.overview}
        onPageSelected={(event) => onPageSelected(event.nativeEvent.position)}
      >
        <View key="overview" style={styles.page} collapsable={false}>
          <WorkOverview
            tasksQuery={tasks}
            projectsQuery={projects}
            onShowProjects={() => selectTab('projects')}
            onShowTasks={() => selectTab('tasks')}
          />
        </View>
        <View key="projects" style={styles.page} collapsable={false}>
          <ProjectsPage query={projects} />
        </View>
        <View key="tasks" style={styles.page} collapsable={false}>
          <TasksPage query={tasks} />
        </View>
      </PagerView>
    </View>
  );
}

function WorkTabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tabButton, active && { backgroundColor: colors.surface.panel }]}
    >
      <Text style={[styles.tabLabel, { color: active ? colors.text.primary : colors.text.secondary }, active && styles.tabLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

type TasksQuery = ReturnType<typeof useQuery<TaskListItem[]>>;
type ProjectsQuery = ReturnType<typeof useQuery<Project[]>>;

function WorkOverview({
  tasksQuery,
  projectsQuery,
  onShowProjects,
  onShowTasks,
}: {
  tasksQuery: TasksQuery;
  projectsQuery: ProjectsQuery;
  onShowProjects: () => void;
  onShowTasks: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  const openTasks = useMemo(
    () => (tasksQuery.data ?? []).filter((item) => item.task.phase !== 'closed'),
    [tasksQuery.data],
  );
  const attentionTasks = useMemo(
    () => openTasks.filter((item) => item.attention.length > 0).slice(0, 3),
    [openTasks],
  );
  const activeTasks = useMemo(
    () => selectWorkOverviewTasks(tasksQuery.data ?? []),
    [tasksQuery.data],
  );
  const activeProjects = useMemo(
    () => selectWorkOverviewProjects(projectsQuery.data ?? []),
    [projectsQuery.data],
  );

  const refresh = useCallback(async () => {
    await Promise.all([tasksQuery.refetch(), projectsQuery.refetch()]);
  }, [projectsQuery, tasksQuery]);

  if (tasksQuery.isLoading || projectsQuery.isLoading) {
    return <View style={styles.skeleton}><ListSkeleton count={6} /></View>;
  }
  if (tasksQuery.isError || projectsQuery.isError) {
    return <WorkLoadError onRetry={() => void refresh()} retrying={tasksQuery.isFetching || projectsQuery.isFetching} />;
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.overview, { paddingBottom: insets.bottom + spacing.xxl }]}
      refreshControl={<RefreshControl refreshing={tasksQuery.isFetching || projectsQuery.isFetching} onRefresh={() => void refresh()} />}
    >
      <WorkSection title={labels.needsAttention}>
        {attentionTasks.length ? attentionTasks.map((item, index) => (
          <TaskRow key={item.task.id} item={item} last={index === attentionTasks.length - 1} />
        )) : (
          <View style={[styles.clearState, { backgroundColor: colors.surface.panel }]}>
            <Icon source="check-circle-outline" size={20} color={colors.semantic.success} />
            <Text style={[styles.clearText, { color: colors.text.secondary }]}>{labels.attentionClear}</Text>
          </View>
        )}
      </WorkSection>

      <WorkSection title={labels.activeProjects} actionLabel={labels.viewAll} onAction={onShowProjects}>
        {activeProjects.length ? activeProjects.map((project, index) => (
          <ProjectRow key={project.id} project={project} last={index === activeProjects.length - 1} />
        )) : <EmptySection icon="folder-check-outline" label={labels.noActiveProjects} />}
      </WorkSection>

      <WorkSection title={labels.activeTasks} actionLabel={labels.viewAll} onAction={onShowTasks}>
        {activeTasks.length ? activeTasks.map((item, index) => (
          <TaskRow key={item.task.id} item={item} last={index === activeTasks.length - 1} />
        )) : <EmptySection icon="check-all" label={labels.noActiveTasks} />}
      </WorkSection>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/workflows')}
        style={({ pressed }) => [styles.workflowLink, {
          backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel,
          borderColor: colors.border.default,
        }]}
      >
        <Icon source="source-branch" size={22} color={colors.accent.primary} />
        <View style={styles.workflowBody}>
          <Text style={[styles.workflowTitle, { color: colors.text.primary }]}>{labels.workflowRuns}</Text>
          <Text style={[styles.workflowHint, { color: colors.text.secondary }]}>{labels.workflowRunsHint}</Text>
        </View>
        <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
      </Pressable>
    </ScrollView>
  );
}

function ProjectsPage({ query }: { query: ProjectsQuery }) {
  const insets = useSafeAreaInsets();
  const labels = useMessages().tasksPage;
  const projects = useMemo(() => sortProjectPortfolio(query.data ?? []), [query.data]);

  if (query.isLoading) return <View style={styles.skeleton}><ListSkeleton count={6} /></View>;
  if (query.isError) {
    return <WorkLoadError message={labels.projectsLoadFailed} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }

  return (
    <FlatList
      data={projects}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => <ProjectRow project={item} last={index === projects.length - 1} />}
      contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xxl }]}
      refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}
      ListEmptyComponent={<EmptySection icon="folder-outline" label={labels.projectsEmpty} />}
    />
  );
}

function TasksPage({ query }: { query: TasksQuery }) {
  const insets = useSafeAreaInsets();
  const labels = useMessages().tasksPage;
  const items = useMemo(
    () => (query.data ?? []).filter((item) => item.task.phase !== 'closed'),
    [query.data],
  );

  if (query.isLoading) return <View style={styles.skeleton}><ListSkeleton count={7} /></View>;
  if (query.isError) {
    return <WorkLoadError message={labels.tasksLoadFailed} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.task.id}
      renderItem={({ item, index }) => <TaskRow item={item} last={index === items.length - 1} />}
      contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xxl }]}
      refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}
      ListEmptyComponent={<EmptySection icon="target" label={labels.empty} />}
    />
  );
}

function WorkSection({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{title}</Text>
        {actionLabel && onAction ? (
          <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}>
            <Text style={[styles.sectionAction, { color: colors.accent.primary }]}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function ProjectRow({ project, last }: { project: Project; last: boolean }) {
  const router = useRouter();
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  const language = usePreferencesStore((state) => state.language);
  const counts = project.operating.counts;
  const status = counts.needsUser > 0
    ? t(labels.projectNeedsUserCount, { count: counts.needsUser })
    : counts.moving > 0
      ? t(labels.projectMovingCount, { count: counts.moving })
      : labels.projectIdle;
  const healthColor = project.operating.health === 'attention'
    ? colors.semantic.warning
    : project.operating.health === 'healthy'
      ? colors.semantic.success
      : colors.text.tertiary;
  const relativeTime = formatProjectRelativeTime(
    project.operating.updatedAt,
    language === 'zh' ? 'zh-CN' : 'en-US',
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={project.name}
      onPress={() => router.push(`/projects/${project.id}`)}
      style={({ pressed }) => [styles.row, {
        backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel,
        borderBottomColor: colors.border.subtle,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
      }]}
    >
      <View style={[styles.healthDot, { backgroundColor: healthColor }]} />
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text.primary }]}>{project.name}</Text>
          {relativeTime ? <Text style={[styles.rowTime, { color: colors.text.tertiary }]}>{relativeTime}</Text> : null}
        </View>
        <Text style={[styles.rowMeta, { color: counts.needsUser > 0 ? colors.semantic.warning : colors.text.secondary }]}>{status}</Text>
      </View>
      <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
    </Pressable>
  );
}

function TaskRow({ item, last }: { item: TaskListItem; last: boolean }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { tasksPage: labels, homePage } = useMessages();
  const phaseLabel = {
    backlog: homePage.taskStatusPending,
    ready: homePage.taskStatusPlanning,
    active: homePage.taskStatusRunning,
    review: homePage.taskStatusVerifying,
    closed: homePage.taskStatusCompleted,
  }[item.task.phase];
  const needsAttention = item.attention.length > 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.task.title}
      onPress={() => router.push(`/tasks/${item.task.id}`)}
      style={({ pressed }) => [styles.row, {
        backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel,
        borderBottomColor: colors.border.subtle,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
      }]}
    >
      <Icon
        source={needsAttention ? 'alert-circle-outline' : 'checkbox-blank-circle-outline'}
        size={19}
        color={needsAttention ? colors.semantic.warning : colors.text.tertiary}
      />
      <View style={styles.rowBody}>
        <Text numberOfLines={2} style={[styles.rowTitle, { color: colors.text.primary }]}>{item.task.title}</Text>
        <Text style={[styles.rowMeta, { color: needsAttention ? colors.semantic.warning : colors.text.tertiary }]}>
          {needsAttention ? labels.needsYou : `${phaseLabel} · ${item.operationalState}`}
        </Text>
      </View>
      <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
    </Pressable>
  );
}

function EmptySection({ icon, label }: { icon: string; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <Icon source={icon} size={28} color={colors.text.tertiary} />
      <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>{label}</Text>
    </View>
  );
}

function WorkLoadError({
  message,
  onRetry,
  retrying,
}: {
  message?: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  return (
    <View style={styles.center}>
      <Icon source="cloud-alert-outline" size={36} color={colors.text.tertiary} />
      <Text style={[styles.errorText, { color: colors.text.secondary }]}>{message ?? labels.workLoadFailed}</Text>
      <Button loading={retrying} disabled={retrying} onPress={onRetry}>{labels.retry}</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pager: { flex: 1 },
  page: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radii.lg,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  tabButton: { flex: 1, minHeight: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { ...typography.ui, fontWeight: '500' },
  tabLabelActive: { fontWeight: '600' },
  overview: { padding: spacing.lg, gap: spacing.section },
  skeleton: { padding: spacing.lg },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexGrow: 1 },
  section: { gap: spacing.sm },
  sectionHeader: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...typography.heading },
  sectionAction: { ...typography.label, fontWeight: '600' },
  sectionBody: { borderRadius: radii.lg, overflow: 'hidden' },
  row: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  rowBody: { flex: 1, minWidth: 0, gap: spacing.xxs },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { ...typography.ui, fontWeight: '600', flex: 1 },
  rowMeta: { ...typography.caption },
  rowTime: { ...typography.micro },
  healthDot: { width: 8, height: 8, borderRadius: 4 },
  clearState: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  clearText: { ...typography.body },
  empty: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyText: { ...typography.body, textAlign: 'center' },
  workflowLink: { minHeight: 72, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  workflowBody: { flex: 1, gap: spacing.xxs },
  workflowTitle: { ...typography.ui, fontWeight: '600' },
  workflowHint: { ...typography.caption },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  errorText: { ...typography.body, textAlign: 'center' },
});
