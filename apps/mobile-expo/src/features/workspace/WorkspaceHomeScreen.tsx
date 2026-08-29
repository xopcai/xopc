import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import {
  mobileAppJsStartedAt,
  recordPerformanceEvent,
  recordUsageEvent,
} from '../../product/usage-metrics';
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
import { mobileRouteForHomeHref, rankHomeContinueCandidates } from './home-presentation';
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

function timestampMs(value: string | number | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type RemoteHomeAction = Exclude<HomeAction, { type: 'open' | 'review_judgment' }>;

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
  const homeReadyRecorded = useRef(false);

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
  useEffect(() => {
    if (homeReadyRecorded.current || !configured || homeQuery.isLoading) return;
    homeReadyRecorded.current = true;
    recordPerformanceEvent('home_content_ready', Date.now() - mobileAppJsStartedAt);
  }, [configured, homeQuery.isLoading]);
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

  const handleNotePress = useCallback((note: NoteIndexEntry) => {
    recordUsageEvent('home_continue_opened');
    openNoteDetail(router, note.id);
  }, [router]);

  const primaryFocus = home?.focusItems[0];
  const remainingFocusItems = useMemo(
    () => primaryFocus ? (home?.focusItems ?? []).filter((item) => item.id !== primaryFocus.id) : [],
    [home?.focusItems, primaryFocus],
  );
  const focusedIds = useMemo(() => new Set((home?.focusItems ?? []).map((item) => item.id)), [home?.focusItems]);

  const continueItems = useMemo<ContinueItem[]>(() => {
    const noteItems = homeNotes.map((note) => ({
      id: `note:${note.id}`,
      kind: 'note' as const,
      updatedAt: timestampMs(note.lastOpenedAt ?? note.updatedAt),
      value: {
        id: `note:${note.id}`,
        title: resolveNoteListTitle(note, hm.untitled),
        meta: `${hm.noteItemMeta} · ${timeLabel(note.lastOpenedAt ?? note.updatedAt, hm)}`,
        icon: iconForNoteKind(note.kind),
        onPress: () => handleNotePress(note),
      },
    }));
    return rankHomeContinueCandidates(
      noteItems.filter((item) => !focusedIds.has(item.id)),
      primaryFocus?.id,
    ).slice(0, 3);
  }, [focusedIds, handleNotePress, hm, homeNotes, primaryFocus?.id]);

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
      recordUsageEvent('home_focus_opened');
      router.push(mobileRouteForHomeHref(action.href) as never);
    } else if (action.type === 'review_judgment') {
      recordUsageEvent('home_focus_opened');
      router.push({ pathname: '/inbox', params: { item: action.itemId } });
    } else {
      remoteActionMutation.mutate(action);
    }
  }, [remoteActionMutation, router]);

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
            {primaryFocus ? (
              <HomeFocusCard
                item={primaryFocus}
                pending={remoteActionMutation.isPending}
                onAction={runHomeAction}
              />
            ) : null}
            <HomeFocusSections
              items={remainingFocusItems}
              scheduledTotal={remainingFocusItems.filter((item) => item.kind === 'scheduled').length}
              pending={remoteActionMutation.isPending}
              onAction={runHomeAction}
              onViewSchedules={() => router.push('/automation')}
            />
            <ContinueSection items={continueItems} />
            <LibrarySection
              inboxCount={home.inboxCount}
              onWork={() => router.push('/tasks')}
              onInbox={() => router.push('/inbox')}
              onNotes={() => router.push('/notes')}
              onSessions={() => router.push('/sessions')}
              onFiles={() => router.push('/files')}
              onAutomation={() => router.push('/automation')}
              showAutomation={home.focusItems.some((item) => item.kind === 'scheduled')}
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

function focusIcon(kind: HomeFocusItem['kind']): string {
  if (kind === 'decision') return 'shield-check-outline';
  if (kind === 'failure') return 'alert-circle-outline';
  return 'progress-clock';
}

function HomeFocusCard({
  item,
  pending,
  onAction,
}: {
  item: HomeFocusItem;
  pending: boolean;
  onAction: (action: HomeAction) => void;
}) {
  const { colors } = useTheme();
  const openAction = item.openAction;
  const body = (
    <>
      <Text style={[styles.focusTitle, { color: colors.text.primary }]}>{item.title}</Text>
      <Text style={[styles.focusSummary, { color: colors.text.secondary }]}>{item.summary}</Text>
    </>
  );
  const actions = [item.primaryAction, ...item.secondaryActions].filter((action): action is HomeAction => Boolean(action));
  return (
    <View style={[styles.focusCard, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
      <View style={styles.focusHeader}>
        <View style={[styles.briefingMark, { backgroundColor: colors.accent.soft }]}>
          <Icon
            source={focusIcon(item.kind)}
            size={20}
            color={item.kind === 'failure' ? colors.semantic.error : item.kind === 'decision' ? colors.semantic.warning : colors.accent.primary}
          />
        </View>
        <View style={styles.focusHeaderActions}>
          {item.statusLabel ? (
            <Text style={[styles.focusStatus, { color: colors.accent.primary, backgroundColor: colors.accent.soft }]}>
              {item.statusLabel}
            </Text>
          ) : null}
        </View>
      </View>
      {openAction ? (
        <Pressable onPress={() => onAction(openAction)} accessibilityRole="button">
          {body}
        </Pressable>
      ) : body}
      {actions.length > 0 ? (
        <View style={styles.focusActions}>
          {actions.map((action, index) => (
            <FocusActionButton
              key={`${action.type}:${action.label}`}
              label={action.label}
              primary={index === 0}
              pending={pending}
              onPress={() => onAction(action)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function HomeFocusSections({
  items,
  scheduledTotal,
  pending,
  onAction,
  onViewSchedules,
}: {
  items: HomeFocusItem[];
  scheduledTotal: number;
  pending: boolean;
  onAction: (action: HomeAction) => void;
  onViewSchedules: () => void;
}) {
  const { homePage: hm } = useMessages();
  const needs = items.filter((item) => item.kind === 'decision' || item.kind === 'failure');
  const running = items.filter((item) => item.kind === 'running');
  const scheduled = items.filter((item) => item.kind === 'scheduled');
  return (
    <>
      <HomeFocusList title={hm.sectionAttention} items={needs} pending={pending} onAction={onAction} />
      <HomeFocusList title={hm.sectionTasksRunning} items={running} pending={pending} onAction={onAction} />
      <HomeFocusList
        title={hm.sectionScheduled}
        items={scheduled}
        total={scheduledTotal}
        pending={pending}
        onAction={onAction}
        onViewAll={scheduledTotal > scheduled.length ? onViewSchedules : undefined}
      />
    </>
  );
}

function HomeFocusList({
  title,
  items,
  total = items.length,
  pending,
  onAction,
  onViewAll,
}: {
  title: string;
  items: HomeFocusItem[];
  total?: number;
  pending: boolean;
  onAction: (action: HomeAction) => void;
  onViewAll?: () => void;
}) {
  const { colors } = useTheme();
  const { homePage: hm } = useMessages();
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const visibleItems = expanded ? items : items.slice(0, 3);
  const canExpand = !onViewAll && items.length > visibleItems.length;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeadingRow}>
        <View style={styles.sectionHeadingCopy}>
          <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{title}</Text>
          <Text style={[styles.sectionCount, { color: colors.text.tertiary, backgroundColor: colors.surface.grouped }]}>{total}</Text>
        </View>
        {onViewAll ? (
          <Pressable onPress={onViewAll} accessibilityRole="button">
            <Text style={[styles.sectionLink, { color: colors.accent.primary }]}>{hm.viewAll}</Text>
          </Pressable>
        ) : canExpand || expanded ? (
          <Pressable onPress={() => setExpanded((value) => !value)} accessibilityRole="button">
            <Text style={[styles.sectionLink, { color: colors.accent.primary }]}>{expanded ? hm.showLess : hm.viewAll}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.groupedList, { backgroundColor: colors.surface.panel }]}>
        {visibleItems.map((item, index) => (
          <HomeFocusRow
            key={item.id}
            item={item}
            pending={pending}
            last={index === visibleItems.length - 1}
            onAction={onAction}
          />
        ))}
      </View>
    </View>
  );
}

function HomeFocusRow({
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
  const quickAction = item.primaryAction?.type !== 'open' && item.primaryAction?.type !== 'review_judgment'
    ? item.primaryAction
    : undefined;
  return (
    <View style={styles.focusListRow}>
      <Pressable
        style={styles.focusListMain}
        onPress={() => item.openAction && onAction(item.openAction)}
        disabled={!item.openAction}
        accessibilityRole="button"
        accessibilityState={{ disabled: !item.openAction }}
      >
        <View style={[styles.rowIcon, { backgroundColor: colors.surface.grouped }]}>
          <Icon source={focusIcon(item.kind)} size={18} color={item.kind === 'failure' ? colors.semantic.error : colors.accent.primary} />
        </View>
        <View style={styles.rowCopy}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text.primary }]}>{item.title}</Text>
          <Text numberOfLines={1} style={[styles.rowSubtitle, { color: colors.text.tertiary }]}>
            {item.statusLabel ? `${item.summary} · ${item.statusLabel}` : item.summary}
          </Text>
        </View>
        {item.openAction ? <Icon source="chevron-right" size={18} color={colors.text.tertiary} /> : null}
      </Pressable>
      {quickAction ? (
        <Pressable
          style={[styles.rowAction, { backgroundColor: colors.accent.soft }]}
          onPress={() => onAction(quickAction)}
          disabled={pending}
          accessibilityRole="button"
          accessibilityState={{ disabled: pending, busy: pending }}
        >
          <Text style={[styles.rowActionText, { color: colors.accent.primary }]}>{quickAction.label}</Text>
        </Pressable>
      ) : null}
      {!last ? <View style={[styles.focusRowDivider, { backgroundColor: colors.border.subtle }]} /> : null}
    </View>
  );
}

function FocusActionButton({
  label,
  primary,
  pending,
  onPress,
}: {
  label: string;
  primary: boolean;
  pending: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={[
        styles.focusButton,
        { backgroundColor: primary ? colors.accent.primary : colors.surface.grouped },
      ]}
      disabled={pending}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: pending, busy: pending }}
    >
      {pending && primary ? <ActivityIndicator size={16} color={colors.accent.onPrimary} /> : null}
      <Text style={[styles.focusButtonText, { color: primary ? colors.accent.onPrimary : colors.text.secondary }]}>{label}</Text>
    </Pressable>
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

function LibrarySection({
  inboxCount,
  onWork,
  onInbox,
  onNotes,
  onSessions,
  onFiles,
  onAutomation,
  showAutomation,
}: {
  inboxCount: number;
  onWork: () => void;
  onInbox: () => void;
  onNotes: () => void;
  onSessions: () => void;
  onFiles: () => void;
  onAutomation: () => void;
  showAutomation: boolean;
}) {
  const { homePage: hm } = useMessages();
  return (
    <Section title={hm.sectionLibrary}>
      <LibraryRow icon="briefcase-outline" label={hm.libraryWork} onPress={onWork} />
      <LibraryRow icon="tray-arrow-down" label={hm.inboxMetric} value={inboxCount > 0 ? String(inboxCount) : undefined} onPress={onInbox} />
      <LibraryRow icon="note-text-outline" label={hm.libraryNotes} onPress={onNotes} />
      <LibraryRow icon="message-processing-outline" label={hm.librarySessions} onPress={onSessions} />
      <LibraryRow icon="folder-outline" label={hm.libraryFiles} onPress={onFiles} last={!showAutomation} />
      {showAutomation ? <LibraryRow icon="calendar-clock-outline" label={hm.libraryAutomation} onPress={onAutomation} last /> : null}
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
  focusCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.content, gap: spacing.md },
  focusHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  focusHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  briefingMark: { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  focusTitle: { ...typography.title, marginBottom: spacing.xs },
  focusSummary: { ...typography.body },
  focusStatus: { ...typography.caption, fontWeight: '600', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.sm },
  focusActions: { flexDirection: 'row', gap: spacing.sm },
  focusButton: { minHeight: 44, flex: 1, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
  focusButtonText: { ...typography.ui, fontWeight: '600' },
  section: { gap: spacing.md },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionHeadingCopy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionCount: { ...typography.caption, minWidth: 22, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radii.full, textAlign: 'center' },
  sectionLink: { ...typography.caption, fontWeight: '600' },
  sectionBody: { borderRadius: radii.lg, overflow: 'hidden' },
  sectionTitle: { ...typography.heading },
  groupedList: { borderRadius: radii.lg, overflow: 'hidden' },
  listRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  rowCopy: { flex: 1, gap: spacing.xxs },
  rowTitle: { ...typography.ui, fontWeight: '600' },
  rowSubtitle: { ...typography.caption },
  rowDivider: { position: 'absolute', left: 52, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  focusListRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md },
  focusListMain: { minWidth: 0, flex: 1, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowIcon: { width: 32, height: 32, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' },
  rowAction: { minHeight: 36, maxWidth: 96, justifyContent: 'center', borderRadius: radii.md, paddingHorizontal: spacing.sm, marginLeft: spacing.sm },
  rowActionText: { ...typography.caption, fontWeight: '600' },
  focusRowDivider: { position: 'absolute', left: 56, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  libraryRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  libraryLabel: { ...typography.ui, flex: 1 },
  libraryValue: { ...typography.label },
  dockWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingHorizontal: spacing.content },
  dock: { minHeight: 58, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth, padding: spacing.xs, flexDirection: 'row', gap: spacing.xs },
  dockSecondary: { minHeight: 48, minWidth: 112, borderRadius: radii.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  dockPrimary: { minHeight: 48, minWidth: 124, borderRadius: radii.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  dockLabel: { ...typography.ui, fontWeight: '600' },
});
