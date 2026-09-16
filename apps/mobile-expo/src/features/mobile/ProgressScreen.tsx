import { useMutation, useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { AppToast } from '../../components/AppToast';
import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { fetchTasks } from '../../query/tasks';
import { useGatewayConfigured } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import { spacing, typography, useTheme } from '../../theme';
import { AttentionItemRow } from '../attention/AttentionItemRow';
import { useAttentionActions } from '../attention/use-attention-actions';
import { useAttentionFeed } from '../attention/use-attention-feed';
import { HubEmpty, HubRow, HubSection } from './HubComponents';
import { recentClosedTasks } from './progress-sections';

export function ProgressScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const messages = useMessages();
  const m = messages.mobileExperience;
  const home = useAttentionFeed();
  const actions = useAttentionActions();
  const configured = useGatewayConfigured();
  const gatewayId = useGatewayStore(s => s.activeGatewayId);
  const tasks = useQuery({ queryKey: ['tasks', 'mobile-progress', gatewayId], queryFn: () => fetchTasks(), enabled: configured, refetchInterval: 15_000 });
  const { refetch: refreshHome } = home;
  const { refetch: refreshTasks } = tasks;
  const refresh = useCallback(async () => { if (configured) await Promise.all([refreshHome(), refreshTasks()]); }, [configured, refreshHome, refreshTasks]);
  const refreshMutation = useMutation({ mutationFn: refresh });
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const closed = recentClosedTasks(tasks.data ?? []);
  return <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
    <NativeScreenHeader title={m.progress} largeTitle rightActions={[{ icon: 'format-list-checks', accessibilityLabel: m.allWork, onPress: () => router.push('/tasks') }]} />
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshMutation.isPending} onRefresh={() => { if (!refreshMutation.isPending) refreshMutation.mutate(); }} />}>
      <Text style={[styles.subtitle, { color: colors.text.secondary }]}>{m.progressHint}</Text>
      {!configured ? <HubEmpty text={m.connectHint} /> : home.isLoading ? <ListSkeleton count={4} /> : <>
        {home.isError ? <HubRow title={m.loadFailed} summary={m.retry} icon="refresh" onPress={refresh} /> : <>
          <HubSection title={m.needsYou}>
            {home.data?.needsUser.length ? home.data.needsUser.map(item => <AttentionItemRow key={item.id} item={item} pending={actions.pending} onAction={actions.runAction} />) : <HubEmpty text={m.nothingNeeded} />}
          </HubSection>
          <HubSection title={m.ongoing}>
            {home.data?.background.length ? home.data.background.map(item => <HubRow key={item.id} title={item.title} summary={[item.statusLabel, item.summary].filter(Boolean).join(' · ')} icon="progress-clock" onPress={() => item.openAction && actions.runAction(item.openAction)} />) : <HubEmpty text={m.nothingRunning} />}
          </HubSection>
        </>}
        <HubSection title={m.recentClosed}>
          {tasks.isLoading ? <ListSkeleton count={2} /> : tasks.isError ? <HubRow title={m.loadFailed} icon="refresh" onPress={() => void tasks.refetch()} /> : closed.length ? closed.map(({ task }) => <HubRow key={task.id} title={task.title} summary={task.resolution ? m.closedState[task.resolution] : undefined} icon="check-circle-outline" onPress={() => router.push(`/tasks/${task.id}`)} />) : <HubEmpty text={m.noClosed} />}
        </HubSection>
      </>}
      <HubRow title={m.allWork} icon="folder-multiple-outline" onPress={() => router.push('/tasks')} />
      <HubRow title={messages.drawer.projects} icon="folder-outline" onPress={() => router.push('/projects')} />
      <HubRow title={messages.workflowsPage.title} icon="source-branch" onPress={() => router.push('/workflows')} />
      <HubRow title={messages.automationPage.title} icon="clock-outline" onPress={() => router.push('/automation')} />
    </ScrollView>
    <AppToast visible={Boolean(actions.feedback)} onDismiss={actions.clearFeedback}>{actions.feedback}</AppToast>
  </View>;
}

const styles = StyleSheet.create({ screen: { flex: 1 }, content: { padding: spacing.content, paddingBottom: spacing.section }, subtitle: { ...typography.body, marginBottom: spacing.section } });
