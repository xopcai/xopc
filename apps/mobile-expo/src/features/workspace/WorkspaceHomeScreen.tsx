import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast } from '../../components/AppToast';
import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { TOAST_BOTTOM_LIFT_ABOVE_BAR, TOAST_DURATION_SHORT } from '../../constants/toast';
import { t, useMessages } from '../../i18n/messages';
import { openChat, openNoteDetail } from '../../lib/navigation';
import { motion, useReducedMotion } from '../../motion';
import {
  mobileAppJsStartedAt,
  recordPerformanceEvent,
  recordUsageEvent,
} from '../../product/usage-metrics';
import { fetchChatAgents, readPlaceholderAgents, type ChatAgentOption } from '../../query/agents';
import {
  acknowledgeHomeAttention,
  fetchHome,
  respondToHomeDecision,
  retryHomeAttention,
  type HomeAction,
  type HomeFocusItem,
} from '../../query/home';
import { queryKeys } from '../../query/keys';
import { fetchNotes, type NoteIndexEntry } from '../../query/notes';
import { fetchProjects, type Project } from '../../query/projects';
import {
  fetchSessionsList,
  type SessionListItem,
  useGatewayConfigured,
} from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import { usePreferencesStore } from '../../stores/preferences-store';
import {
  FLOATING_BOTTOM_OFFSET,
  floatingBottomPadding,
  radii,
  spacing,
  typography,
  useTheme,
} from '../../theme';
import { AgentAvatar } from '../ai/AgentAvatar';
import { agentDisplayDescription, agentDisplayName } from '../ai/agent-presentation';
import { readAgentUsage, sortHomeAgents, touchAgentUsage } from '../ai/agent-usage-cache';
import { subscribeGatewayEvent } from '../gateway/gateway-event-bus';
import { GatewaySwitcherSheet } from '../gateway/GatewaySwitcherSheet';
import { useGatewayHealth } from '../gateway/use-gateway-health';
import { resolveNoteListTitle } from '../notes/note-title';
import { WorkspaceSearchOverlay } from '../search/WorkspaceSearchOverlay';
import {
  homeGreetingPeriod,
  mobileRouteForHomeHref,
  rankHomeContinueCandidates,
  rankHomeRunningCandidates,
  type HomeContinueCandidate,
  type HomeRunningCandidate,
} from './home-presentation';
import { useHomeChatPrefetch } from './use-home-chat-prefetch';
import { useWorkspaceNavigation } from './workspace-navigation-context';
import { useOptionalWorkspaceTransition } from './workspace-transition-context';

type ContinueItem = {
  id: string;
  title: string;
  meta: string;
  summary?: string;
  icon: string;
  onPress: () => void;
};

type RunningItem = {
  id: string;
  title: string;
  meta: string;
  summary?: string;
  icon: string;
  onPress: () => void;
};

type RemoteHomeAction = Exclude<HomeAction, { type: 'open' | 'review_judgment' }>;

const TERMINAL_PROJECT_STATUSES = new Set(['completed', 'cancelled', 'archived']);

function iconForNoteKind(kind: NoteIndexEntry['kind']): string {
  if (kind === 'task') return 'checkbox-marked-circle-outline';
  if (kind === 'voice') return 'microphone-outline';
  if (kind === 'media') return 'image-outline';
  if (kind === 'bookmark') return 'bookmark-outline';
  return 'note-text-outline';
}

function timestampMs(value: string | number | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeLabel(value: string | number | undefined, hm: ReturnType<typeof useMessages>['homePage']): string {
  const timestamp = timestampMs(value);
  if (!timestamp) return hm.recentlyUpdated;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return hm.justNow;
  if (minutes < 60) return t(hm.minutesAgo, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t(hm.hoursAgo, { n: hours });
  return t(hm.daysAgo, { n: Math.floor(hours / 24) });
}

function sessionTitle(session: SessionListItem, fallback: string): string {
  return session.name?.trim()
    || session.title?.trim()
    || session.displayName?.trim()
    || fallback;
}

function activeProjects(projects: Project[]): Project[] {
  return projects.filter((project) => !project.status || !TERMINAL_PROJECT_STATUSES.has(project.status));
}

export function WorkspaceHomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const configured = useGatewayConfigured();
  const { gatewayOnline } = useGatewayHealth();
  const language = usePreferencesStore((state) => state.language);
  const gatewayProfiles = useGatewayStore((state) => state.profiles);
  const activeGatewayId = useGatewayStore((state) => state.activeGatewayId);
  const activeGateway = gatewayProfiles.find((profile) => profile.gatewayId === activeGatewayId) ?? null;
  const {
    openAskAi,
    prefetchAskAiSession,
    isOpeningAskAi,
    askAiError,
    dismissAskAiError,
    retryAskAi,
  } = useWorkspaceNavigation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [gatewaySwitcherVisible, setGatewaySwitcherVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const homeReadyRecorded = useRef(false);

  const m = useMessages();
  const hm = m.homePage;

  useHomeChatPrefetch(configured);

  useFocusEffect(useCallback(() => {
    recordUsageEvent('home_viewed');
  }, []));

  const homeQuery = useQuery({
    queryKey: [...queryKeys.home, language],
    queryFn: () => fetchHome(language),
    enabled: configured,
    refetchInterval: ({ state }) => state.data && (
      state.data.runningConversations.length > 0
      || state.data.background.some((item) => item.kind === 'running')
    ) ? 5_000 : false,
  });
  const recentNotesQuery = useQuery({
    queryKey: queryKeys.homeRecentNotes,
    queryFn: () => fetchNotes({ limit: 6, offset: 0, sortBy: 'updatedAt', sortOrder: 'desc' }),
    enabled: configured,
    staleTime: 60_000,
  });
  const inboxQuery = useQuery({
    queryKey: queryKeys.homeInboxCount,
    queryFn: () => fetchNotes({ status: 'inbox', limit: 1, offset: 0 }),
    enabled: configured,
    staleTime: 30_000,
  });
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessionsRecent,
    queryFn: () => fetchSessionsList({ limit: 6, offset: 0, channel: null }),
    enabled: configured,
    staleTime: 60_000,
  });
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: fetchProjects,
    enabled: configured,
    staleTime: 60_000,
  });
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents,
    queryFn: fetchChatAgents,
    enabled: configured,
    placeholderData: () => readPlaceholderAgents() ?? undefined,
    staleTime: 60_000,
  });

  const contentStillLoading = homeQuery.isLoading
    || recentNotesQuery.isLoading
    || sessionsQuery.isLoading
    || projectsQuery.isLoading;

  useEffect(() => {
    if (homeReadyRecorded.current || !configured || contentStillLoading) return;
    homeReadyRecorded.current = true;
    recordPerformanceEvent('home_content_ready', Date.now() - mobileAppJsStartedAt);
  }, [configured, contentStillLoading]);

  useEffect(() => {
    const refreshRunningState = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessionsRecent });
    };
    const unsubscribeStarted = subscribeGatewayEvent('run.started', refreshRunningState);
    const unsubscribeCompleted = subscribeGatewayEvent('run.completed', refreshRunningState);
    return () => {
      unsubscribeStarted();
      unsubscribeCompleted();
    };
  }, [queryClient]);

  const remoteActionMutation = useMutation({
    mutationFn: async (action: RemoteHomeAction) => {
      if (action.type === 'connector_decision') {
        return respondToHomeDecision(
          { kind: 'connector_approval', approvalId: action.approvalId },
          action.decision,
        );
      }
      const item = { kind: action.subjectKind, runId: action.runId };
      if (action.type === 'retry_run') return retryHomeAttention(item);
      return acknowledgeHomeAttention(item);
    },
    onSuccess: (_result, action) => {
      recordUsageEvent('home_focus_action_completed');
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      setToastMessage(
        action.type === 'connector_decision'
          ? hm.decisionCompleted
          : action.type === 'retry_run'
            ? hm.attentionRetryStarted
            : hm.attentionAcknowledged,
      );
    },
    onError: (error, action) => {
      setToastMessage(
        error instanceof Error
          ? error.message
          : action.type === 'connector_decision'
            ? hm.decisionFailed
            : hm.attentionActionFailed,
      );
    },
  });

  const runHomeAction = useCallback((action: HomeAction) => {
    if (action.type === 'open') {
      recordUsageEvent('home_continue_opened');
      router.push(mobileRouteForHomeHref(action.href) as never);
    } else if (action.type === 'review_judgment') {
      recordUsageEvent('home_continue_opened');
      router.push({ pathname: '/inbox', params: { item: action.itemId } });
    } else {
      remoteActionMutation.mutate(action);
    }
  }, [remoteActionMutation, router]);

  const activeConversationKeys = useMemo(() => new Set(
    (homeQuery.data?.runningConversations ?? []).map((item) => item.sessionKey),
  ), [homeQuery.data?.runningConversations]);

  const runningItems = useMemo<RunningItem[]>(() => {
    const candidates: HomeRunningCandidate<RunningItem>[] = [];
    const activeConversationRoutes = new Set(
      (homeQuery.data?.runningConversations ?? []).map(
        (conversation) => `/chat/${encodeURIComponent(conversation.sessionKey)}`,
      ),
    );

    for (const conversation of homeQuery.data?.runningConversations ?? []) {
      candidates.push({
        id: `conversation:${conversation.runId}`,
        kind: 'conversation',
        updatedAt: conversation.updatedAt,
        value: {
          id: `conversation:${conversation.runId}`,
          title: conversation.title?.trim() || hm.untitled,
          meta: conversation.agentId
            ? t(hm.runningConversationWithAgent, { agent: conversation.agentId })
            : hm.runningConversation,
          icon: 'message-processing-outline',
          onPress: () => {
            recordUsageEvent('home_continue_opened');
            openChat(router, conversation.sessionKey);
          },
        },
      });
    }

    for (const item of homeQuery.data?.background ?? []) {
      if (item.kind !== 'running' || !item.openAction) continue;
      const openAction = item.openAction;
      if (
        openAction.type === 'open'
        && activeConversationRoutes.has(mobileRouteForHomeHref(openAction.href))
      ) continue;
      candidates.push({
        id: item.id,
        kind: 'work',
        updatedAt: item.updatedAt,
        value: {
          id: item.id,
          title: item.title,
          meta: item.statusLabel
            ? `${hm.runningWork} · ${item.statusLabel}`
            : hm.runningWork,
          summary: item.summary,
          icon: 'progress-clock',
          onPress: () => runHomeAction(openAction),
        },
      });
    }

    return rankHomeRunningCandidates(candidates);
  }, [hm, homeQuery.data?.background, homeQuery.data?.runningConversations, router, runHomeAction]);

  const continueItems = useMemo<ContinueItem[]>(() => {
    const candidates: HomeContinueCandidate<ContinueItem>[] = [];

    for (const session of sessionsQuery.data?.items ?? []) {
      if (activeConversationKeys.has(session.key)) continue;
      candidates.push({
        id: `session:${session.key}`,
        kind: 'recent_chat',
        updatedAt: timestampMs(session.updatedAt),
        value: {
          id: `session:${session.key}`,
          title: sessionTitle(session, hm.untitled),
          meta: `${hm.chatItemMeta} · ${timeLabel(session.updatedAt, hm)}`,
          icon: 'message-processing-outline',
          onPress: () => {
            recordUsageEvent('home_continue_opened');
            openChat(router, session.key);
          },
        },
      });
    }

    for (const note of recentNotesQuery.data?.items ?? []) {
      candidates.push({
        id: `note:${note.id}`,
        kind: 'note',
        updatedAt: timestampMs(note.lastOpenedAt ?? note.updatedAt),
        value: {
          id: `note:${note.id}`,
          title: resolveNoteListTitle(note, hm.untitled),
          meta: `${hm.noteItemMeta} · ${timeLabel(note.lastOpenedAt ?? note.updatedAt, hm)}`,
          summary: note.snippet,
          icon: iconForNoteKind(note.kind),
          onPress: () => {
            recordUsageEvent('home_continue_opened');
            openNoteDetail(router, note.id);
          },
        },
      });
    }

    return rankHomeContinueCandidates(candidates, undefined).slice(0, 3);
  }, [activeConversationKeys, hm, recentNotesQuery.data?.items, router, sessionsQuery.data?.items]);

  const homeAgents = useMemo(() => sortHomeAgents(
    agentsQuery.data?.items ?? [],
    readAgentUsage(activeGatewayId),
    agentsQuery.data?.defaultId,
  ).slice(0, 4), [activeGatewayId, agentsQuery.data]);

  const handleAgentPress = useCallback((agent: ChatAgentOption) => {
    recordUsageEvent('ask_ai_started');
    touchAgentUsage(activeGatewayId, agent.id);
    openAskAi(agent.id);
  }, [activeGatewayId, openAskAi]);

  const refresh = useCallback(async () => {
    await Promise.allSettled([
      homeQuery.refetch(),
      recentNotesQuery.refetch(),
      inboxQuery.refetch(),
      sessionsQuery.refetch(),
      projectsQuery.refetch(),
      agentsQuery.refetch(),
    ]);
    prefetchAskAiSession();
  }, [agentsQuery, homeQuery, inboxQuery, prefetchAskAiSession, projectsQuery, recentNotesQuery, sessionsQuery]);

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

  const projects = activeProjects(projectsQuery.data ?? []);
  const movingCount = projects.reduce((total, project) => total + project.operating.counts.moving, 0);
  const scheduledCount = (homeQuery.data?.background ?? []).filter((item) => item.kind === 'scheduled').length;
  const initialLoading = contentStillLoading || inboxQuery.isLoading || agentsQuery.isLoading;
  const refreshing = !initialLoading && (homeQuery.isFetching
    || recentNotesQuery.isFetching
    || inboxQuery.isFetching
    || sessionsQuery.isFetching
    || projectsQuery.isFetching
    || agentsQuery.isFetching);

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader
        showLogo
        title={gatewayProfiles.length > 1 ? activeGateway?.name ?? 'xopc' : 'xopc'}
        onTitlePress={gatewayProfiles.length > 1
          ? () => setGatewaySwitcherVisible(true)
          : undefined}
        titleAccessibilityLabel={m.gateway.switcher.title}
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <HomeGreeting
          language={language}
          gatewayOnline={gatewayOnline}
          starting={homeQuery.isLoading}
          onGatewayPress={() => {
            if (gatewayProfiles.length > 1) setGatewaySwitcherVisible(true);
            else router.push('/settings/gateway');
          }}
        />
        {homeQuery.isError && gatewayOnline ? (
          <HomeLoadError onRetry={() => void homeQuery.refetch()} retrying={homeQuery.isFetching} />
        ) : null}
        <RunningSection
          items={runningItems}
          loading={runningItems.length === 0 && homeQuery.isLoading}
        />
        <ContinueSection
          items={continueItems}
          loading={continueItems.length === 0 && contentStillLoading}
        />
        <NeedsYouSection
          items={homeQuery.data?.needsUser ?? []}
          pending={remoteActionMutation.isPending}
          onAction={runHomeAction}
        />
        <AgentsSection
          agents={homeAgents}
          defaultAgentId={agentsQuery.data?.defaultId}
          loading={agentsQuery.isLoading}
          pending={isOpeningAskAi}
          onAgentPress={handleAgentPress}
          onManage={() => router.push('/ai/agents')}
        />
        <LibrarySection
          inboxCount={inboxQuery.data?.total}
          noteCount={recentNotesQuery.data?.total}
          sessionCount={sessionsQuery.data?.total}
          projectCount={projects.length}
          movingCount={movingCount}
          scheduledCount={scheduledCount}
          onWork={() => router.push('/tasks')}
          onInbox={() => router.push('/inbox')}
          onNotes={() => router.push('/notes')}
          onSessions={() => router.push('/sessions')}
          onFiles={() => router.push('/files')}
          onAutomation={() => router.push('/automation')}
        />
      </ScrollView>
      <WorkspaceActionDock onCapture={capture} onAskAi={askAi} askAiPending={isOpeningAskAi} />
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
      <GatewaySwitcherSheet
        visible={gatewaySwitcherVisible}
        onDismiss={() => setGatewaySwitcherVisible(false)}
        onSwitched={(profileId) => {
          const profile = useGatewayStore.getState().profiles.find((item) => item.gatewayId === profileId);
          if (profile) setToastMessage(t(m.gateway.switcher.switched, { name: profile.name }));
        }}
        onManage={() => router.push('/settings/gateway')}
        onAdd={() => router.push('/settings/gateway/new')}
        onEdit={(profileId) => router.push(`/settings/gateway/${profileId}`)}
      />
    </View>
  );
}

function HomeGreeting({
  language,
  gatewayOnline,
  starting,
  onGatewayPress,
}: {
  language: 'en' | 'zh';
  gatewayOnline: boolean;
  starting: boolean;
  onGatewayPress: () => void;
}) {
  const { colors } = useTheme();
  const messages = useMessages();
  const hm = messages.homePage;
  const now = new Date();
  const period = homeGreetingPeriod(now.getHours());
  const greeting = period === 'morning'
    ? hm.greetingMorning
    : period === 'afternoon'
      ? hm.greetingAfternoon
      : hm.greetingEvening;
  const date = new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now);

  return (
    <View style={styles.greeting}>
      <Text style={[styles.greetingDate, { color: colors.text.secondary }]}>{date}</Text>
      <Text style={[styles.greetingTitle, { color: colors.text.primary }]}>{greeting}</Text>
      {!gatewayOnline ? (
        <Pressable
          style={[styles.connectionStatus, { backgroundColor: colors.surface.input }]}
          onPress={onGatewayPress}
          accessibilityRole="button"
          accessibilityLabel={`${hm.gatewayOfflineStatus}, ${messages.settings.switchGateway}`}
        >
          <View style={[styles.connectionDot, { backgroundColor: colors.semantic.warning }]} />
          <Text style={[styles.connectionText, { color: colors.text.secondary }]}>
            {hm.gatewayOfflineStatus}
          </Text>
          <Text style={[styles.connectionAction, { color: colors.accent.primary }]}>
            {messages.settings.switchGateway}
          </Text>
          <Icon source="chevron-right" size={16} color={colors.accent.primary} />
        </Pressable>
      ) : starting ? (
        <View style={styles.connectionStarting}>
          <View style={[styles.connectionDot, { backgroundColor: colors.accent.primary }]} />
          <Text style={[styles.connectionText, { color: colors.text.tertiary }]}>
            {hm.gatewayStartingStatus}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function HomeLoadError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  return (
    <View style={[styles.inlineError, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
      <Icon source="cloud-alert-outline" size={22} color={colors.semantic.warning} />
      <View style={styles.inlineErrorCopy}>
        <Text style={[styles.inlineErrorTitle, { color: colors.text.primary }]}>{hm.loadFailed}</Text>
        <Text style={[styles.inlineErrorText, { color: colors.text.secondary }]}>{hm.loadFailedHint}</Text>
      </View>
      <Pressable
        style={[styles.inlineRetry, { backgroundColor: colors.accent.soft }]}
        onPress={onRetry}
        disabled={retrying}
        accessibilityRole="button"
        accessibilityState={{ disabled: retrying, busy: retrying }}
      >
        {retrying ? <ActivityIndicator size={16} color={colors.accent.primary} /> : null}
        <Text style={[styles.inlineRetryText, { color: colors.accent.primary }]}>{hm.retry}</Text>
      </Pressable>
    </View>
  );
}

function RunningSection({ items, loading }: { items: RunningItem[]; loading: boolean }) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  const [expanded, setExpanded] = useState(false);
  const reducedMotion = useReducedMotion();
  if (loading) {
    return <Section title={hm.sectionRunning}><ListSkeleton count={1} /></Section>;
  }
  if (items.length === 0) return null;
  const visibleItems = expanded ? items : items.slice(0, 3);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeadingRow}>
        <View style={styles.sectionHeadingCopy}>
          <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{hm.sectionRunning}</Text>
          <Text style={[
            styles.sectionCount,
            { color: colors.accent.primary, backgroundColor: colors.accent.soft },
          ]}>{items.length}</Text>
        </View>
        {items.length > 3 ? (
          <Pressable
            style={styles.sectionAction}
            onPress={() => setExpanded((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
          >
            <Text style={[styles.sectionLink, { color: colors.accent.primary }]}>
              {expanded ? hm.showLess : hm.viewAll}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Animated.View
        layout={reducedMotion ? undefined : LinearTransition.duration(motion.duration.standard)}
        style={[
          styles.runningList,
          { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle },
        ]}
      >
        {visibleItems.map((item, index) => (
          <Animated.View
            key={item.id}
            entering={index < 3 || reducedMotion ? undefined : FadeIn.duration(motion.duration.quick)}
            exiting={index < 3 || reducedMotion ? undefined : FadeOut.duration(motion.duration.press)}
            layout={reducedMotion ? undefined : LinearTransition.duration(motion.duration.quick)}
          >
            <Pressable
              style={({ pressed }) => [
                styles.runningRow,
                pressed && { backgroundColor: colors.surface.pressed },
              ]}
              onPress={item.onPress}
              accessibilityRole="button"
            >
              <View style={[styles.runningIcon, { backgroundColor: colors.accent.soft }]}>
                <Icon source={item.icon} size={20} color={colors.accent.primary} />
              </View>
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text.primary }]}>{item.title}</Text>
                <Text numberOfLines={1} style={[styles.runningMeta, { color: colors.accent.primary }]}>{item.meta}</Text>
                {item.summary ? (
                  <Text numberOfLines={1} style={[styles.rowSubtitle, { color: colors.text.secondary }]}>{item.summary}</Text>
                ) : null}
              </View>
              <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
              {index < visibleItems.length - 1 ? (
                <View style={[styles.runningDivider, { backgroundColor: colors.border.subtle }]} />
              ) : null}
            </Pressable>
          </Animated.View>
        ))}
      </Animated.View>
    </View>
  );
}

function ContinueSection({ items, loading }: { items: ContinueItem[]; loading: boolean }) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  if (loading) {
    return <Section title={hm.sectionContinue}><ListSkeleton count={2} /></Section>;
  }
  if (items.length === 0) return null;
  const [featured, ...rest] = items;
  return (
    <Section title={hm.sectionContinue}>
      <Pressable
        style={({ pressed }) => [
          styles.continueFeatured,
          {
            backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel,
            borderColor: colors.border.subtle,
          },
        ]}
        onPress={featured.onPress}
        accessibilityRole="button"
      >
        <View style={[styles.continueIcon, { backgroundColor: colors.accent.soft }]}>
          <Icon source={featured.icon} size={22} color={colors.accent.primary} />
        </View>
        <View style={styles.continueCopy}>
          <Text numberOfLines={1} style={[styles.continueTitle, { color: colors.text.primary }]}>{featured.title}</Text>
          <Text numberOfLines={1} style={[styles.rowSubtitle, { color: colors.text.tertiary }]}>{featured.meta}</Text>
          {featured.summary ? (
            <Text numberOfLines={2} style={[styles.continueSummary, { color: colors.text.secondary }]}>{featured.summary}</Text>
          ) : null}
        </View>
        <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
      </Pressable>
      {rest.length > 0 ? (
        <View style={[styles.groupedList, { backgroundColor: colors.surface.panel }]}>
          {rest.map((item, index) => (
            <Pressable key={item.id} style={styles.listRow} onPress={item.onPress} accessibilityRole="button">
              <Icon source={item.icon} size={20} color={colors.text.secondary} />
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text.primary }]}>{item.title}</Text>
                <Text numberOfLines={1} style={[styles.rowSubtitle, { color: colors.text.tertiary }]}>{item.meta}</Text>
              </View>
              <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
              {index < rest.length - 1 ? <View style={[styles.rowDivider, { backgroundColor: colors.border.subtle }]} /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </Section>
  );
}

function focusIcon(kind: HomeFocusItem['kind']): string {
  if (kind === 'decision') return 'shield-check-outline';
  if (kind === 'failure') return 'alert-circle-outline';
  return 'progress-clock';
}

function NeedsYouSection({
  items,
  pending,
  onAction,
}: {
  items: HomeFocusItem[];
  pending: boolean;
  onAction: (action: HomeAction) => void;
}) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  const [expanded, setExpanded] = useState(false);
  const reducedMotion = useReducedMotion();
  if (items.length === 0) return null;
  const visibleItems = expanded ? items : items.slice(0, 3);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeadingRow}>
        <View style={styles.sectionHeadingCopy}>
          <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{hm.sectionTasksNeedsYou}</Text>
          <Text style={[styles.sectionCount, { color: colors.text.tertiary, backgroundColor: colors.surface.grouped }]}>{items.length}</Text>
        </View>
        {items.length > 3 ? (
          <Pressable
            style={styles.sectionAction}
            onPress={() => setExpanded((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
          >
            <Text style={[styles.sectionLink, { color: colors.accent.primary }]}>{expanded ? hm.showLess : hm.viewAll}</Text>
          </Pressable>
        ) : null}
      </View>
      <Animated.View
        layout={reducedMotion ? undefined : LinearTransition.duration(motion.duration.standard)}
        style={[styles.groupedList, { backgroundColor: colors.surface.panel }]}
      >
        {visibleItems.map((item, index) => (
          <Animated.View
            key={item.id}
            entering={index < 3 || reducedMotion ? undefined : FadeIn.duration(motion.duration.quick)}
            exiting={index < 3 || reducedMotion ? undefined : FadeOut.duration(motion.duration.press)}
            layout={reducedMotion ? undefined : LinearTransition.duration(motion.duration.quick)}
          >
            <AttentionRow
              item={item}
              pending={pending}
              last={index === visibleItems.length - 1}
              onAction={onAction}
            />
          </Animated.View>
        ))}
      </Animated.View>
    </View>
  );
}

function AttentionRow({
  item,
  pending,
  last,
  onAction,
}: {
  item: HomeFocusItem;
  pending: boolean;
  last: boolean;
  onAction: (action: HomeAction) => void;
}) {
  const { colors } = useTheme();
  const actions = [item.primaryAction, ...item.secondaryActions]
    .filter((action): action is RemoteHomeAction => Boolean(
      action && action.type !== 'open' && action.type !== 'review_judgment',
    ));
  return (
    <View style={styles.attentionRow}>
      <Pressable
        style={styles.attentionMain}
        onPress={() => item.openAction && onAction(item.openAction)}
        disabled={!item.openAction}
        accessibilityRole="button"
        accessibilityState={{ disabled: !item.openAction }}
      >
        <View style={[styles.rowIcon, { backgroundColor: colors.surface.grouped }]}>
          <Icon
            source={focusIcon(item.kind)}
            size={18}
            color={item.kind === 'failure' ? colors.semantic.error : colors.semantic.warning}
          />
        </View>
        <View style={styles.rowCopy}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text.primary }]}>{item.title}</Text>
          <Text numberOfLines={2} style={[styles.rowSubtitle, { color: colors.text.secondary }]}>{item.summary}</Text>
        </View>
        {item.openAction ? <Icon source="chevron-right" size={18} color={colors.text.tertiary} /> : null}
      </Pressable>
      {actions.length > 0 ? (
        <View style={styles.attentionActions}>
          {actions.map((action, index) => (
            <Pressable
              key={`${action.type}:${action.label}`}
              style={[
                styles.attentionAction,
                { backgroundColor: index === 0 ? colors.accent.primary : colors.surface.grouped },
              ]}
              onPress={() => onAction(action)}
              disabled={pending}
              accessibilityRole="button"
              accessibilityState={{ disabled: pending, busy: pending }}
            >
              {pending && index === 0 ? <ActivityIndicator size={14} color={colors.accent.onPrimary} /> : null}
              <Text style={[
                styles.attentionActionText,
                { color: index === 0 ? colors.accent.onPrimary : colors.text.secondary },
              ]}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!last ? <View style={[styles.attentionDivider, { backgroundColor: colors.border.subtle }]} /> : null}
    </View>
  );
}

function AgentsSection({
  agents,
  defaultAgentId,
  loading,
  pending,
  onAgentPress,
  onManage,
}: {
  agents: ChatAgentOption[];
  defaultAgentId?: string;
  loading: boolean;
  pending: boolean;
  onAgentPress: (agent: ChatAgentOption) => void;
  onManage: () => void;
}) {
  const { colors } = useTheme();
  const messages = useMessages();
  const hm = messages.homePage;
  if (!loading && agents.length === 0) return null;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeadingRow}>
        <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{hm.sectionAgents}</Text>
        <Pressable style={styles.sectionAction} onPress={onManage} accessibilityRole="button">
          <Text style={[styles.sectionLink, { color: colors.accent.primary }]}>{hm.manageAgents}</Text>
        </Pressable>
      </View>
      {loading && agents.length === 0 ? (
        <View style={styles.agentSkeletons}>
          {[0, 1, 2].map((key) => <View key={key} style={[styles.agentSkeleton, { backgroundColor: colors.surface.input }]} />)}
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.agentList}>
          {agents.map((agent) => {
            const isDefault = agent.id === defaultAgentId || agent.isDefault === true;
            const name = agentDisplayName(agent, messages.agentsPage);
            const description = agentDisplayDescription(agent, messages.agentsPage);
            return (
              <Pressable
                key={agent.id}
                style={({ pressed }) => [styles.agentItem, pressed && { backgroundColor: colors.surface.pressed }]}
                onPress={() => onAgentPress(agent)}
                disabled={pending}
                accessibilityRole="button"
                accessibilityLabel={name}
                accessibilityState={{ disabled: pending, busy: pending }}
              >
                <AgentAvatar agentId={agent.id} avatar={agent.avatar} size={48} />
                <Text numberOfLines={1} style={[styles.agentName, { color: colors.text.primary }]}>{name}</Text>
                <Text numberOfLines={1} style={[styles.agentDescription, { color: isDefault ? colors.accent.primary : colors.text.tertiary }]}>
                  {isDefault ? hm.defaultAgent : description || hm.askAiHint}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

function LibrarySection({
  inboxCount,
  noteCount,
  sessionCount,
  projectCount,
  movingCount,
  scheduledCount,
  onWork,
  onInbox,
  onNotes,
  onSessions,
  onFiles,
  onAutomation,
}: {
  inboxCount?: number;
  noteCount?: number;
  sessionCount?: number;
  projectCount: number;
  movingCount: number;
  scheduledCount: number;
  onWork: () => void;
  onInbox: () => void;
  onNotes: () => void;
  onSessions: () => void;
  onFiles: () => void;
  onAutomation: () => void;
}) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  const workSummary = projectCount > 0
    ? t(hm.libraryWorkSummary, { projects: projectCount, moving: movingCount })
    : hm.libraryWorkEmpty;
  const inboxSummary = inboxCount == null
    ? undefined
    : inboxCount > 0
      ? t(hm.inboxPendingCount, { count: inboxCount })
      : hm.inboxCleared;
  return (
    <Section title={hm.sectionLibrary}>
      <View style={[styles.groupedList, { backgroundColor: colors.surface.panel }]}>
        <LibraryRow icon="briefcase-outline" label={hm.libraryWork} summary={workSummary} onPress={onWork} />
        <LibraryRow icon="tray-arrow-down" label={hm.inboxMetric} summary={inboxSummary} onPress={onInbox} />
        <LibraryRow
          icon="note-text-outline"
          label={hm.libraryNotes}
          summary={noteCount == null ? undefined : t(hm.libraryNotesSummary, { count: noteCount })}
          onPress={onNotes}
        />
        <LibraryRow
          icon="message-processing-outline"
          label={hm.librarySessions}
          summary={sessionCount == null ? undefined : t(hm.librarySessionsSummary, { count: sessionCount })}
          onPress={onSessions}
        />
        <LibraryRow icon="folder-outline" label={hm.libraryFiles} summary={hm.libraryFilesSummary} onPress={onFiles} last={scheduledCount === 0} />
        {scheduledCount > 0 ? (
          <LibraryRow
            icon="calendar-clock-outline"
            label={hm.libraryAutomation}
            summary={t(hm.libraryAutomationSummary, { count: scheduledCount })}
            onPress={onAutomation}
            last
          />
        ) : null}
      </View>
    </Section>
  );
}

function LibraryRow({
  icon,
  label,
  summary,
  onPress,
  last = false,
}: {
  icon: string;
  label: string;
  summary?: string;
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
      {summary ? <Text numberOfLines={1} style={[styles.librarySummary, { color: colors.text.tertiary }]}>{summary}</Text> : null}
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
    return () => transition.registerPillMeasurer(null);
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
  greeting: { paddingTop: spacing.sm, paddingBottom: spacing.xs },
  greetingDate: { ...typography.label, marginBottom: spacing.xs },
  greetingTitle: { ...typography.largeTitle, marginBottom: spacing.sm },
  connectionStatus: { minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radii.md, paddingHorizontal: spacing.md },
  connectionStarting: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  connectionDot: { width: 7, height: 7, borderRadius: radii.full },
  connectionText: { ...typography.caption },
  connectionAction: { ...typography.caption, fontWeight: '600' },
  inlineError: { minHeight: 76, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  inlineErrorCopy: { flex: 1, gap: spacing.xxs },
  inlineErrorTitle: { ...typography.ui, fontWeight: '600' },
  inlineErrorText: { ...typography.caption },
  inlineRetry: { minHeight: 40, minWidth: 68, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm },
  inlineRetryText: { ...typography.label, fontWeight: '600' },
  section: { gap: spacing.md },
  sectionHeadingRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: -spacing.sm },
  sectionHeadingCopy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionAction: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  sectionTitle: { ...typography.heading },
  sectionCount: { ...typography.caption, minWidth: 22, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radii.full, textAlign: 'center' },
  sectionLink: { ...typography.caption, fontWeight: '600' },
  sectionBody: { gap: spacing.sm },
  groupedList: { borderRadius: radii.lg, overflow: 'hidden' },
  runningList: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, overflow: 'hidden' },
  runningRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  runningIcon: { width: 38, height: 38, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  runningMeta: { ...typography.caption, fontWeight: '600' },
  runningDivider: { position: 'absolute', left: 66, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  continueFeatured: { minHeight: 106, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  continueIcon: { width: 42, height: 42, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  continueCopy: { minWidth: 0, flex: 1, gap: spacing.xxs },
  continueTitle: { ...typography.heading },
  continueSummary: { ...typography.caption, marginTop: spacing.xs },
  listRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  rowCopy: { minWidth: 0, flex: 1, gap: spacing.xxs },
  rowTitle: { ...typography.ui, fontWeight: '600' },
  rowSubtitle: { ...typography.caption },
  rowDivider: { position: 'absolute', left: 52, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  attentionRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  attentionMain: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowIcon: { width: 32, height: 32, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' },
  attentionActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, paddingLeft: 44, paddingTop: spacing.xs },
  attentionAction: { minHeight: 40, minWidth: 72, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
  attentionActionText: { ...typography.caption, fontWeight: '600' },
  attentionDivider: { position: 'absolute', left: 56, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  agentList: { gap: spacing.sm, paddingRight: spacing.content },
  agentItem: { width: 108, minHeight: 116, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radii.lg, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  agentName: { ...typography.label, fontWeight: '600', width: '100%', textAlign: 'center' },
  agentDescription: { ...typography.caption, width: '100%', textAlign: 'center' },
  agentSkeletons: { flexDirection: 'row', gap: spacing.sm },
  agentSkeleton: { width: 108, height: 116, borderRadius: radii.lg },
  libraryRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  libraryLabel: { ...typography.ui, minWidth: 74 },
  librarySummary: { ...typography.caption, minWidth: 0, flex: 1, textAlign: 'right' },
  dockWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingHorizontal: spacing.content },
  dock: { minHeight: 58, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth, padding: spacing.xs, flexDirection: 'row', gap: spacing.xs },
  dockSecondary: { minHeight: 48, minWidth: 112, borderRadius: radii.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  dockPrimary: { minHeight: 48, minWidth: 124, borderRadius: radii.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  dockLabel: { ...typography.ui, fontWeight: '600' },
});
