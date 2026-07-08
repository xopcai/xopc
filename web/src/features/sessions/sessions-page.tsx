import * as Dialog from '@radix-ui/react-dialog';
import {
  Archive,
  Circle,
  FolderOpen,
  Layers,
  LayoutGrid,
  LayoutList,
  Pin,
  Search,
  Settings,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useReducer, useRef } from 'react';

import { uiPatchReducer } from '@/lib/settings-form-draft';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { PageTabs } from '@/components/ui/page-tabs';
import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { SessionCard, type SessionCardAction } from '@/features/sessions/session-card';
import { agentAvatarFromOptions, resolveSessionAgentId } from '@/features/sessions/session-agent-resolve';
import { SessionConfigSection } from '@/features/settings/session-config-section';
import { SessionDetailDrawer } from '@/features/sessions/session-detail-drawer';
import {
  archiveSession,
  deleteSession,
  exportSessionJson,
  getSessionDetail,
  getSessionStats,
  listSessions,
  pinSession,
  unarchiveSession,
  unpinSession,
} from '@/features/sessions/session-api';
import type { SessionDetail, SessionMetadata, SessionStats } from '@/features/sessions/session.types';
import { Button } from '@/components/ui/button';
import {
  segmentedThumbActiveClassName,
  segmentedThumbBaseClassName,
  segmentedTrackClassName,
} from '@/components/ui/segmented-styles';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const PAGE_LIMIT = 20;

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

type StatusFilter = 'all' | 'active' | 'pinned' | 'archived';
type SessionsViewMode = 'grid' | 'list';
type SessionsTabId = 'sessions' | 'settings';

const SESSION_STATUS_FILTER_SET = new Set<StatusFilter>(['all', 'active', 'pinned', 'archived']);
const SESSION_VIEW_MODE_SET = new Set<SessionsViewMode>(['grid', 'list']);
const SESSIONS_TABS: readonly SessionsTabId[] = ['sessions', 'settings'];

function parseSessionsTab(raw: string | null): SessionsTabId {
  return raw && SESSIONS_TABS.includes(raw as SessionsTabId) ? (raw as SessionsTabId) : 'sessions';
}

type SessionsMessages = ReturnType<typeof messages>['sessions'];

function sessionsTabLabel(s: SessionsMessages, tab: SessionsTabId): string {
  return tab === 'sessions' ? s.tabsSessions : s.tabsSettings;
}

function sessionsTabHint(s: SessionsMessages, tab: SessionsTabId): string {
  return tab === 'sessions' ? s.tabsSessionsHint : s.tabsSettingsHint;
}

function SessionsTabs({
  s,
  activeTab,
  onChange,
}: {
  s: SessionsMessages;
  activeTab: SessionsTabId;
  onChange: (tab: SessionsTabId) => void;
}) {
  const items = SESSIONS_TABS.map((tab) => ({
    id: tab,
    label: sessionsTabLabel(s, tab),
    icon: tab === 'sessions' ? Layers : Settings,
  }));
  return <PageTabs items={items} activeTab={activeTab} onChange={onChange} ariaLabel={s.tabsAriaLabel} tabIdPrefix="sessions-tab" panelIdPrefix="sessions-panel" />;
}

function SessionsTabPanel({
  s,
  id,
  activeTab,
  plain = false,
  children,
}: {
  s: SessionsMessages;
  id: SessionsTabId;
  activeTab: SessionsTabId;
  plain?: boolean;
  children: ReactNode;
}) {
  if (activeTab !== id) return null;

  return (
    <section
      id={`sessions-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`sessions-tab-${id}`}
      className={plain ? 'contents' : 'rounded-2xl bg-surface-base px-4 py-5 sm:px-5'}
    >
      {plain ? (
        children
      ) : (
        <>
          <div className="mb-5">
            <div className="text-sm font-semibold text-fg">{sessionsTabLabel(s, id)}</div>
            <p className="mt-1 text-xs text-fg-subtle">{sessionsTabHint(s, id)}</p>
          </div>
          <div className="space-y-4">{children}</div>
        </>
      )}
    </section>
  );
}

type SessionsUi = {
  searchInput: string;
  debouncedSearch: string;
  statusFilter: StatusFilter;
  viewMode: SessionsViewMode;
  channelFilter: string;
  sessions: SessionMetadata[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  stats: SessionStats | null;
  detailOpen: boolean;
  detailLoading: boolean;
  detailSession: SessionDetail | null;
  confirmOpen: boolean;
  confirmKey: string | null;
};

function initSessionsUi(searchParams: URLSearchParams): SessionsUi {
  const initialStatus = searchParams.get('status');
  const initialView = searchParams.get('view');
  return {
    searchInput: searchParams.get('q') ?? '',
    debouncedSearch: (searchParams.get('q') ?? '').trim(),
    statusFilter: SESSION_STATUS_FILTER_SET.has(initialStatus as StatusFilter)
      ? (initialStatus as StatusFilter)
      : 'all',
    viewMode: SESSION_VIEW_MODE_SET.has(initialView as SessionsViewMode)
      ? (initialView as SessionsViewMode)
      : 'grid',
    channelFilter: (searchParams.get('channel') ?? '').trim(),
    sessions: [],
    loading: false,
    error: null,
    hasMore: false,
    stats: null,
    detailOpen: false,
    detailLoading: false,
    detailSession: null,
    confirmOpen: false,
    confirmKey: null,
  };
}

export function SessionsPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const s = m.sessions;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);
  const { data: chatAgents, mutate: mutateChatAgents } = useSWR(
    hasToken ? (['gateway-chat-agents', token] as const) : null,
    fetchChatAgents,
    { revalidateOnFocus: false },
  );
  const defaultAgentId = chatAgents?.defaultId ?? 'main';
  const agentItems = chatAgents?.items ?? [];
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseSessionsTab(searchParams.get('tab'));
  const setActiveTab = useCallback(
    (tab: SessionsTabId) => {
      const params = new URLSearchParams(searchParams);
      if (tab === 'sessions') params.delete('tab');
      else params.set('tab', tab);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const [ui, dispatch] = useReducer(uiPatchReducer<SessionsUi>, searchParams, initSessionsUi);
  const {
    searchInput,
    debouncedSearch,
    statusFilter,
    viewMode,
    channelFilter,
    sessions,
    loading,
    error,
    hasMore,
    stats,
    detailOpen,
    detailLoading,
    detailSession,
    confirmOpen,
    confirmKey,
  } = ui;

  useEffect(() => {
    const t = setTimeout(() => {
      const next = searchInput.trim();
      if (debouncedSearch !== next) {
        dispatch({ type: 'patch', patch: { debouncedSearch: next } });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, debouncedSearch]);

  // Sync URL → local state during render so the URL→state→URL effect chain doesn't add a render.
  const searchParamsKey = searchParams.toString();
  const trackedSearchParamsKeyRef = useRef(searchParamsKey);
  if (trackedSearchParamsKeyRef.current !== searchParamsKey) {
    trackedSearchParamsKeyRef.current = searchParamsKey;
    const nextQ = searchParams.get('q') ?? '';
    const nextStatusRaw = searchParams.get('status');
    const nextViewRaw = searchParams.get('view');
    const nextChannel = (searchParams.get('channel') ?? '').trim();
    const nextStatus: StatusFilter = SESSION_STATUS_FILTER_SET.has(nextStatusRaw as StatusFilter)
      ? (nextStatusRaw as StatusFilter)
      : 'all';
    const nextView: SessionsViewMode = SESSION_VIEW_MODE_SET.has(nextViewRaw as SessionsViewMode)
      ? (nextViewRaw as SessionsViewMode)
      : 'grid';
    const nextDebouncedQ = nextQ.trim();

    dispatch({
      type: 'patch',
      patch: {
        ...(searchInput !== nextQ ? { searchInput: nextQ } : {}),
        ...(debouncedSearch !== nextDebouncedQ ? { debouncedSearch: nextDebouncedQ } : {}),
        ...(statusFilter !== nextStatus ? { statusFilter: nextStatus } : {}),
        ...(viewMode !== nextView ? { viewMode: nextView } : {}),
        ...(channelFilter !== nextChannel ? { channelFilter: nextChannel } : {}),
      },
    });
  }

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    const nextQ = debouncedSearch.trim();
    if (nextQ) params.set('q', nextQ);
    else params.delete('q');
    if (statusFilter !== 'all') params.set('status', statusFilter);
    else params.delete('status');
    if (viewMode !== 'grid') params.set('view', viewMode);
    else params.delete('view');
    if (channelFilter) params.set('channel', channelFilter);
    else params.delete('channel');
    const next = params.toString();
    if (next !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
  }, [debouncedSearch, searchParams, setSearchParams, statusFilter, viewMode, channelFilter]);

  useEffect(() => {
    if (!hasToken || activeTab !== 'sessions') return;
    let cancelled = false;
    (async () => {
      dispatch({ type: 'patch', patch: { loading: true, error: null } });
      try {
        const result = await listSessions({
          limit: PAGE_LIMIT,
          offset: 0,
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
          ...(channelFilter ? { channel: channelFilter } : {}),
        });
        if (cancelled) return;
        dispatch({
          type: 'patch',
          patch: { sessions: result.items, hasMore: result.hasMore },
        });
      } catch (e) {
        if (!cancelled) {
          dispatch({
            type: 'patch',
            patch: { error: e instanceof Error ? e.message : s.loadError },
          });
        }
      } finally {
        if (!cancelled) dispatch({ type: 'patch', patch: { loading: false } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasToken, activeTab, debouncedSearch, statusFilter, channelFilter, s.loadError]);

  useEffect(() => {
    if (!hasToken || activeTab !== 'sessions') return;
    void getSessionStats()
      .then((st) => dispatch({ type: 'patch', patch: { stats: st } }))
      .catch(() => {});
  }, [hasToken, activeTab]);

  useEffect(() => {
    if (!hasToken || activeTab !== 'sessions') return;
    const onConfigReload = () => void mutateChatAgents();
    window.addEventListener('config-reload', onConfigReload);
    return () => window.removeEventListener('config-reload', onConfigReload);
  }, [hasToken, activeTab, mutateChatAgents]);

  useEffect(() => {
    if (!hasToken || activeTab !== 'sessions') return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ key?: string; name?: string }>).detail;
      if (!detail?.key || detail.name === undefined) return;
      dispatch({
        type: 'patch',
        patch: {
          sessions: sessions.map((row) =>
            row.key === detail.key ? { ...row, name: detail.name } : row,
          ),
          detailSession:
            detailSession && detailSession.key === detail.key
              ? { ...detailSession, name: detail.name }
              : detailSession,
        },
      });
    };
    window.addEventListener('session-updated', handler);
    return () => {
      window.removeEventListener('session-updated', handler);
    };
  }, [hasToken, activeTab, sessions, detailSession]);

  const loadMore = useCallback(async () => {
    if (!hasToken || loading || !hasMore) return;
    dispatch({ type: 'patch', patch: { loading: true, error: null } });
    try {
      const result = await listSessions({
        limit: PAGE_LIMIT,
        offset: sessions.length,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(channelFilter ? { channel: channelFilter } : {}),
      });
      dispatch({
        type: 'patch',
        patch: { sessions: [...sessions, ...result.items], hasMore: result.hasMore },
      });
    } catch (e) {
      dispatch({ type: 'patch', patch: { error: e instanceof Error ? e.message : s.loadError } });
    } finally {
      dispatch({ type: 'patch', patch: { loading: false } });
    }
  }, [
    hasToken,
    loading,
    hasMore,
    sessions.length,
    debouncedSearch,
    statusFilter,
    channelFilter,
    s.loadError,
  ]);

  const updateSessionStatus = useCallback(
    (key: string, status: SessionMetadata['status']) => {
      dispatch({
        type: 'patch',
        patch: {
          sessions: sessions.map((row) => (row.key === key ? { ...row, status } : row)),
          detailSession:
            detailSession && detailSession.key === key ? { ...detailSession, status } : detailSession,
        },
      });
    },
    [sessions, detailSession],
  );

  const openDetail = useCallback(async (key: string) => {
    dispatch({
      type: 'patch',
      patch: { detailOpen: true, detailLoading: true, detailSession: null },
    });
    try {
      const session = await getSessionDetail(key);
      dispatch({ type: 'patch', patch: { detailSession: session } });
    } catch {
      dispatch({ type: 'patch', patch: { detailOpen: false } });
    } finally {
      dispatch({ type: 'patch', patch: { detailLoading: false } });
    }
  }, []);

  const handleCardOpen = (key: string) => {
    void openDetail(key);
  };

  const handleCardAction = async (key: string, action: SessionCardAction) => {
    if (action === 'continue') {
      window.dispatchEvent(
        new CustomEvent('navigate-to-chat', { detail: { sessionKey: key }, bubbles: true }),
      );
      return;
    }
    if (action === 'delete') {
      dispatch({ type: 'patch', patch: { confirmKey: key, confirmOpen: true } });
      return;
    }
    try {
      switch (action) {
        case 'archive':
          await archiveSession(key);
          updateSessionStatus(key, 'archived');
          break;
        case 'unarchive':
          await unarchiveSession(key);
          updateSessionStatus(key, 'active');
          break;
        case 'pin':
          await pinSession(key);
          updateSessionStatus(key, 'pinned');
          break;
        case 'unpin':
          await unpinSession(key);
          updateSessionStatus(key, 'active');
          break;
        case 'export': {
          const content = await exportSessionJson(key);
          const blob = new Blob([content], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `session-${key.replace(/[^a-z0-9]/gi, '_')}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          break;
        }
        default:
          break;
      }
      void getSessionStats()
        .then((st) => dispatch({ type: 'patch', patch: { stats: st } }))
        .catch(() => {});
    } catch {
      /* toast optional */
    }
  };

  const runDelete = async (key: string) => {
    try {
      await deleteSession(key);
      dispatch({
        type: 'patch',
        patch: {
          sessions: sessions.filter((row) => row.key !== key),
          detailSession: detailSession?.key === key ? null : detailSession,
          ...(detailSession?.key === key ? { detailOpen: false } : {}),
        },
      });
      void getSessionStats()
        .then((st) => dispatch({ type: 'patch', patch: { stats: st } }))
        .catch(() => {});
    } catch {
      /* ignore */
    }
  };

  const cardLabels = {
    continueChat: s.continueChat,
    archive: s.archive,
    unarchive: s.unarchive,
    pin: s.pin,
    unpin: s.unpin,
    export: s.export,
    delete: s.delete,
    unnamedSession: m.chat.newSession,
  };

  const detailLabels = {
    close: s.close,
    detailLoading: s.detailLoading,
    detailMessages: s.detailMessages,
    detailExport: s.detailExport,
    archive: s.archive,
    unarchive: s.unarchive,
    pin: s.pin,
    unpin: s.unpin,
    delete: s.delete,
    unnamedSession: m.chat.newSession,
  };

  const filters: { key: StatusFilter; label: string; icon: typeof Layers }[] = [
    { key: 'all', label: s.filterAll, icon: Layers },
    { key: 'active', label: s.filterActive, icon: Circle },
    { key: 'pinned', label: s.filterPinned, icon: Pin },
    { key: 'archived', label: s.filterArchived, icon: Archive },
  ];

  const channelChips = (() => {
    const entries = Object.entries(stats?.byChannel ?? {}).sort((a, b) => b[1] - a[1]);
    const top = entries.slice(0, 6).map(([id]) => id);
    const topSet = new Set(top);
    // Keep a few common channels visible even if no stats yet.
    for (const c of ['telegram', 'weixin', 'feishu']) {
      if (!topSet.has(c)) {
        top.push(c);
        topSet.add(c);
      }
    }
    return top.slice(0, 8);
  })();

  if (!hasToken) {
    return (
      <div className="w-full px-3 py-16 text-center text-sm text-fg-muted sm:px-5 xl:px-6">
        {s.needToken}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-surface-panel">
      <div className="flex w-full flex-col gap-6 px-3 py-6 sm:px-5 xl:px-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-fg">{s.title}</h1>
        </header>

        <SessionsTabs s={s} activeTab={activeTab} onChange={setActiveTab} />

        <SessionsTabPanel s={s} id="settings" activeTab={activeTab} plain>
          <SessionConfigSection hasToken={hasToken} />
        </SessionsTabPanel>

        <SessionsTabPanel s={s} id="sessions" activeTab={activeTab} plain>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {filters.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                aria-pressed={statusFilter === key}
                onClick={() => dispatch({ type: 'patch', patch: { statusFilter: key } })}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium',
                  interaction.transition,
                  /* Filter chips (selection): no press scale. */
                  interaction.focusRingPanel,
                  statusFilter === key
                    ? 'bg-accent-soft text-accent-fg'
                    : 'bg-surface-base text-fg-muted hover:bg-surface-hover hover:text-fg dark:bg-surface-hover/35',
                )}
              >
                <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                {label}
              </button>
            ))}
          </div>

          <div className="flex w-full min-w-0 items-center gap-2 rounded-xl bg-surface-base px-3 py-2 transition-colors lg:max-w-md dark:bg-surface-hover/40">
            <Search className="size-4 shrink-0 text-fg-disabled" strokeWidth={1.75} aria-hidden />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => dispatch({ type: 'patch', patch: { searchInput: e.target.value } })}
              placeholder={s.searchPlaceholder}
              data-debounced-query={debouncedSearch || undefined}
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-fg placeholder:text-fg-disabled focus:outline-none focus:ring-0"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-fg-subtle">{s.filterChannelLabel}</span>
          <button
            type="button"
            aria-pressed={!channelFilter}
            onClick={() => dispatch({ type: 'patch', patch: { channelFilter: '' } })}
            className={cn(
              'inline-flex items-center rounded-xl px-3 py-2 text-sm font-medium',
              interaction.transition,
              interaction.focusRingPanel,
              !channelFilter
                ? 'bg-accent-soft text-accent-fg'
                : 'bg-surface-base text-fg-muted hover:bg-surface-hover hover:text-fg dark:bg-surface-hover/35',
            )}
          >
            {s.filterChannelAll}
          </button>
          {channelChips.map((chId) => (
            <button
              key={chId}
              type="button"
              aria-pressed={channelFilter === chId}
              onClick={() => dispatch({ type: 'patch', patch: { channelFilter: chId } })}
              className={cn(
                'inline-flex items-center rounded-xl px-3 py-2 text-sm font-medium',
                interaction.transition,
                interaction.focusRingPanel,
                channelFilter === chId
                  ? 'bg-accent-soft text-accent-fg'
                  : 'bg-surface-base text-fg-muted hover:bg-surface-hover hover:text-fg dark:bg-surface-hover/35',
              )}
            >
              {chId}
              {stats?.byChannel?.[chId] != null ? (
                <span className="ml-2 rounded-full bg-surface-hover px-2 py-0.5 text-[11px] text-fg-subtle">
                  {stats.byChannel[chId]}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {stats ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [stats.totalSessions, s.totalSessions],
              [stats.activeSessions, s.activeSessions],
              [stats.pinnedSessions, s.pinnedSessions],
              [stats.archivedSessions, s.archivedSessions],
            ].map(([value, label]) => (
              <div
                key={label}
                className="rounded-xl bg-surface-base p-3 dark:bg-surface-hover/30"
              >
                <div className="text-lg font-semibold tabular-nums text-fg">{value}</div>
                <div className="text-xs text-fg-muted">{label}</div>
              </div>
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-edge bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-edge dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-fg-muted">{interpolate(s.sessionCount, { count: sessions.length })}</p>
          <div className={segmentedTrackClassName} role="group" aria-label={s.layoutToggleGroup}>
            <Button
              type="button"
              variant="segmented"
              title={s.gridView}
              aria-pressed={viewMode === 'grid'}
              onClick={() => dispatch({ type: 'patch', patch: { viewMode: 'grid' } })}
              className={cn(
                segmentedThumbBaseClassName,
                'size-7 p-0',
                viewMode === 'grid' && segmentedThumbActiveClassName,
                viewMode === 'grid' && 'text-accent-fg',
              )}
            >
              <LayoutGrid className="size-3.5" strokeWidth={1.5} />
            </Button>
            <Button
              type="button"
              variant="segmented"
              title={s.listView}
              aria-pressed={viewMode === 'list'}
              onClick={() => dispatch({ type: 'patch', patch: { viewMode: 'list' } })}
              className={cn(
                segmentedThumbBaseClassName,
                'size-9 p-0',
                viewMode === 'list' && segmentedThumbActiveClassName,
                viewMode === 'list' && 'text-accent-fg',
              )}
            >
              <LayoutList className="size-3.5" strokeWidth={1.5} />
            </Button>
          </div>
        </div>

        {loading && sessions.length === 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-xl bg-surface-hover/60 dark:bg-surface-hover/40"
              />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl bg-surface-base py-16 text-center dark:bg-surface-hover/25">
            <FolderOpen className="mb-3 size-12 text-fg-disabled" strokeWidth={1.25} aria-hidden />
            <p className="text-base font-semibold text-fg">{s.noSessions}</p>
            <p className="mt-1 max-w-sm text-sm text-fg-muted">{s.noSessionsDescription}</p>
            <Button
              variant="primary"
              className="mt-6"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('navigate-to-chat', { detail: { sessionKey: '' }, bubbles: true }));
              }}
            >
              {s.startNewChat}
            </Button>
          </div>
        ) : (
          <>
            <div
              className={cn(
                'grid min-w-0 gap-3',
                viewMode === 'grid' ? 'sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1',
              )}
              data-debounced-query={debouncedSearch || undefined}
            >
              {sessions.map((session) => {
                const sessionAgentId = resolveSessionAgentId(session, defaultAgentId);
                return (
                  <SessionCard
                    key={session.key}
                    session={session}
                    variant={viewMode}
                    labels={cardLabels}
                    sessionAgentId={sessionAgentId}
                    sessionAgentAvatar={agentAvatarFromOptions(sessionAgentId, agentItems)}
                    onOpen={() => handleCardOpen(session.key)}
                    onAction={(action) => void handleCardAction(session.key, action)}
                  />
                );
              })}
            </div>
            {hasMore ? (
              <div className="flex justify-center pt-2">
                <Button type="button" variant="secondary" disabled={loading} onClick={() => void loadMore()}>
                  {s.loadMore}
                </Button>
              </div>
            ) : null}
          </>
        )}
        </SessionsTabPanel>
      </div>

      <SessionDetailDrawer
        open={detailOpen}
        loading={detailLoading}
        session={detailSession}
        sessionAgentId={
          detailSession ? resolveSessionAgentId(detailSession, defaultAgentId) : undefined
        }
        sessionAgentAvatar={
          detailSession
            ? agentAvatarFromOptions(
                resolveSessionAgentId(detailSession, defaultAgentId),
                agentItems,
              )
            : undefined
        }
        labels={detailLabels}
        onClose={() => {
          dispatch({ type: 'patch', patch: { detailOpen: false, detailSession: null } });
        }}
        onArchive={() => detailSession && void handleCardAction(detailSession.key, 'archive')}
        onUnarchive={() => detailSession && void handleCardAction(detailSession.key, 'unarchive')}
        onPin={() => detailSession && void handleCardAction(detailSession.key, 'pin')}
        onUnpin={() => detailSession && void handleCardAction(detailSession.key, 'unpin')}
        onExport={() => detailSession && void handleCardAction(detailSession.key, 'export')}
        onDelete={() =>
          detailSession &&
          dispatch({ type: 'patch', patch: { confirmKey: detailSession.key, confirmOpen: true } })
        }
      />

      <Dialog.Root
        open={confirmOpen}
        onOpenChange={(open) => dispatch({ type: 'patch', patch: { confirmOpen: open } })}
      >
        <Dialog.Portal>
          <Dialog.Overlay
            className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)}
          />
          <Dialog.Content
            className={cn(
              'xopc-dialog-content fixed left-1/2 top-1/2 w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-4 shadow-popover dark:border-edge',
              SETTINGS_SHELL_CONTENT_Z,
            )}
          >
            <Dialog.Title className="text-base font-semibold text-fg">{s.deleteSessionTitle}</Dialog.Title>
            <p className="mt-2 text-sm text-fg-muted">
              {confirmKey
                ? interpolate(s.deleteSessionMessage, {
                    name:
                      sessions.find((x) => x.key === confirmKey)?.name?.trim() || m.chat.newSession,
                  })
                : ''}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => dispatch({ type: 'patch', patch: { confirmOpen: false } })}
              >
                {s.cancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                className="bg-red-600 hover:bg-red-700"
                onClick={() => {
                  if (confirmKey) void runDelete(confirmKey);
                  dispatch({ type: 'patch', patch: { confirmOpen: false, confirmKey: null } });
                }}
              >
                {s.delete}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
