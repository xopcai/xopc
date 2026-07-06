import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Chip, Icon, IconButton, Text } from 'react-native-paper';

import { AppToast } from '../../components/AppToast';
import { TOAST_DURATION_DEFAULT } from '../../constants/toast';

import { useMessages } from '../../i18n/messages';
import {
  cronJobMessage,
  fetchCronJobs,
  isEditableCronJob,
  runCronJobNow,
  RUNS_HISTORY_LIMIT,
  toggleCronJob,
  type CronJob,
} from '../../query/cron';
import { queryKeys } from '../../query/keys';
import { useGatewayConfigured } from '../../query/sessions';
import { usePreferencesStore } from '../../stores/preferences-store';
import { useTheme } from '../../theme';

import { formatScheduleLabel } from './cron-schedule';

export function SchedulesList() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const configured = useGatewayConfigured();
  const m = useMessages();
  const pm = m.schedulesPage;
  const lang = usePreferencesStore((s) => s.language);
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
  const [snackbarMessage, setSnackbarMessage] = useState('');

  const jobsQuery = useQuery({
    queryKey: queryKeys.cronJobs,
    queryFn: fetchCronJobs,
    enabled: configured,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => toggleCronJob(id, enabled),
    onSuccess: async (_data, variables) => {
      setSnackbarMessage(variables.enabled ? pm.enabledToast : pm.disabledToast);
      await queryClient.invalidateQueries({ queryKey: queryKeys.cronJobs });
    },
    onError: (error) => {
      setSnackbarMessage(error instanceof Error ? error.message : pm.actionFailed);
    },
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => runCronJobNow(id),
    onSuccess: async () => {
      setSnackbarMessage(pm.runStartedToast);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.cronJobs }),
        queryClient.invalidateQueries({ queryKey: queryKeys.cronRunsHistory(RUNS_HISTORY_LIMIT) }),
      ]);
    },
    onError: (error) => {
      setSnackbarMessage(error instanceof Error ? error.message : pm.actionFailed);
    },
  });

  const jobs = jobsQuery.data ?? [];

  const cardBg = colors.surface.panel;
  const textPrimary = colors.text.primary;
  const textSecondary = colors.text.secondary;
  const enabledColor = colors.semantic.success;
  const disabledColor = colors.semantic.error;

  const scheduleLabels = {
    every15Min: pm.every15Min,
    every30Min: pm.every30Min,
    everyHour: pm.everyHour,
    dailyAt: pm.dailyAt,
    weekdaysAt: pm.weekdaysAt,
  };

  const onRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.cronJobs });
  }, [queryClient]);

  const openJob = useCallback(
    (job: CronJob) => {
      if (!isEditableCronJob(job)) {
        setSnackbarMessage(pm.notEditable);
        return;
      }
      router.push({ pathname: '/automation/form', params: { id: job.id } });
    },
    [pm.notEditable, router],
  );

  const renderJob = useCallback(
    ({ item }: { item: CronJob }) => {
      const title = item.name?.trim() || pm.unnamedJob;
      const preview = cronJobMessage(item);
      const scheduleText = formatScheduleLabel(item.schedule, locale, scheduleLabels);
      const statusText = item.enabled ? pm.enabled : pm.disabled;
      const statusColor = item.enabled ? enabledColor : disabledColor;
      const actionInFlight = toggleMutation.isPending || runMutation.isPending;
      const isTogglingThisJob = toggleMutation.isPending && toggleMutation.variables?.id === item.id;
      const isRunningThisJob = runMutation.isPending && runMutation.variables === item.id;

      return (
        <Pressable
          onPress={() => openJob(item)}
          style={[styles.card, { backgroundColor: cardBg }]}
        >
          <View style={styles.cardHeader}>
            <Icon source="clock-outline" size={24} color={textSecondary} />
            <View style={styles.cardTitleArea}>
              <Text style={[styles.cardTitle, { color: textPrimary }]} numberOfLines={1}>
                {title}
              </Text>
              <Text style={[styles.scheduleText, { color: textSecondary }]} numberOfLines={1}>
                {scheduleText}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: item.enabled ? colors.accent.selectionBg : colors.surface.input }]}>
              <Text style={{ color: statusColor, fontSize: 12, fontWeight: '600' }}>
                {statusText}
              </Text>
            </View>
          </View>

          {item.next_run ? (
            <Text style={[styles.label, { color: textSecondary }]}>
              {pm.nextRun}:{' '}
              <Text style={{ color: textPrimary }}>{item.next_run}</Text>
            </Text>
          ) : null}

          {preview ? (
            <Text style={[styles.preview, { color: textSecondary }]} numberOfLines={2}>
              {preview}
            </Text>
          ) : null}

          <View style={styles.actionsRow}>
            <Button
              mode="contained-tonal"
              compact
              icon="play"
              onPress={() => runMutation.mutate(item.id)}
              loading={isRunningThisJob}
              disabled={actionInFlight}
            >
              {pm.runNow}
            </Button>
            <Button
              mode="outlined"
              compact
              icon={item.enabled ? 'pause' : 'play-pause'}
              onPress={() => toggleMutation.mutate({ id: item.id, enabled: !item.enabled })}
              loading={isTogglingThisJob}
              disabled={actionInFlight}
            >
              {item.enabled ? pm.disable : pm.enable}
            </Button>
            {isEditableCronJob(item) ? (
              <IconButton
                icon="pencil-outline"
                size={20}
                onPress={() => openJob(item)}
                disabled={actionInFlight}
              />
            ) : null}
          </View>
        </Pressable>
      );
    },
    [
      cardBg,
      colors.accent.selectionBg,
      colors.surface.input,
      disabledColor,
      enabledColor,
      locale,
      openJob,
      pm,
      runMutation,
      scheduleLabels,
      textPrimary,
      textSecondary,
      toggleMutation,
    ],
  );

  const listHeader = (
    <View style={styles.headerBlock}>
      <Text style={[styles.subtitle, { color: textSecondary }]}>{pm.subtitle}</Text>
    </View>
  );

  if (jobsQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (jobsQuery.isError) {
    return (
      <View style={styles.center}>
        <Text style={{ opacity: 0.6, marginBottom: 12 }}>{pm.loadFailed}</Text>
        <Button mode="outlined" onPress={() => void queryClient.invalidateQueries({ queryKey: queryKeys.cronJobs })}>
          {m.common.retry}
        </Button>
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={renderJob}
        ListHeaderComponent={listHeader}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={jobsQuery.isFetching && !jobsQuery.isLoading} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Chip icon="timer-off-outline" mode="outlined">
              {pm.empty}
            </Chip>
            <Button mode="contained" icon="plus" onPress={() => router.push('/automation/form')} style={styles.emptyCta}>
              {pm.createFirst}
            </Button>
          </View>
        }
      />
      <AppToast
        visible={Boolean(snackbarMessage)}
        onDismiss={() => setSnackbarMessage('')}
        duration={TOAST_DURATION_DEFAULT}
      >
        {snackbarMessage}
      </AppToast>
    </>
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
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardTitleArea: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  scheduleText: { fontSize: 13, marginTop: 2 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  label: { fontSize: 13, lineHeight: 18 },
  preview: { fontSize: 12, lineHeight: 17 },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 16 },
  emptyCta: { marginTop: 4 },
});
