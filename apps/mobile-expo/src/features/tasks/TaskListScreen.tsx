import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { ListSkeleton } from '../../components/ListSkeleton';
import { dismissOrHome } from '../../lib/navigation';
import { useMessages } from '../../i18n/messages';
import { queryKeys } from '../../query/keys';
import { fetchTasks } from '../../query/tasks';
import { useGatewayConfigured } from '../../query/sessions';
import { radii, spacing, typography, useTheme } from '../../theme';

export function TaskListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const configured = useGatewayConfigured();
  const { colors } = useTheme();
  const { tasksPage: labels, homePage } = useMessages();
  const query = useQuery({
    queryKey: queryKeys.tasks,
    queryFn: fetchTasks,
    enabled: configured,
  });
  const items = (query.data ?? []).filter((item) => item.task.phase !== 'closed');
  const phaseLabels = {
    backlog: homePage.taskStatusPending,
    ready: homePage.taskStatusPlanning,
    active: homePage.taskStatusRunning,
    review: homePage.taskStatusVerifying,
    closed: homePage.taskStatusCompleted,
  } as const;

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader
        title={labels.title}
        onBack={() => dismissOrHome(router)}
        rightActions={[{ icon: 'plus', onPress: () => router.push('/tasks/create'), accessibilityLabel: labels.create }]}
      />
      {query.isLoading ? <ListSkeleton count={7} /> : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.task.id}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}
          ListHeaderComponent={(
            <View style={styles.destinations}>
              <Pressable accessibilityRole="button" onPress={() => router.push('/projects')} style={[styles.destination, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
                <Icon source="folder-outline" size={22} color={colors.accent.primary} />
                <Text style={[styles.destinationLabel, { color: colors.text.primary }]}>{labels.browseProjects}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => router.push('/workflows')} style={[styles.destination, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
                <Icon source="source-branch" size={22} color={colors.accent.primary} />
                <Text style={[styles.destinationLabel, { color: colors.text.primary }]}>{labels.workflowRuns}</Text>
              </Pressable>
            </View>
          )}
          ListEmptyComponent={<View style={styles.empty}><Icon source="target" size={40} color={colors.text.tertiary} /><Text style={{ color: colors.text.tertiary }}>{labels.empty}</Text></View>}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/tasks/${item.task.id}`)}
              style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel, borderColor: colors.border.default }]}
            >
              <View style={styles.cardTop}><Text numberOfLines={2} style={[styles.title, { color: colors.text.primary }]}>{item.task.title}</Text><Text style={[styles.status, { color: colors.accent.primary }]}>{phaseLabels[item.task.phase]}</Text></View>
              <Text style={[styles.meta, { color: colors.text.tertiary }]}>{item.operationalState}</Text>
              {item.task.dueAt ? <Text style={[styles.meta, { color: item.task.dueAt < Date.now() ? colors.text.primary : colors.text.tertiary }]}>{labels.due} · {new Date(item.task.dueAt).toLocaleDateString()}</Text> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { padding: spacing.md, gap: spacing.sm },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: { ...typography.body, flex: 1, fontWeight: '600' }, status: { ...typography.caption, fontWeight: '600' },
  meta: { ...typography.caption }, empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  destinations: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  destination: { flex: 1, minHeight: 72, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  destinationLabel: { ...typography.label },
});
