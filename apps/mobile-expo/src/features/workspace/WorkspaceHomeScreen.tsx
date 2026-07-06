import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast } from '../../components/AppToast';
import { FloatingHeader } from '../../components/FloatingHeader';
import { TOAST_BOTTOM_LIFT_ABOVE_BAR, TOAST_DURATION_SHORT } from '../../constants/toast';
import { openChat, openNoteDetail } from '../../lib/navigation';
import { useMessages, t } from '../../i18n/messages';

import { queryKeys } from '../../query/keys';
import {
  fetchHome,
  type HomeData,
  type HomeGateway,
  type HomeWorkflowRun,
} from '../../query/home';
import { fetchNotes, type NoteIndexEntry } from '../../query/notes';
import { invalidateSessionLists } from '../../query/workspace-sync';
import { resolveNoteListTitle } from '../notes/note-title';
import { createLocalDraftNote, readLocalNote } from '../notes/notes-local';
import { noteKindLabel } from '../notes/note-list-display';
import { createSession, useGatewayConfigured } from '../../query/sessions';
import { fetchChatAgents, type ChatAgentOption, useEffectiveDefaultAgentId } from '../../query/agents';
import { useGatewayStore } from '../../stores/gateway-store';
import {
  FLOATING_BOTTOM_OFFSET,
  floatingBottomPadding,
  radii,
  spacing,
  typography,
  useTheme,
} from '../../theme';
import { sessionDisplayName } from '../../lib/session-helpers';

import { WorkspaceSearchOverlay } from '../search/WorkspaceSearchOverlay';
import { AgentAvatar } from '../ai/AgentAvatar';
import { readAgentUsage, sortHomeAgents, touchAgentUsage } from '../ai/agent-usage-cache';
import { useHomeChatPrefetch } from './use-home-chat-prefetch';
import { useWorkspaceNavigation } from './workspace-navigation-context';

type ContinueItem =
  | { id: string; kind: 'session'; title: string; meta: string; icon: string; onPress: () => void }
  | { id: string; kind: 'note'; title: string; meta: string; icon: string; onPress: () => void }
  | { id: string; kind: 'workflow'; title: string; meta: string; icon: string; onPress: () => void };

const HOME_INBOX_PREVIEW_LIMIT = 50;
const HOME_INBOX_VISIBLE_PREVIEW_LIMIT = 1;
const HOME_ATTENTION_WORKFLOW_LIMIT = 2;
const HOME_ATTENTION_ITEM_LIMIT = 3;

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
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return hm.justNow;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return t(hm.minutesAgo, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t(hm.hoursAgo, { n: hours });
  const days = Math.floor(hours / 24);
  return t(hm.daysAgo, { n: days });
}

function workflowProgress(run: HomeWorkflowRun, hm: ReturnType<typeof useMessages>['homePage']): string {
  const total = run.metrics.agentCount;
  if (total <= 0) return hm.workflowRunning;
  return t(hm.workflowProgress, { done: run.metrics.doneAgentCount, total });
}

function workflowAttentionRank(run: HomeWorkflowRun): number {
  if (run.status === 'failed' || run.status === 'timeout' || run.metrics.errorAgentCount > 0) return 0;
  if (run.status === 'cancelled') return 1;
  if (run.status === 'running' || run.status === 'queued') return 2;
  return 3;
}

function workflowStatusLabel(run: HomeWorkflowRun, hm: ReturnType<typeof useMessages>['homePage']): string {
  if (run.status === 'failed') return hm.workflowFailed;
  if (run.status === 'timeout') return hm.workflowTimeout;
  if (run.status === 'cancelled') return hm.workflowCancelled;
  if (run.status === 'queued') return hm.workflowQueued;
  if (run.status === 'running') return hm.workflowRunning;
  return hm.workflowNeedsReview;
}

function workflowAttentionMeta(run: HomeWorkflowRun, hm: ReturnType<typeof useMessages>['homePage']): string {
  const progress = workflowProgress(run, hm);
  if (run.metrics.errorAgentCount > 0) {
    return `${progress} · ${t(hm.workflowErrorCount, { count: run.metrics.errorAgentCount })}`;
  }
  return `${progress} · ${workflowStatusLabel(run, hm)}`;
}

function workflowAttentionBadgeTone(run: HomeWorkflowRun): 'error' | 'warning' | 'info' {
  if (run.status === 'failed' || run.status === 'timeout' || run.metrics.errorAgentCount > 0) return 'error';
  if (run.status === 'cancelled') return 'warning';
  return 'info';
}

function fallbackHomeData(agentId: string): Pick<HomeData, 'activeAgent' | 'gateway' | 'workflowRuns' | 'nextCronJobs' | 'recentCronRuns'> {
  return {
    activeAgent: { id: agentId },
    gateway: {
      status: 'unknown',
      ready: false,
      httpListening: false,
      version: '',
      uptime: 0,
      tunnel: { state: 'disconnected', publicUrl: null, connected: false },
    },
    workflowRuns: { active: [], attention: [], recent: [] },
    nextCronJobs: [],
    recentCronRuns: [],
  };
}

export function WorkspaceHomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const configured = useGatewayConfigured();
  const activeGatewayId = useGatewayStore((s) => s.activeGatewayId);
  const defaultAgentId = useEffectiveDefaultAgentId();
  const { prefetchAskAiSession } = useWorkspaceNavigation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [agentUsage, setAgentUsage] = useState(() => readAgentUsage(activeGatewayId));

  useHomeChatPrefetch(configured);

  useEffect(() => {
    setAgentUsage(readAgentUsage(activeGatewayId));
  }, [activeGatewayId]);

  useFocusEffect(
    useCallback(() => {
      setAgentUsage(readAgentUsage(activeGatewayId));
    }, [activeGatewayId]),
  );

  const homeQuery = useQuery({
    queryKey: queryKeys.home,
    queryFn: fetchHome,
    enabled: configured,
  });

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents,
    queryFn: fetchChatAgents,
    enabled: configured,
  });

  const home = homeQuery.data;
  const recentlyOpened = home?.recentlyOpened ?? [];
  const needsRecentNotesFallback = configured && !homeQuery.isLoading && recentlyOpened.length === 0;

  const recentNotesFallbackQuery = useQuery({
    queryKey: [...queryKeys.notesAll, 'home-preview'] as const,
    queryFn: () =>
      fetchNotes({
        limit: 5,
        offset: 0,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      }),
    enabled: needsRecentNotesFallback,
    staleTime: 60_000,
  });

  const homeNotes = useMemo(() => {
    if (recentlyOpened.length > 0) return recentlyOpened.slice(0, 4);
    return recentNotesFallbackQuery.data?.items.slice(0, 4) ?? [];
  }, [recentNotesFallbackQuery.data?.items, recentlyOpened]);

  const homeNotesLoading =
    homeQuery.isLoading || (needsRecentNotesFallback && recentNotesFallbackQuery.isLoading);

  const homeAgents = useMemo(() => {
    const agents = agentsQuery.data?.items ?? [];
    return sortHomeAgents(agents, agentUsage, defaultAgentId);
  }, [agentUsage, agentsQuery.data?.items, defaultAgentId]);

  const m = useMessages();
  const hm = m.homePage;
  const homeDefaults = useMemo(() => fallbackHomeData(defaultAgentId), [defaultAgentId]);
  const inboxCount = home?.inboxCount ?? 0;

  const inboxPreviewQuery = useQuery({
    queryKey: [...queryKeys.notes('inbox'), 'home-preview'] as const,
    queryFn: () =>
      fetchNotes({
        status: 'inbox',
        limit: HOME_INBOX_PREVIEW_LIMIT,
        offset: 0,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      }),
    enabled: configured && inboxCount > 0,
    staleTime: 60_000,
  });

  const inboxPreviewItems = inboxPreviewQuery.data?.items.slice(0, 2) ?? [];
  const inboxTodayCount = useMemo(() => {
    const items = inboxPreviewQuery.data?.items ?? [];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return items.filter((item) => item.createdAt >= start.getTime()).length;
  }, [inboxPreviewQuery.data?.items]);

  const handleNotePress = useCallback((item: NoteIndexEntry) => {
    openNoteDetail(router, item.id);
  }, [router]);

  const handleSessionPress = useCallback((sessionKey: string) => {
    router.push(`/chat/${sessionKey}`);
  }, [router]);

  const refetchHome = homeQuery.refetch;
  const refetchRecentNotesFallback = recentNotesFallbackQuery.refetch;

  const refreshHomeContent = useCallback(async () => {
    const result = await refetchHome();
    const opened = result.data?.recentlyOpened ?? [];
    if (opened.length === 0) {
      await refetchRecentNotesFallback();
    }
    prefetchAskAiSession();
  }, [prefetchAskAiSession, refetchHome, refetchRecentNotesFallback]);

  const handleRefresh = useCallback(() => {
    void refreshHomeContent();
  }, [refreshHomeContent]);

  const createAgentSessionMutation = useMutation({
    mutationFn: (agentId: string) => createSession(agentId),
    onSuccess: (key, agentId) => {
      touchAgentUsage(activeGatewayId, agentId);
      invalidateSessionLists(queryClient);
      openChat(router, key);
    },
    onError: (err) => {
      setToastMessage(err instanceof Error ? err.message : hm.noAgentChatFailed);
    },
  });

  const handleCreateNote = useCallback(() => {
    const draft = createLocalDraftNote();
    openNoteDetail(router, draft.id);
  }, [router]);

  const continueItems = useMemo<ContinueItem[]>(() => {
    const activeWorkflows = (home?.workflowRuns.active ?? []).slice(0, 2).map((run) => ({
      id: `workflow:${run.id}`,
      kind: 'workflow' as const,
      title: run.title,
      meta: `${hm.workflowItemMeta} · ${workflowProgress(run, hm)}`,
      icon: 'source-branch-sync',
      onPress: () => {
        if (run.sessionKey) handleSessionPress(run.sessionKey);
        else router.push('/automation');
      },
    }));
    const sessions = (home?.recentSessions ?? []).slice(0, 2).map((session) => ({
      id: `session:${session.key}`,
      kind: 'session' as const,
      title: sessionDisplayName(session, m.sessions.untitled),
      meta: `${hm.chatItemMeta} · ${timeLabel(session.updatedAt, hm)}`,
      icon: 'message-processing-outline',
      onPress: () => handleSessionPress(session.key),
    }));
    const notes = homeNotes.slice(0, 3).map((note) => ({
      id: `note:${note.id}`,
      kind: 'note' as const,
      title: resolveNoteListTitle(note, hm.untitled, readLocalNote(note.id)),
      meta: `${hm.noteItemMeta} · ${timeLabel(note.lastOpenedAt ?? note.updatedAt, hm)}`,
      icon: iconForNoteKind(note.kind),
      onPress: () => handleNotePress(note),
    }));
    return [...activeWorkflows, ...sessions, ...notes].slice(0, 4);
  }, [handleNotePress, handleSessionPress, hm, home?.recentSessions, home?.workflowRuns.active, homeNotes, m.sessions.untitled, router]);

  if (!configured) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
        <FloatingHeader
          showLogo
          title="xopc"
          searchPlaceholder={hm.searchPlaceholder}
          onSearchPress={() => setSearchOpen(true)}
          rightIcon="cog-outline"
          onRightPress={() => router.push('/settings')}
        />
        <View style={styles.centerContent}>
          <Icon source="cloud-off-outline" size={42} color={colors.text.tertiary} />
          <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>{hm.connectGatewayTitle}</Text>
          <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>{hm.connectGatewayHint}</Text>
        </View>
        <CenterNewNoteButton
          active={false}
          accessibilityLabel={hm.quickNewNote}
          disabled={false}
          onPress={handleCreateNote}
        />
        <WorkspaceSearchOverlay visible={searchOpen} onClose={() => setSearchOpen(false)} />
        <AppToast
          visible={!!toastMessage}
          onDismiss={() => setToastMessage('')}
          duration={TOAST_DURATION_SHORT}
          bottomLift={TOAST_BOTTOM_LIFT_ABOVE_BAR}
        >
          {toastMessage}
        </AppToast>
      </View>
    );
  }

  const refreshing = homeQuery.isFetching && !homeQuery.isLoading;
  const pendingTasks = home?.pendingTasks ?? [];
  const gateway = home?.gateway ?? homeDefaults.gateway;
  const attentionWorkflows = home?.workflowRuns.attention ?? [];
  const showEmptyContinue = !homeQuery.isLoading && !homeNotesLoading && continueItems.length === 0;
  const nextTask = pendingTasks[0];

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <FloatingHeader
        showLogo
        title="xopc"
        searchPlaceholder={hm.searchPlaceholder}
        onSearchPress={() => setSearchOpen(true)}
        rightIcon="cog-outline"
        onRightPress={() => router.push('/settings')}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: floatingBottomPadding(insets.bottom) + FLOATING_BOTTOM_OFFSET + 80 },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {homeQuery.isLoading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator />
          </View>
        ) : (
          <>
            <HomeGatewayStatus gateway={gateway} />
            <ContinueSection
              items={continueItems}
              loading={homeNotesLoading}
              empty={showEmptyContinue}
              onViewSessions={() => router.push('/sessions')}
            />
            <AttentionSection
              inboxCount={inboxCount}
              inboxTodayCount={inboxTodayCount}
              inboxPreviewItems={inboxPreviewItems}
              attentionWorkflows={attentionWorkflows}
              nextTask={nextTask}
              onInboxPress={() => router.push('/inbox')}
              onTaskPress={(note) => handleNotePress(note)}
              onWorkflowPress={(run) => {
                if (run.sessionKey) handleSessionPress(run.sessionKey);
                else router.push('/automation');
              }}
            />
            <AgentStrip
              agents={homeAgents}
              loading={agentsQuery.isLoading}
              busyAgentId={
                createAgentSessionMutation.isPending
                  ? createAgentSessionMutation.variables
                  : undefined
              }
              onAgentPress={(agentId) => {
                createAgentSessionMutation.mutate(agentId);
              }}
            />
            <LibrarySection
              onNotes={() => router.push('/notes')}
              onSessions={() => router.push('/sessions')}
              onFiles={() => router.push('/files')}
              onAutomation={() => router.push('/automation')}
              onAgents={() => router.push('/ai/agents')}
            />
          </>
        )}
      </ScrollView>

      <CenterNewNoteButton
        active={false}
        accessibilityLabel={hm.quickNewNote}
        disabled={false}
        onPress={handleCreateNote}
      />
      <WorkspaceSearchOverlay visible={searchOpen} onClose={() => setSearchOpen(false)} />
      <AppToast
        visible={!!toastMessage}
        onDismiss={() => setToastMessage('')}
        duration={TOAST_DURATION_SHORT}
        bottomLift={TOAST_BOTTOM_LIFT_ABOVE_BAR}
      >
        {toastMessage}
      </AppToast>
    </View>
  );
}

function HomeGatewayStatus({ gateway }: { gateway: HomeGateway }) {
  const { colors } = useTheme();
  const m = useMessages();
  const hm = m.homePage;
  if (gateway.ready) return null;
  return (
    <View style={[styles.statusBanner, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
      <Icon source="progress-clock" size={16} color={colors.semantic.warning} />
      <Text style={[styles.statusText, { color: colors.text.secondary }]}>
        {hm.gatewayStartingStatus}
      </Text>
    </View>
  );
}

function agentName(agent: ChatAgentOption): string {
  return agent.name?.trim() || agent.id;
}

function AgentStrip({
  agents,
  loading,
  busyAgentId,
  onAgentPress,
}: {
  agents: ChatAgentOption[];
  loading: boolean;
  busyAgentId?: string;
  onAgentPress: (agentId: string) => void;
}) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  const visibleAgents = agents.slice(0, 6);

  if (loading) {
    return (
      <Section title={hm.sectionAgents}>
        <View style={[styles.agentStripLoading, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
          <ActivityIndicator size="small" />
        </View>
      </Section>
    );
  }

  if (visibleAgents.length === 0) return null;

  return (
    <Section title={hm.sectionAgents}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.agentStripContent}
      >
        {visibleAgents.map((agent) => {
          const busy = busyAgentId === agent.id;
          return (
            <Pressable
              key={agent.id}
              style={[
                styles.agentPill,
                { backgroundColor: colors.surface.panel, borderColor: colors.border.default },
                busy && styles.disabled,
              ]}
              onPress={() => onAgentPress(agent.id)}
              disabled={busy}
            >
              {busy ? (
                <View style={styles.agentPillAvatar}>
                  <ActivityIndicator size={20} />
                </View>
              ) : (
                <AgentAvatar agentId={agent.id} avatar={agent.avatar} size={52} />
              )}
              <Text numberOfLines={1} style={[styles.agentPillName, { color: colors.text.primary }]}>
                {agentName(agent)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Section>
  );
}

function ContinueSection({
  items,
  loading,
  empty,
  onViewSessions,
}: {
  items: ContinueItem[];
  loading: boolean;
  empty: boolean;
  onViewSessions: () => void;
}) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();

  return (
    <Section title={hm.sectionContinue} actionLabel={hm.viewSessions} onAction={onViewSessions}>
      <View style={[styles.panel, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
        {loading ? (
          <View style={styles.emptyRow}>
            <ActivityIndicator size="small" />
          </View>
        ) : empty ? (
          <View style={styles.emptyRow}>
            <Text style={[styles.emptyInlineText, { color: colors.text.tertiary }]}>{hm.noContinueItems}</Text>
          </View>
        ) : (
          items.map((item, index) => (
            <Pressable key={item.id} style={styles.listRow} onPress={item.onPress}>
              <View style={[styles.iconBubble, { backgroundColor: colors.accent.selectionBg }]}>
                <Icon source={item.icon} size={18} color={colors.accent.primary} />
              </View>
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text.primary }]}>{item.title}</Text>
                <Text numberOfLines={1} style={[styles.rowSubtitle, { color: colors.text.tertiary }]}>{item.meta}</Text>
              </View>
              <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
              {index < items.length - 1 ? (
                <View style={[styles.rowDivider, { backgroundColor: colors.border.subtle }]} />
              ) : null}
            </Pressable>
          ))
        )}
      </View>
    </Section>
  );
}

function AttentionSection({
  inboxCount,
  inboxTodayCount,
  inboxPreviewItems,
  attentionWorkflows,
  nextTask,
  onInboxPress,
  onTaskPress,
  onWorkflowPress,
}: {
  inboxCount: number;
  inboxTodayCount: number;
  inboxPreviewItems: NoteIndexEntry[];
  attentionWorkflows: HomeWorkflowRun[];
  nextTask?: NoteIndexEntry;
  onInboxPress: () => void;
  onTaskPress: (note: NoteIndexEntry) => void;
  onWorkflowPress: (run: HomeWorkflowRun) => void;
}) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  const nextTaskTitle = nextTask ? resolveNoteListTitle(nextTask, hm.untitled, readLocalNote(nextTask.id)) : null;
  const workflowItems = [...attentionWorkflows]
    .sort((a, b) => {
      const rank = workflowAttentionRank(a) - workflowAttentionRank(b);
      if (rank !== 0) return rank;
      return b.createdAtMs - a.createdAtMs;
    })
    .slice(0, HOME_ATTENTION_WORKFLOW_LIMIT)
    .map((workflow) => ({
      key: `workflow:${workflow.id}`,
      icon: 'source-branch-sync',
      title: workflow.title,
      meta: workflowAttentionMeta(workflow, hm),
      badge: workflowStatusLabel(workflow, hm),
      badgeTone: workflowAttentionBadgeTone(workflow),
      onPress: () => onWorkflowPress(workflow),
    }));
  const taskItem = nextTask && nextTaskTitle
    ? [{
      key: `task:${nextTask.id}`,
      icon: 'flag-outline',
      title: nextTaskTitle,
      meta: hm.nextTaskHint,
      badge: hm.taskBadge,
      badgeTone: 'info' as const,
      onPress: () => onTaskPress(nextTask),
    }]
    : [];
  const attentionItems = [...workflowItems, ...taskItem].slice(0, HOME_ATTENTION_ITEM_LIMIT);

  return (
    <Section title={hm.sectionAttention}>
      <InboxPreviewPanel
        inboxCount={inboxCount}
        todayCount={inboxTodayCount}
        items={inboxPreviewItems}
        onPress={onInboxPress}
      />
      {attentionItems.length > 0 ? (
        <View style={[styles.attentionList, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
          {attentionItems.map((item, index) => (
            <AttentionItemRow
              key={item.key}
              icon={item.icon}
              title={item.title}
              meta={item.meta}
              badge={item.badge}
              badgeTone={item.badgeTone}
              showDivider={index < attentionItems.length - 1}
              onPress={item.onPress}
            />
          ))}
        </View>
      ) : null}
    </Section>
  );
}

function AttentionItemRow({
  icon,
  title,
  meta,
  badge,
  badgeTone,
  showDivider,
  onPress,
}: {
  icon: string;
  title: string;
  meta: string;
  badge: string;
  badgeTone: 'error' | 'warning' | 'info';
  showDivider: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const badgeColor = badgeTone === 'error'
    ? colors.semantic.errorBold
    : badgeTone === 'warning'
      ? colors.semantic.warning
      : colors.accent.primary;

  return (
    <Pressable style={styles.attentionRow} onPress={onPress}>
      <View style={[styles.iconBubbleSmall, { backgroundColor: colors.surface.input }]}>
        <Icon source={icon} size={16} color={colors.text.secondary} />
      </View>
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text.primary }]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.rowSubtitle, { color: colors.text.tertiary }]}>{meta}</Text>
      </View>
      <View style={[styles.attentionBadge, { backgroundColor: colors.surface.input }]}>
        <Text numberOfLines={1} style={[styles.attentionBadgeText, { color: badgeColor }]}>{badge}</Text>
      </View>
      <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
      {showDivider ? <View style={[styles.attentionDivider, { backgroundColor: colors.border.subtle }]} /> : null}
    </Pressable>
  );
}

function InboxPreviewPanel({
  inboxCount,
  todayCount,
  items,
  onPress,
}: {
  inboxCount: number;
  todayCount: number;
  items: NoteIndexEntry[];
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  const visibleItems = items.slice(0, HOME_INBOX_VISIBLE_PREVIEW_LIMIT);
  const statusText = inboxCount > 0
    ? todayCount > 0
      ? t(hm.inboxPendingTodayCount, { count: inboxCount, today: todayCount })
      : t(hm.inboxPendingCount, { count: inboxCount })
    : hm.inboxClearHint;

  return (
    <Pressable
      style={[styles.inboxPanel, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}
      onPress={onPress}
    >
      <View style={styles.inboxHeader}>
        <View style={styles.inboxTitleRow}>
          <View style={[styles.iconBubble, { backgroundColor: colors.accent.selectionBg }]}>
            <Icon source={inboxCount > 0 ? 'tray-full' : 'tray'} size={18} color={colors.accent.primary} />
          </View>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowTitle, { color: colors.text.primary }]}>{hm.inboxMetric}</Text>
            <Text numberOfLines={1} style={[styles.rowSubtitle, { color: colors.text.tertiary }]}>
              {statusText}
            </Text>
          </View>
        </View>
        <View style={styles.inboxAction}>
          <Text style={[styles.openText, { color: colors.accent.primary }]}>{hm.organizeInbox}</Text>
          <Icon source="chevron-right" size={18} color={colors.accent.primary} />
        </View>
      </View>

      {inboxCount > 0 ? (
        <View style={styles.inboxPreviewList}>
          {visibleItems.length > 0 ? visibleItems.map((item, index) => (
            <InboxPreviewItem key={item.id} item={item} showDivider={index < visibleItems.length - 1} />
          )) : (
            <Text style={[styles.inboxEmptyHint, { color: colors.text.tertiary }]}>
              {hm.inboxPreviewLoading}
            </Text>
          )}
        </View>
      ) : null}
    </Pressable>
  );
}

function InboxPreviewItem({ item, showDivider }: { item: NoteIndexEntry; showDivider: boolean }) {
  const { colors } = useTheme();
  const { homePage: hm, notesPage: pm } = useMessages();
  const title = resolveNoteListTitle(item, hm.untitled, readLocalNote(item.id));
  const kind = noteKindLabel(item.kind, pm);
  const meta = `${kind} · ${timeLabel(item.createdAt, hm)}`;

  return (
    <View style={styles.inboxPreviewRow}>
      <View style={[styles.iconBubbleSmall, { backgroundColor: colors.surface.input }]}>
        <Icon source={iconForNoteKind(item.kind)} size={16} color={colors.text.secondary} />
      </View>
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text.primary }]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.rowSubtitle, { color: colors.text.tertiary }]}>{meta}</Text>
      </View>
      {showDivider ? <View style={[styles.inboxPreviewDivider, { backgroundColor: colors.border.subtle }]} /> : null}
    </View>
  );
}

function LibrarySection({
  onNotes,
  onSessions,
  onFiles,
  onAutomation,
  onAgents,
}: {
  onNotes: () => void;
  onSessions: () => void;
  onFiles: () => void;
  onAutomation: () => void;
  onAgents: () => void;
}) {
  const { homePage: hm } = useMessages();
  return (
    <Section title={hm.sectionLibrary}>
      <View style={styles.libraryGrid}>
        <LibraryButton icon="note-text-outline" label={hm.libraryNotes} onPress={onNotes} />
        <LibraryButton icon="message-processing-outline" label={hm.librarySessions} onPress={onSessions} />
        <LibraryButton icon="folder-outline" label={hm.libraryFiles} onPress={onFiles} />
        <LibraryButton icon="clock-outline" label={hm.libraryAutomation} onPress={onAutomation} />
        <LibraryButton icon="account-supervisor-outline" label={hm.libraryAgents} onPress={onAgents} />
      </View>
    </Section>
  );
}

function Section({
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
      <View style={styles.headerRow}>
        <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{title}</Text>
        {actionLabel && onAction ? (
          <Pressable onPress={onAction} style={styles.headerAction}>
            <Text style={[styles.openText, { color: colors.accent.primary }]}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function LibraryButton({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={[styles.libraryButton, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}
      onPress={onPress}
    >
      <Icon source={icon} size={20} color={colors.accent.primary} />
      <Text numberOfLines={1} style={[styles.libraryLabel, { color: colors.text.primary }]}>{label}</Text>
    </Pressable>
  );
}

function CenterNewNoteButton({
  active,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  active: boolean;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const shadowOpacity = isDark ? 0.18 : 0.06;
  const scale = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(scale, {
      toValue: active ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [active, scale]);

  const buttonScale = scale.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });
  const ringScale = scale.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1.55],
  });
  const ringOpacity = scale.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.18],
  });

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.centerNewNoteWrap,
        { paddingBottom: floatingBottomPadding(insets.bottom) + FLOATING_BOTTOM_OFFSET },
      ]}
    >
      <View style={styles.centerNewNoteCluster}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.centerNewNoteRing,
            {
              backgroundColor: colors.accent.primary,
              opacity: ringOpacity,
              transform: [{ scale: ringScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.centerNewNoteButton,
            {
              backgroundColor: active ? colors.accent.primary : colors.surface.panel,
              borderColor: active ? colors.accent.primary : colors.border.default,
              shadowOpacity,
              transform: [{ scale: buttonScale }],
            },
            disabled && styles.disabled,
          ]}
        >
          <Pressable
            style={styles.centerNewNotePressable}
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ disabled }}
          >
            {disabled ? (
              <ActivityIndicator size={22} color={colors.accent.onPrimary} />
            ) : (
              <Icon source="note-plus-outline" size={26} color={active ? colors.accent.onPrimary : colors.text.secondary} />
            )}
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.xl },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  emptyTitle: { ...typography.heading, fontWeight: '600' },
  emptyText: { ...typography.ui, textAlign: 'center' },
  loadingCard: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  statusBanner: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusText: { ...typography.caption, fontWeight: '500' },
  section: { gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...typography.heading },
  headerAction: { minHeight: 32, justifyContent: 'center' },
  openText: { ...typography.label, fontWeight: '600' },
  agentStripLoading: {
    minHeight: 92,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentStripContent: {
    gap: spacing.md,
    paddingRight: spacing.lg,
  },
  agentPill: {
    width: 86,
    minHeight: 96,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  agentPillAvatar: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentPillName: {
    ...typography.caption,
    maxWidth: '100%',
    fontWeight: '600',
    textAlign: 'center',
  },
  panel: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  panelRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  listRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  rowDivider: {
    position: 'absolute',
    left: 62,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { ...typography.ui, fontWeight: '600' },
  rowSubtitle: { ...typography.caption },
  emptyRow: { minHeight: 72, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  emptyInlineText: { ...typography.label, fontWeight: '500', textAlign: 'center' },
  attentionList: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  attentionRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  attentionBadge: {
    minHeight: 24,
    maxWidth: 96,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  attentionBadgeText: { ...typography.micro, fontWeight: '600' },
  attentionDivider: {
    position: 'absolute',
    left: 56,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  inboxPanel: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.md,
  },
  inboxHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  inboxTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  inboxAction: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
  },
  inboxPreviewList: {
    gap: spacing.sm,
  },
  inboxPreviewRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBubbleSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inboxPreviewDivider: {
    position: 'absolute',
    left: 44,
    right: 0,
    bottom: -spacing.xs,
    height: StyleSheet.hairlineWidth,
  },
  inboxEmptyHint: { ...typography.label, fontWeight: '500' },
  disabled: { opacity: 0.6 },
  libraryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  libraryButton: {
    width: '47.9%',
    minHeight: 72,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  libraryLabel: { ...typography.label, fontWeight: '600' },
  centerNewNoteWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerNewNoteCluster: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerNewNoteRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  centerNewNoteButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  centerNewNotePressable: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 30,
  },
});
