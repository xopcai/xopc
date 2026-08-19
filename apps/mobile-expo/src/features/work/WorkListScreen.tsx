import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { ListSkeleton } from '../../components/ListSkeleton';
import { dismissOrHome } from '../../lib/navigation';
import { useFlatListEndReached } from '../../lib/use-flat-list-end-reached';
import { useMessages } from '../../i18n/messages';
import { queryKeys } from '../../query/keys';
import { fetchWorkItems, type WorkItem } from '../../query/work-items';
import { useGatewayConfigured } from '../../query/sessions';
import { radii, spacing, typography, useTheme } from '../../theme';

function phaseLabel(phase: WorkItem['phase'], labels: ReturnType<typeof useMessages>['workPage']) {
  return labels.status[phase];
}

export function WorkListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const configured = useGatewayConfigured();
  const { colors } = useTheme();
  const { workPage: labels } = useMessages();
  const query = useInfiniteQuery({
    queryKey: queryKeys.workItems('active'),
    queryFn: ({ pageParam }) => fetchWorkItems({
      phase: ['ready', 'executing', 'verifying'],
      sortBy: 'updatedAt',
      sortOrder: 'desc',
      limit: 30,
      offset: pageParam,
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.offset + lastPage.limit : undefined,
    enabled: configured,
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data?.pages]);
  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage]);
  const { onEndReached, onMomentumScrollBegin } = useFlatListEndReached(loadMore);

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader
        title={labels.title}
        onBack={() => dismissOrHome(router)}
        rightActions={[{ icon: 'plus', onPress: () => router.push('/work/create'), accessibilityLabel: labels.create }]}
      />
      {query.isLoading ? <ListSkeleton count={7} /> : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          onMomentumScrollBegin={onMomentumScrollBegin}
          refreshControl={<RefreshControl refreshing={query.isFetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} />}
          ListEmptyComponent={<View style={styles.empty}><Icon source="checkbox-marked-circle-outline" size={40} color={colors.text.tertiary} /><Text style={{ color: colors.text.tertiary }}>{labels.empty}</Text></View>}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/work/${item.id}`)}
              style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel, borderColor: colors.border.default }]}
            >
              <View style={styles.cardTop}><Text numberOfLines={2} style={[styles.title, { color: colors.text.primary }]}>{item.title}</Text><Text style={[styles.status, { color: colors.accent.primary }]}>{phaseLabel(item.phase, labels)}</Text></View>
              {item.nextAction ? <Text numberOfLines={2} style={[styles.meta, { color: colors.text.secondary }]}>{item.nextAction.text}</Text> : null}
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
