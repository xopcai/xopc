import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import PagerView from 'react-native-pager-view';
import { Button, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { t, useMessages } from '../../i18n/messages';
import { dismissOrRoot } from '../../lib/navigation';
import { queryKeys } from '../../query/keys';
import { fetchProjects, type Project } from '../../query/projects';
import { useGatewayConfigured } from '../../query/sessions';
import { fetchTasks, type TaskListItem } from '../../query/tasks';
import { usePreferencesStore } from '../../stores/preferences-store';
import { radii, spacing, typography, useTheme } from '../../theme';

import {
  formatProjectRelativeTime,
  sortProjectPortfolio,
} from './project-presentation';

type WorkTab = 'projects' | 'tasks';

const TAB_INDEX: Record<WorkTab, number> = {
  projects: 0,
  tasks: 1,
};

export function TaskListScreen() {
  const router = useRouter();
  const configured = useGatewayConfigured();
  const { colors } = useTheme();
  const messages = useMessages();
  const labels = messages.tasksPage;
  const [tab, setTab] = useState<WorkTab>('projects');
  const pagerRef = useRef<PagerView>(null);
  const tasks = useQuery({ queryKey: queryKeys.tasks, queryFn: () => fetchTasks(), enabled: configured });
  const projects = useQuery({ queryKey: queryKeys.projects, queryFn: fetchProjects, enabled: configured });

  const selectTab = useCallback((next: WorkTab) => {
    setTab(next);
    pagerRef.current?.setPage(TAB_INDEX[next]);
  }, []);

  const onPageSelected = useCallback((position: number) => {
    setTab(position === 0 ? 'projects' : 'tasks');
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader
        title={labels.title}
        largeTitle
        onBack={() => dismissOrRoot(router)}
        rightActions={[{
          icon: 'plus',
          onPress: () => router.push('/tasks/create'),
          accessibilityLabel: labels.create,
        }]}
      />
      <View style={styles.toolLinks}>
        <WorkLink icon="source-branch" label={messages.workflowsPage.title} onPress={() => router.push('/workflows')} />
        <WorkLink icon="clock-outline" label={messages.automationPage.title} onPress={() => router.push('/automation')} />
      </View>
      <View style={[styles.tabBar, { backgroundColor: colors.surface.input }]}>
        <WorkTabButton label={labels.projectsTab} active={tab === 'projects'} onPress={() => selectTab('projects')} />
        <WorkTabButton label={labels.tasksTab} active={tab === 'tasks'} onPress={() => selectTab('tasks')} />
      </View>
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={TAB_INDEX.projects}
        onPageSelected={(event) => onPageSelected(event.nativeEvent.position)}
      >
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

function WorkLink({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.toolLink, {
        backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel,
        borderColor: colors.border.subtle,
      }]}
    >
      <Icon source={icon} size={19} color={colors.accent.primary} />
      <Text style={[styles.toolLinkLabel, { color: colors.text.primary }]}>{label}</Text>
      <Icon source="chevron-right" size={17} color={colors.text.tertiary} />
    </Pressable>
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
      ListEmptyComponent={<EmptySection label={labels.projectsEmpty} />}
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
      ListEmptyComponent={<EmptySection label={labels.empty} />}
    />
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

function EmptySection({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>{label}</Text>
    </View>
  );
}

function WorkLoadError({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  return (
    <View style={styles.center}>
      <Icon source="cloud-alert-outline" size={36} color={colors.text.tertiary} />
      <Text style={[styles.errorText, { color: colors.text.secondary }]}>{message}</Text>
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
  tabButton: { flex: 1, minHeight: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { ...typography.ui, fontWeight: '500' },
  tabLabelActive: { fontWeight: '600' },
  toolLinks: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  toolLink: { flex: 1, minHeight: 52, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toolLinkLabel: { ...typography.label, flex: 1, fontWeight: '600' },
  skeleton: { padding: spacing.lg },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexGrow: 1 },
  row: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  rowBody: { flex: 1, minWidth: 0, gap: spacing.xxs },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { ...typography.ui, fontWeight: '600', flex: 1 },
  rowMeta: { ...typography.caption },
  rowTime: { ...typography.micro },
  healthDot: { width: 8, height: 8, borderRadius: 4 },
  empty: { minHeight: 120, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { ...typography.label, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  errorText: { ...typography.body, textAlign: 'center' },
});
