import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Outcome, OutcomeReceipt } from '@xopcai/gateway-contract';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast } from '../../components/AppToast';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { ListSkeleton } from '../../components/ListSkeleton';
import { TOAST_BOTTOM_LIFT_ABOVE_BAR, TOAST_DURATION_SHORT } from '../../constants/toast';
import { t, useMessages } from '../../i18n/messages';
import { openNoteDetail } from '../../lib/navigation';
import { sessionDisplayName } from '../../lib/session-helpers';
import { recordUsageEvent } from '../../product/usage-metrics';
import {
  acknowledgeHomeAttention,
  fetchHome,
  respondToHomeDecision,
  retryHomeAttention,
  type HomeAttention,
  type HomeData,
  type HomeDecision,
  type HomeGateway,
  type HomeWorkflowRun,
} from '../../query/home';
import { queryKeys } from '../../query/keys';
import { fetchNotes, type NoteIndexEntry } from '../../query/notes';
import { useGatewayConfigured } from '../../query/sessions';
import { usePreferencesStore } from '../../stores/preferences-store';
import {
  FLOATING_BOTTOM_OFFSET,
  floatingBottomPadding,
  radii,
  spacing,
  typography,
  useTheme,
} from '../../theme';
import { resolveNoteListTitle } from '../notes/note-title';
import { WorkspaceSearchOverlay } from '../search/WorkspaceSearchOverlay';
import { useHomeChatPrefetch } from './use-home-chat-prefetch';
import { useWorkspaceNavigation } from './workspace-navigation-context';
import { useOptionalWorkspaceTransition } from './workspace-transition-context';

type ContinueItem = {
  id: string;
  title: string;
  meta: string;
  icon: string;
  onPress: () => void;
};

function iconForNoteKind(kind: NoteIndexEntry['kind']): string {
  if (kind === 'task') return 'checkbox-marked-circle-outline';
  if (kind === 'voice') return 'microphone-outline';
  if (kind === 'media') return 'image-outline';
  if (kind === 'bookmark') return 'bookmark-outline';
  return 'note-text-outline';
}

function timeLabel(value: string | number | undefined, hm: ReturnType<typeof useMessages>['homePage']): string {
  if (!value) return hm.recentlyUpdated;
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return hm.recentlyUpdated;
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return hm.justNow;
  if (minutes < 60) return t(hm.minutesAgo, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t(hm.hoursAgo, { n: hours });
  return t(hm.daysAgo, { n: Math.floor(hours / 24) });
}

function workflowProgress(run: HomeWorkflowRun, hm: ReturnType<typeof useMessages>['homePage']): string {
  if (run.metrics.agentCount <= 0) return hm.workflowRunning;
  return t(hm.workflowProgress, {
    done: run.metrics.doneAgentCount,
    total: run.metrics.agentCount,
  });
}

function decisionIcon(decision: HomeDecision): string {
  if (decision.kind === 'agent_judgment') return 'creation-outline';
  if (decision.kind === 'connector_approval' || decision.kind === 'goal_evidence') return 'shield-check-outline';
  if (decision.kind === 'goal') return 'target';
  return decision.reason === 'overdue' ? 'clock-alert-outline' : 'checkbox-marked-circle-outline';
}

function decisionObjectId(decision: HomeDecision): string {
  const separator = decision.id.indexOf(':');
  return separator >= 0 ? decision.id.slice(separator + 1) : decision.id;
}

export function WorkspaceHomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const configured = useGatewayConfigured();
  const language = usePreferencesStore((state) => state.language);
  const {
    openAskAi,
    prefetchAskAiSession,
    isOpeningAskAi,
    askAiError,
    dismissAskAiError,
    retryAskAi,
  } = useWorkspaceNavigation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  useHomeChatPrefetch(configured);

  useFocusEffect(useCallback(() => {
    recordUsageEvent('home_viewed');
  }, []));

  const homeQuery = useQuery({
    queryKey: [...queryKeys.home, language],
    queryFn: () => fetchHome(language),
    enabled: configured,
  });

  const home = homeQuery.data;
  const recentlyOpened = home?.recentlyOpened ?? [];
  const needsRecentNotesFallback = configured && !homeQuery.isLoading && recentlyOpened.length === 0;
  const recentNotesFallbackQuery = useQuery({
    queryKey: [...queryKeys.notesAll, 'home-preview'] as const,
    queryFn: () => fetchNotes({ limit: 3, offset: 0, sortBy: 'updatedAt', sortOrder: 'desc' }),
    enabled: needsRecentNotesFallback,
    staleTime: 60_000,
  });
  const homeNotes = recentlyOpened.length > 0
    ? recentlyOpened.slice(0, 3)
    : recentNotesFallbackQuery.data?.items.slice(0, 3) ?? [];

  const m = useMessages();
  const hm = m.homePage;

  const handleSessionPress = useCallback((sessionKey: string) => {
    recordUsageEvent('home_continue_opened');
    router.push(`/chat/${sessionKey}`);
  }, [router]);

  const handleNotePress = useCallback((note: NoteIndexEntry) => {
    recordUsageEvent('home_continue_opened');
    openNoteDetail(router, note.id);
  }, [router]);

  const continueItems = useMemo<ContinueItem[]>(() => {
    const workflowItems = (home?.workflowRuns.active ?? []).map((run) => ({
      id: `workflow:${run.id}`,
      title: run.title,
      meta: `${hm.workflowItemMeta} · ${workflowProgress(run, hm)}`,
      icon: 'source-branch-sync',
      onPress: () => run.sessionKey ? handleSessionPress(run.sessionKey) : router.push('/automation'),
    }));
    const sessionItems = (home?.recentSessions ?? []).map((session) => ({
      id: `session:${session.key}`,
      title: sessionDisplayName(session, m.sessions.untitled),
      meta: `${hm.chatItemMeta} · ${timeLabel(session.updatedAt, hm)}`,
      icon: 'message-processing-outline',
      onPress: () => handleSessionPress(session.key),
    }));
    const noteItems = homeNotes.map((note) => ({
      id: `note:${note.id}`,
      title: resolveNoteListTitle(note, hm.untitled),
      meta: `${hm.noteItemMeta} · ${timeLabel(note.lastOpenedAt ?? note.updatedAt, hm)}`,
      icon: iconForNoteKind(note.kind),
      onPress: () => handleNotePress(note),
    }));
    return [...workflowItems, ...sessionItems, ...noteItems].slice(0, 3);
  }, [handleNotePress, handleSessionPress, hm, home?.recentSessions, home?.workflowRuns.active, homeNotes, m.sessions.untitled, router]);

  const decisionMutation = useMutation({
    mutationFn: ({ id: _id, response, answer }: {
      id: string;
      response: NonNullable<HomeDecision['response']>;
      answer: 'approve' | 'deny';
    }) => respondToHomeDecision(response, answer),
    onSuccess: () => {
      recordUsageEvent('home_decision_completed');
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      setToastMessage(hm.decisionCompleted);
    },
    onError: (error) => {
      setToastMessage(error instanceof Error ? error.message : hm.decisionFailed);
    },
  });

  const attentionMutation = useMutation({
    mutationFn: async ({ item, action }: { item: HomeAttention; action: 'retry' | 'acknowledge' }) => {
      if (action === 'retry') await retryHomeAttention(item);
      else await acknowledgeHomeAttention(item);
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      setToastMessage(variables.action === 'retry' ? hm.attentionRetryStarted : hm.attentionAcknowledged);
    },
    onError: (error) => {
      setToastMessage(error instanceof Error ? error.message : hm.attentionActionFailed);
    },
  });

  const openDecision = useCallback((decision: HomeDecision) => {
    recordUsageEvent('home_decision_opened');
    const objectId = decisionObjectId(decision);
    if (decision.kind === 'agent_judgment' && decision.judgment) router.push({ pathname: '/inbox', params: { item: decision.judgment.inboxItemId } });
    else if (decision.kind === 'work_item') router.push(`/work/${objectId}`);
    else router.push('/work');
  }, [router]);

  const openAttention = useCallback((item: HomeAttention) => {
    if (item.kind === 'workflow_run' && item.sessionKey) {
      router.push(`/chat/${item.sessionKey}`);
      return;
    }
    router.push({ pathname: '/automation', params: { run: item.runId } });
  }, [router]);

  const refresh = useCallback(async () => {
    await homeQuery.refetch();
    if (needsRecentNotesFallback) await recentNotesFallbackQuery.refetch();
    prefetchAskAiSession();
  }, [homeQuery, needsRecentNotesFallback, prefetchAskAiSession, recentNotesFallbackQuery]);

  const capture = useCallback(() => {
    recordUsageEvent('capture_started');
    router.push({ pathname: '/inbox', params: { capture: '1' } });
  }, [router]);

  const askAi = useCallback(() => {
    recordUsageEvent('ask_ai_started');
    openAskAi();
  }, [openAskAi]);

  if (!configured) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
        <NativeScreenHeader
          showLogo
          title="xopc"
          rightIcon="cog-outline"
          onRightPress={() => router.push('/settings')}
        />
        <View style={styles.centerContent}>
          <Icon source="cloud-off-outline" size={42} color={colors.text.tertiary} />
          <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>{hm.connectGatewayTitle}</Text>
          <Text style={[styles.emptyText, { color: colors.text.secondary }]}>{hm.connectGatewayHint}</Text>
          <Pressable
            style={[styles.connectButton, { backgroundColor: colors.accent.primary }]}
            onPress={() => router.push('/settings/gateway')}
            accessibilityRole="button"
          >
            <Text style={[styles.connectButtonText, { color: colors.accent.onPrimary }]}>{hm.connectGatewayAction}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader
        showLogo
        title="xopc"
        rightActions={[
          { icon: 'magnify', onPress: () => setSearchOpen(true), accessibilityLabel: m.common.search },
          { icon: 'cog-outline', onPress: () => router.push('/settings'), accessibilityLabel: m.settings.title },
        ]}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: floatingBottomPadding(insets.bottom) + FLOATING_BOTTOM_OFFSET + 88 },
        ]}
        refreshControl={(
          <RefreshControl
            refreshing={homeQuery.isFetching && !homeQuery.isLoading}
            onRefresh={() => void refresh()}
          />
        )}
      >
        {homeQuery.isLoading ? (
          <HomeSkeleton />
        ) : homeQuery.isError || !home ? (
          <HomeLoadError
            onRetry={() => void homeQuery.refetch()}
            retrying={homeQuery.isFetching}
          />
        ) : (
          <>
            <HomeGatewayStatus gateway={home.gateway} />
            <BriefingCard
              briefing={home.briefing}
              primaryDecision={home.decisions[0]}
              needsAttention={home.decisions.length + home.attention.length > 0}
              onPrimaryPress={openDecision}
            />
            <AttentionSection
              items={home.attention.slice(0, 3)}
              pendingId={attentionMutation.isPending ? attentionMutation.variables.item.id : undefined}
              onOpen={openAttention}
              onAction={(item, action) => attentionMutation.mutate({ item, action })}
            />
            <DecisionSection
              decisions={home.decisions.slice(0, 3)}
              pendingDecisionId={decisionMutation.isPending ? decisionMutation.variables.id : undefined}
              onOpen={openDecision}
              onRespond={(decision, answer) => {
                if (decision.response) decisionMutation.mutate({ id: decision.id, response: decision.response, answer });
              }}
            />
            <OutcomeProgressSection
              title={hm.sectionOutcomesNeedsYou}
              items={home.outcomes.needsUser.slice(0, 3)}
              statusLabel={hm.outcomeStatusNeedsYou}
              icon="account-alert-outline"
              onOpen={(item) => router.push(`/outcomes/${item.id}`)}
            />
            <OutcomeProgressSection
              title={hm.sectionOutcomesRunning}
              items={home.outcomes.running.slice(0, 3)}
              statusLabel={hm.outcomeStatusRunning}
              icon="progress-clock"
              onOpen={(item) => router.push(`/outcomes/${item.id}`)}
            />
            <OutcomeSection
              items={home.recentOutcomes.slice(0, 3)}
              onOpen={(receipt) => receipt.outcomeId
                ? router.push(`/outcomes/${receipt.outcomeId}`)
                : receipt.projectId
                ? router.push(`/projects/${receipt.projectId}`)
                : router.push(`/chat/${receipt.sessionKey}`)}
            />
            <ContinueSection items={continueItems} />
            <LibrarySection
              inboxCount={home.inboxCount}
              onWork={() => router.push('/work')}
              onProjects={() => router.push('/projects')}
              onInbox={() => router.push('/inbox')}
              onNotes={() => router.push('/notes')}
              onSessions={() => router.push('/sessions')}
              onFiles={() => router.push('/files')}
            />
          </>
        )}
      </ScrollView>
      <WorkspaceActionDock
        onCapture={capture}
        onAskAi={askAi}
        askAiPending={isOpeningAskAi}
      />
      <WorkspaceSearchOverlay visible={searchOpen} onClose={() => setSearchOpen(false)} />
      <AppToast
        visible={Boolean(toastMessage || askAiError)}
        onDismiss={askAiError ? dismissAskAiError : () => setToastMessage('')}
        duration={TOAST_DURATION_SHORT}
        bottomLift={TOAST_BOTTOM_LIFT_ABOVE_BAR}
        action={askAiError ? { label: m.common.retry, onPress: retryAskAi } : undefined}
      >
        {askAiError ?? toastMessage}
      </AppToast>
    </View>
  );
}

function HomeSkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      <ListSkeleton count={3} />
      <ListSkeleton count={2} />
    </View>
  );
}

function HomeLoadError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  return (
    <View style={styles.loadError}>
      <Icon source="cloud-alert-outline" size={42} color={colors.text.tertiary} />
      <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>{hm.loadFailed}</Text>
      <Text style={[styles.emptyText, { color: colors.text.secondary }]}>{hm.loadFailedHint}</Text>
      <Pressable
        style={[styles.retryButton, { backgroundColor: colors.accent.primary }]}
        onPress={onRetry}
        disabled={retrying}
        accessibilityRole="button"
        accessibilityState={{ disabled: retrying, busy: retrying }}
      >
        {retrying ? <ActivityIndicator size={18} color={colors.accent.onPrimary} /> : null}
        <Text style={[styles.retryButtonText, { color: colors.accent.onPrimary }]}>{hm.retry}</Text>
      </Pressable>
    </View>
  );
}

function HomeGatewayStatus({ gateway }: { gateway: HomeGateway }) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  if (gateway.ready) return null;
  return (
    <View style={[styles.statusBanner, { backgroundColor: colors.surface.grouped }]}>
      <Icon source="progress-clock" size={16} color={colors.semantic.warning} />
      <Text style={[styles.statusText, { color: colors.text.secondary }]}>{hm.gatewayStartingStatus}</Text>
    </View>
  );
}

function BriefingCard({
  briefing,
  primaryDecision,
  needsAttention,
  onPrimaryPress,
}: {
  briefing: HomeData['briefing'];
  primaryDecision?: HomeDecision;
  needsAttention: boolean;
  onPrimaryPress: (decision: HomeDecision) => void;
}) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  return (
    <View style={[styles.briefingCard, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
      <View style={[styles.briefingMark, { backgroundColor: colors.accent.soft }]}>
        <Icon source={needsAttention ? 'lightning-bolt-outline' : 'check'} size={20} color={colors.accent.primary} />
      </View>
      <Text style={[styles.briefingTitle, { color: colors.text.primary }]}>
        {needsAttention ? hm.briefingNeedsYou : hm.briefingClear}
      </Text>
      <Text style={[styles.briefingSummary, { color: colors.text.secondary }]}>{briefing.summary}</Text>
      {briefing.progress.movingCount > 0 ? (
        <Text style={[styles.briefingProgress, { color: colors.text.tertiary }]}>
          {t(hm.briefingMoving, { count: briefing.progress.movingCount })}
        </Text>
      ) : null}
      {primaryDecision && !primaryDecision.response ? (
        <Pressable
          style={({ pressed }) => [
            styles.briefingAction,
            { backgroundColor: pressed ? colors.accent.primaryHover : colors.accent.primary },
          ]}
          onPress={() => onPrimaryPress(primaryDecision)}
          accessibilityRole="button"
        >
          <Text style={[styles.briefingActionText, { color: colors.accent.onPrimary }]}>{hm.reviewNow}</Text>
          <Icon source="arrow-right" size={18} color={colors.accent.onPrimary} />
        </Pressable>
      ) : null}
    </View>
  );
}

function AttentionSection({
  items,
  pendingId,
  onOpen,
  onAction,
}: {
  items: HomeAttention[];
  pendingId?: string;
  onOpen: (item: HomeAttention) => void;
  onAction: (item: HomeAttention, action: 'retry' | 'acknowledge') => void;
}) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  if (items.length === 0) return null;
  return (
    <Section title={hm.sectionRunIssues}>
      <View style={[styles.groupedList, { backgroundColor: colors.surface.panel }]}>
        {items.map((item, index) => {
          const pending = pendingId === item.id;
          return (
            <View key={item.id}>
              <Pressable style={styles.decisionRow} onPress={() => onOpen(item)} accessibilityRole="button">
                <Icon source="alert-circle-outline" size={20} color={colors.semantic.error} />
                <View style={styles.rowCopy}>
                  <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text.primary }]}>{item.title}</Text>
                  <Text numberOfLines={3} style={[styles.rowSubtitle, { color: colors.text.secondary }]}>{item.detail}</Text>
                </View>
                <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
              </Pressable>
              <View style={styles.decisionActions}>
                <Pressable
                  style={[styles.decisionButton, { backgroundColor: colors.surface.grouped }]}
                  onPress={() => onAction(item, 'acknowledge')}
                  disabled={pending}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: pending, busy: pending }}
                >
                  <Text style={[styles.decisionButtonText, { color: colors.text.secondary }]}>{hm.attentionAcknowledge}</Text>
                </Pressable>
                <Pressable
                  style={[styles.decisionButton, { backgroundColor: colors.accent.primary }]}
                  onPress={() => onAction(item, 'retry')}
                  disabled={pending}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: pending, busy: pending }}
                >
                  {pending ? <ActivityIndicator size={16} color={colors.accent.onPrimary} /> : null}
                  <Text style={[styles.decisionButtonText, { color: colors.accent.onPrimary }]}>{hm.attentionRetry}</Text>
                </Pressable>
              </View>
              {index < items.length - 1 ? <View style={[styles.divider, { backgroundColor: colors.border.subtle }]} /> : null}
            </View>
          );
        })}
      </View>
    </Section>
  );
}

function DecisionSection({
  decisions,
  pendingDecisionId,
  onOpen,
  onRespond,
}: {
  decisions: HomeDecision[];
  pendingDecisionId?: string;
  onOpen: (decision: HomeDecision) => void;
  onRespond: (decision: HomeDecision, answer: 'approve' | 'deny') => void;
}) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  if (decisions.length === 0) return null;
  return (
    <Section title={hm.sectionAttention}>
      <View style={[styles.groupedList, { backgroundColor: colors.surface.panel }]}>
        {decisions.map((decision, index) => {
          const pending = pendingDecisionId === decision.id;
          return (
            <View key={decision.id}>
              <Pressable
                style={styles.decisionRow}
                onPress={() => onOpen(decision)}
                accessibilityRole="button"
              >
                <Icon source={decisionIcon(decision)} size={20} color={colors.semantic.warning} />
                <View style={styles.rowCopy}>
                  <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text.primary }]}>{decision.title}</Text>
                  <Text numberOfLines={2} style={[styles.rowSubtitle, { color: colors.text.secondary }]}>
                    {decision.detail || hm.decisionNeedsReview}
                  </Text>
                </View>
                {!decision.response ? <Icon source="chevron-right" size={18} color={colors.text.tertiary} /> : null}
              </Pressable>
              {decision.response ? (
                <View style={styles.decisionActions}>
                  <Pressable
                    style={[styles.decisionButton, { backgroundColor: colors.surface.grouped }]}
                    onPress={() => onRespond(decision, 'deny')}
                    disabled={pending}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: pending, busy: pending }}
                  >
                    <Text style={[styles.decisionButtonText, { color: colors.text.secondary }]}>{hm.deny}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.decisionButton, { backgroundColor: colors.accent.primary }]}
                    onPress={() => onRespond(decision, 'approve')}
                    disabled={pending}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: pending, busy: pending }}
                  >
                    {pending ? <ActivityIndicator size={16} color={colors.accent.onPrimary} /> : null}
                    <Text style={[styles.decisionButtonText, { color: colors.accent.onPrimary }]}>{hm.approve}</Text>
                  </Pressable>
                </View>
              ) : null}
              {index < decisions.length - 1 ? <View style={[styles.divider, { backgroundColor: colors.border.subtle }]} /> : null}
            </View>
          );
        })}
      </View>
    </Section>
  );
}

function ContinueSection({ items }: { items: ContinueItem[] }) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  if (items.length === 0) return null;
  return (
    <Section title={hm.sectionContinue}>
      <View style={[styles.groupedList, { backgroundColor: colors.surface.panel }]}>
        {items.map((item, index) => (
          <Pressable
            key={item.id}
            style={styles.listRow}
            onPress={item.onPress}
            accessibilityRole="button"
          >
            <Icon source={item.icon} size={20} color={colors.accent.primary} />
            <View style={styles.rowCopy}>
              <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text.primary }]}>{item.title}</Text>
              <Text numberOfLines={1} style={[styles.rowSubtitle, { color: colors.text.tertiary }]}>{item.meta}</Text>
            </View>
            <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
            {index < items.length - 1 ? <View style={[styles.rowDivider, { backgroundColor: colors.border.subtle }]} /> : null}
          </Pressable>
        ))}
      </View>
    </Section>
  );
}

function OutcomeProgressSection({
  title,
  items,
  statusLabel,
  icon,
  onOpen,
}: {
  title: string;
  items: Outcome[];
  statusLabel: string;
  icon: string;
  onOpen: (outcome: Outcome) => void;
}) {
  const { colors } = useTheme();
  if (items.length === 0) return null;
  return (
    <Section title={title}>
      <View style={[styles.groupedList, { backgroundColor: colors.surface.panel }]}>
        {items.map((item, index) => (
          <Pressable key={item.id} style={styles.listRow} onPress={() => onOpen(item)} accessibilityRole="button">
            <Icon source={icon} size={20} color={colors.accent.primary} />
            <View style={styles.rowCopy}>
              <Text numberOfLines={2} style={[styles.rowTitle, { color: colors.text.primary }]}>{item.objective}</Text>
              <Text style={[styles.rowSubtitle, { color: colors.text.tertiary }]}>{statusLabel}</Text>
            </View>
            <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
            {index < items.length - 1 ? <View style={[styles.rowDivider, { backgroundColor: colors.border.subtle }]} /> : null}
          </Pressable>
        ))}
      </View>
    </Section>
  );
}

function OutcomeSection({
  items,
  onOpen,
}: {
  items: OutcomeReceipt[];
  onOpen: (receipt: OutcomeReceipt) => void;
}) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  if (items.length === 0) return null;
  return (
    <Section title={hm.sectionRecentOutcomes}>
      <View style={[styles.groupedList, { backgroundColor: colors.surface.panel }]}>
        {items.map((item, index) => (
          <Pressable key={item.runId} style={styles.listRow} onPress={() => onOpen(item)} accessibilityRole="button">
            <Icon source="check-circle-outline" size={20} color={colors.semantic.success} />
            <View style={styles.rowCopy}>
              <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text.primary }]}>{item.objective}</Text>
              <Text numberOfLines={2} style={[styles.rowSubtitle, { color: colors.text.secondary }]}>{item.summary}</Text>
            </View>
            <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
            {index < items.length - 1 ? <View style={[styles.rowDivider, { backgroundColor: colors.border.subtle }]} /> : null}
          </Pressable>
        ))}
      </View>
    </Section>
  );
}

function LibrarySection({
  inboxCount,
  onWork,
  onProjects,
  onInbox,
  onNotes,
  onSessions,
  onFiles,
}: {
  inboxCount: number;
  onWork: () => void;
  onProjects: () => void;
  onInbox: () => void;
  onNotes: () => void;
  onSessions: () => void;
  onFiles: () => void;
}) {
  const { homePage: hm } = useMessages();
  return (
    <Section title={hm.sectionLibrary}>
      <LibraryRow icon="briefcase-outline" label={hm.libraryWork} onPress={onWork} />
      <LibraryRow icon="folder-multiple-outline" label={hm.libraryProjects} onPress={onProjects} />
      <LibraryRow icon="tray-arrow-down" label={hm.inboxMetric} value={inboxCount > 0 ? String(inboxCount) : undefined} onPress={onInbox} />
      <LibraryRow icon="note-text-outline" label={hm.libraryNotes} onPress={onNotes} />
      <LibraryRow icon="message-processing-outline" label={hm.librarySessions} onPress={onSessions} />
      <LibraryRow icon="folder-outline" label={hm.libraryFiles} onPress={onFiles} last />
    </Section>
  );
}

function LibraryRow({
  icon,
  label,
  value,
  onPress,
  last = false,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress: () => void;
  last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.libraryRow,
        { backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel },
        !last && { borderBottomColor: colors.border.subtle, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Icon source={icon} size={20} color={colors.text.secondary} />
      <Text style={[styles.libraryLabel, { color: colors.text.primary }]}>{label}</Text>
      {value ? <Text style={[styles.libraryValue, { color: colors.text.tertiary }]}>{value}</Text> : null}
      <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function WorkspaceActionDock({
  onCapture,
  onAskAi,
  askAiPending,
}: {
  onCapture: () => void;
  onAskAi: () => void;
  askAiPending: boolean;
}) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  const insets = useSafeAreaInsets();
  const transition = useOptionalWorkspaceTransition();
  const askAiRef = useRef<View>(null);

  useEffect(() => {
    if (!transition) return;
    transition.registerPillMeasurer(async () => new Promise((resolve) => {
      const node = askAiRef.current;
      if (!node) {
        resolve(null);
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
      });
    }));
    return () => transition?.registerPillMeasurer(null);
  }, [transition]);

  return (
    <View pointerEvents="box-none" style={[styles.dockWrap, { paddingBottom: floatingBottomPadding(insets.bottom) + FLOATING_BOTTOM_OFFSET }]}>
      <View style={[styles.dock, { backgroundColor: colors.surface.elevated, borderColor: colors.border.default }]}>
        <Pressable
          ref={askAiRef}
          style={({ pressed }) => [styles.dockSecondary, pressed && { backgroundColor: colors.surface.pressed }]}
          onPress={onAskAi}
          disabled={askAiPending}
          accessibilityRole="button"
          accessibilityLabel={hm.askAi}
          accessibilityState={{ disabled: askAiPending, busy: askAiPending }}
        >
          {askAiPending
            ? <ActivityIndicator size={18} color={colors.accent.primary} />
            : <Icon source="creation-outline" size={19} color={colors.accent.primary} />}
          <Text style={[styles.dockLabel, { color: colors.text.primary }]}>{hm.askAi}</Text>
        </Pressable>
        <Pressable
          style={[styles.dockPrimary, { backgroundColor: colors.accent.primary }]}
          onPress={onCapture}
          accessibilityRole="button"
          accessibilityLabel={hm.commandCapture}
        >
          <Icon source="plus" size={20} color={colors.accent.onPrimary} />
          <Text style={[styles.dockLabel, { color: colors.accent.onPrimary }]}>{hm.commandCapture}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.content, paddingTop: spacing.sm, gap: spacing.section },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl, gap: spacing.md },
  emptyTitle: { ...typography.heading },
  emptyText: { ...typography.body, textAlign: 'center' },
  connectButton: { minHeight: 48, borderRadius: radii.xxl, justifyContent: 'center', paddingHorizontal: spacing.xl, marginTop: spacing.sm },
  connectButtonText: { ...typography.ui, fontWeight: '600' },
  skeletonWrap: { gap: spacing.section },
  loadError: { minHeight: 280, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl, gap: spacing.md },
  retryButton: { minHeight: 48, borderRadius: radii.xxl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, marginTop: spacing.sm },
  retryButtonText: { ...typography.ui, fontWeight: '600' },
  statusBanner: { minHeight: 36, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  statusText: { ...typography.caption, fontWeight: '500' },
  briefingCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.content, gap: spacing.sm },
  briefingMark: { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  briefingTitle: { ...typography.title },
  briefingSummary: { ...typography.body },
  briefingProgress: { ...typography.caption },
  briefingAction: { minHeight: 48, borderRadius: radii.xxl, marginTop: spacing.sm, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  briefingActionText: { ...typography.ui, fontWeight: '600' },
  section: { gap: spacing.md },
  sectionBody: { borderRadius: radii.lg, overflow: 'hidden' },
  sectionTitle: { ...typography.heading },
  groupedList: { borderRadius: radii.lg, overflow: 'hidden' },
  decisionRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  decisionActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  decisionButton: { minWidth: 84, minHeight: 44, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
  decisionButtonText: { ...typography.ui, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 52 },
  listRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  rowCopy: { flex: 1, gap: spacing.xxs },
  rowTitle: { ...typography.ui, fontWeight: '600' },
  rowSubtitle: { ...typography.caption },
  rowDivider: { position: 'absolute', left: 52, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  libraryRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  libraryLabel: { ...typography.ui, flex: 1 },
  libraryValue: { ...typography.label },
  dockWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingHorizontal: spacing.content },
  dock: { minHeight: 58, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth, padding: spacing.xs, flexDirection: 'row', gap: spacing.xs },
  dockSecondary: { minHeight: 48, minWidth: 112, borderRadius: radii.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  dockPrimary: { minHeight: 48, minWidth: 124, borderRadius: radii.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  dockLabel: { ...typography.ui, fontWeight: '600' },
});
