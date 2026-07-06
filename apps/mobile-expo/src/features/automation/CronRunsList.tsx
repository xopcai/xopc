import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Chip, Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { openChat } from '../../lib/navigation';
import { cronRunSessionKey, fetchCronRunsHistory, RUNS_HISTORY_LIMIT, type CronRunRow } from '../../query/cron';
import { queryKeys } from '../../query/keys';
import { useGatewayConfigured } from '../../query/sessions';
import { useTheme } from '../../theme';

export function CronRunsList() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const configured = useGatewayConfigured();
  const m = useMessages();
  const pm = m.cronRunsPage;

  const runsQuery = useQuery({
    queryKey: queryKeys.cronRunsHistory(RUNS_HISTORY_LIMIT),
    queryFn: () => fetchCronRunsHistory(RUNS_HISTORY_LIMIT),
    enabled: configured,
    refetchInterval: (query) => {
      const runs = query.state.data;
      return runs?.some((run) => run.status === 'running') ? 5000 : false;
    },
  });

  const runs = runsQuery.data ?? [];

  const statusLabel = useMemo(
    () => ({
      running: pm.statusRunning,
      success: pm.statusSuccess,
      failed: pm.statusFailed,
      cancelled: pm.statusCancelled,
    }),
    [pm.statusCancelled, pm.statusFailed, pm.statusRunning, pm.statusSuccess],
  );

  const cardBg = colors.surface.panel;
  const textPrimary = colors.text.primary;
  const textSecondary = colors.text.secondary;

  const statusColor = useCallback(
    (s: CronRunRow['status']) => {
      switch (s) {
        case 'success':
          return colors.semantic.success;
        case 'failed':
          return colors.semantic.error;
        case 'running':
          return colors.accent.primary;
        default:
          return textSecondary;
      }
    },
    [colors.accent.primary, colors.semantic.error, colors.semantic.success, textSecondary],
  );

  const onRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.cronRunsHistory(RUNS_HISTORY_LIMIT) });
  }, [queryClient]);

  const openRunChat = useCallback(
    (run: CronRunRow) => {
      const key = cronRunSessionKey(run);
      if (!key) return;
      openChat(router, key);
    },
    [router],
  );

  const renderRun = useCallback(
    ({ item }: { item: CronRunRow }) => {
      const jobTitle = item.jobName?.trim() || item.jobId;
      const color = statusColor(item.status);
      const sessionKey = cronRunSessionKey(item);
      const card = (
        <>
          <View style={styles.cardHeader}>
            <Icon source="play-circle-outline" size={24} color={textSecondary} />
            <View style={styles.cardTitleArea}>
              <Text style={[styles.cardTitle, { color: textPrimary }]} numberOfLines={1}>
                {jobTitle}
              </Text>
              <Text style={[styles.row, { color: textSecondary }]}>
                {item.startedAt}
                {typeof item.duration === 'number' ? ` · ${item.duration}ms` : ''}
              </Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: colors.accent.selectionBg }]}>
              <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{statusLabel[item.status]}</Text>
            </View>
            {sessionKey ? <Icon source="chevron-right" size={20} color={textSecondary} /> : null}
          </View>

          {item.summary ? (
            <Text style={[styles.summary, { color: textSecondary }]} numberOfLines={4}>
              {item.summary}
            </Text>
          ) : null}

          {item.error ? (
            <Text style={[styles.error, { color: colors.semantic.error }]} numberOfLines={3}>
              {item.error}
            </Text>
          ) : null}
        </>
      );

      if (!sessionKey) {
        return <View style={[styles.card, { backgroundColor: cardBg }]}>{card}</View>;
      }

      return (
        <Pressable
          onPress={() => openRunChat(item)}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: cardBg },
            pressed && styles.cardPressed,
          ]}
        >
          {card}
        </Pressable>
      );
    },
    [cardBg, colors.accent.selectionBg, colors.semantic.error, openRunChat, statusColor, statusLabel, textPrimary, textSecondary],
  );

  const listHeader = (
    <View style={styles.headerBlock}>
      <Text style={[styles.subtitle, { color: textSecondary }]}>{pm.subtitle}</Text>
    </View>
  );

  if (runsQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (runsQuery.isError) {
    return (
      <View style={styles.center}>
        <Text style={{ opacity: 0.6, marginBottom: 12 }}>{pm.loadFailed}</Text>
        <Button
          mode="outlined"
          onPress={() => void queryClient.invalidateQueries({ queryKey: queryKeys.cronRunsHistory(RUNS_HISTORY_LIMIT) })}
        >
          {m.common.retry}
        </Button>
      </View>
    );
  }

  return (
    <FlatList
      data={runs}
      keyExtractor={(item) => item.id}
      renderItem={renderRun}
      ListHeaderComponent={listHeader}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={runsQuery.isFetching && !runsQuery.isLoading} onRefresh={onRefresh} />
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Chip icon="playlist-remove" mode="outlined">
            {pm.empty}
          </Chip>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  list: { padding: 16, paddingTop: 0, gap: 12, flexGrow: 1 },
  headerBlock: { marginBottom: 12 },
  subtitle: { fontSize: 13, lineHeight: 18 },
  card: {
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardTitleArea: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  row: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  summary: { fontSize: 12, lineHeight: 17 },
  error: { fontSize: 12, lineHeight: 17 },
  empty: { alignItems: 'center', paddingVertical: 32 },
});
