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
  const items = (query.data ?? []).filter((item) => item.status !== 'completed' && item.status !== 'cancelled');
  const statusLabels = {
    pending: homePage.taskStatusPending,
    planning: homePage.taskStatusPlanning,
    waiting_dependency: homePage.taskStatusWaitingDependency,
    running: homePage.taskStatusRunning,
    verifying: homePage.taskStatusVerifying,
    needs_user: homePage.taskStatusNeedsYou,
    blocked: homePage.taskStatusBlocked,
    paused: homePage.taskStatusPaused,
    completed: homePage.taskStatusCompleted,
    cancelled: homePage.taskStatusCancelled,
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
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}
          ListEmptyComponent={<View style={styles.empty}><Icon source="target" size={40} color={colors.text.tertiary} /><Text style={{ color: colors.text.tertiary }}>{labels.empty}</Text></View>}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/tasks/${item.id}`)}
              style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel, borderColor: colors.border.default }]}
            >
              <View style={styles.cardTop}><Text numberOfLines={2} style={[styles.title, { color: colors.text.primary }]}>{item.objective}</Text><Text style={[styles.status, { color: colors.accent.primary }]}>{statusLabels[item.status]}</Text></View>
              {item.dueAt ? <Text style={[styles.meta, { color: item.dueAt < Date.now() ? colors.text.primary : colors.text.tertiary }]}>{labels.due} · {new Date(item.dueAt).toLocaleDateString()}</Text> : null}
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
});
