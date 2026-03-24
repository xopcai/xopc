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
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { SessionCard, type SessionCardAction } from '@/features/sessions/session-card';
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
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const PAGE_LIMIT = 20;

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

type StatusFilter = 'all' | 'active' | 'pinned' | 'archived';

export function SessionsPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const s = m.sessions;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState<SessionStats | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSession, setDetailSession] = useState<SessionDetail | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await listSessions({
          limit: PAGE_LIMIT,
          offset: 0,
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        });
        if (cancelled) return;
        setSessions(result.items);
        setHasMore(result.hasMore);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : s.loadError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasToken, debouncedSearch, statusFilter, s.loadError]);

  useEffect(() => {
    if (!hasToken) return;
    void getSessionStats()
      .then(setStats)
      .catch(() => {});
  }, [hasToken]);

  useEffect(() => {
    if (!hasToken) return;
    const url = new URL('/api/events', window.location.origin);
    if (token) url.searchParams.set('token', token);
    let es: EventSource;
    try {
      es = new EventSource(url.toString());
    } catch {
      return;
    }
    const handler = (e: MessageEvent) => {
      try {
        const detail = JSON.parse(e.data as string) as { key?: string; name?: string };
        if (!detail.key || detail.name === undefined) return;
        setSessions((prev) =>
          prev.map((row) => (row.key === detail.key ? { ...row, name: detail.name } : row)),
        );
        setDetailSession((prev) =>
          prev && prev.key === detail.key ? { ...prev, name: detail.name } : prev,
        );
      } catch {
        /* ignore */
      }
    };
    es.addEventListener('session.updated', handler as EventListener);
    return () => {
      es.close();
    };
  }, [hasToken, token]);

  const loadMore = useCallback(async () => {
    if (!hasToken || loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listSessions({
        limit: PAGE_LIMIT,
        offset: sessions.length,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      });
      setSessions((prev) => [...prev, ...result.items]);
      setHasMore(result.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : s.loadError);
    } finally {
      setLoading(false);
    }
  }, [
    hasToken,
    loading,
    hasMore,
    sessions.length,
    debouncedSearch,
    statusFilter,
    s.loadError,
  ]);

  const updateSessionStatus = useCallback((key: string, status: SessionMetadata['status']) => {
    setSessions((prev) => prev.map((row) => (row.key === key ? { ...row, status } : row)));
    setDetailSession((prev) => (prev && prev.key === key ? { ...prev, status } : prev));
  }, []);

  const openDetail = useCallback(async (key: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailSession(null);
    try {
      const session = await getSessionDetail(key);
      setDetailSession(session);
    } catch {
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
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
      setConfirmKey(key);
      setConfirmOpen(true);
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
      void getSessionStats().then(setStats).catch(() => {});
    } catch {
      /* toast optional */
    }
  };

  const runDelete = async (key: string) => {
    try {
      await deleteSession(key);
      setSessions((prev) => prev.filter((row) => row.key !== key));
      setDetailSession((prev) => (prev?.key === key ? null : prev));
      if (detailSession?.key === key) setDetailOpen(false);
      void getSessionStats().then(setStats).catch(() => {});
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
  };

  const filters: { key: StatusFilter; label: string; icon: typeof Layers }[] = [
    { key: 'all', label: s.filterAll, icon: Layers },
    { key: 'active', label: s.filterActive, icon: Circle },
    { key: 'pinned', label: s.filterPinned, icon: Pin },
    { key: 'archived', label: s.filterArchived, icon: Archive },
  ];

  if (!hasToken) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-sm text-fg-muted sm:px-8">
        {s.needToken}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-panel">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-fg">
            <FolderOpen className="size-5 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
            {s.title}
          </h1>
          <div className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-edge bg-surface-panel px-3 py-2 transition-colors focus-within:border-accent sm:max-w-md dark:border-edge">
            <Search className="size-4 shrink-0 text-fg-disabled" strokeWidth={1.75} aria-hidden />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={s.searchPlaceholder}
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-fg placeholder:text-fg-disabled focus:outline-none focus:ring-0"
            />
          </div>
        </header>

        <div className="flex flex-wrap gap-2">
          {filters.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors duration-150',
                statusFilter === key
                  ? 'border-accent bg-accent-soft text-accent-fg'
                  : 'border-edge bg-surface-panel text-fg-muted hover:bg-surface-hover hover:text-fg dark:border-edge',
              )}
            >
              <Icon className="size-4" strokeWidth={1.75} aria-hidden />
              {label}
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
                className="rounded-xl border border-edge-subtle bg-surface-hover/40 px-3 py-3 dark:border-edge"
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
              variant="ghost"
              title={s.gridView}
              aria-pressed={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
              className={cn(
                segmentedThumbBaseClassName,
                'size-7 p-0',
                viewMode === 'grid' && segmentedThumbActiveClassName,
                viewMode === 'grid' && 'text-accent-fg hover:text-accent-fg',
              )}
            >
              <LayoutGrid className="size-3.5" strokeWidth={1.5} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              title={s.listView}
              aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
              className={cn(
                segmentedThumbBaseClassName,
                'size-9 p-0',
                viewMode === 'list' && segmentedThumbActiveClassName,
                viewMode === 'list' && 'text-accent-fg hover:text-accent-fg',
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
                className="h-40 animate-pulse rounded-xl border border-edge-subtle bg-surface-hover/60 dark:border-edge"
              />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-edge-subtle py-16 text-center dark:border-edge">
            <FolderOpen className="mb-3 size-12 text-fg-disabled" strokeWidth={1.25} aria-hidden />
            <p className="text-base font-semibold text-fg">{s.noSessions}</p>
            <p className="mt-1 max-w-sm text-sm text-fg-muted">{s.noSessionsDescription}</p>
          </div>
        ) : (
          <>
            <div
              className={cn(
                'grid gap-3',
                viewMode === 'grid' ? 'sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1',
              )}
            >
              {sessions.map((session) => (
                <SessionCard
                  key={session.key}
                  session={session}
                  variant={viewMode}
                  labels={cardLabels}
                  onOpen={() => handleCardOpen(session.key)}
                  onAction={(action) => void handleCardAction(session.key, action)}
                />
              ))}
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
      </div>

      <SessionDetailDrawer
        open={detailOpen}
        loading={detailLoading}
        session={detailSession}
        labels={detailLabels}
        onClose={() => {
          setDetailOpen(false);
          setDetailSession(null);
        }}
        onArchive={() => detailSession && void handleCardAction(detailSession.key, 'archive')}
        onUnarchive={() => detailSession && void handleCardAction(detailSession.key, 'unarchive')}
        onPin={() => detailSession && void handleCardAction(detailSession.key, 'pin')}
        onUnpin={() => detailSession && void handleCardAction(detailSession.key, 'unpin')}
        onExport={() => detailSession && void handleCardAction(detailSession.key, 'export')}
        onDelete={() => detailSession && (setConfirmKey(detailSession.key), setConfirmOpen(true))}
      />

      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-slate-900/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-4 shadow-xl dark:border-edge">
            <Dialog.Title className="text-base font-semibold text-fg">{s.deleteSessionTitle}</Dialog.Title>
            <p className="mt-2 text-sm text-fg-muted">
              {confirmKey
                ? interpolate(s.deleteSessionMessage, {
                    name: sessions.find((x) => x.key === confirmKey)?.name?.trim() || confirmKey,
                  })
                : ''}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
                {s.cancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                className="bg-red-600 hover:bg-red-700"
                onClick={() => {
                  if (confirmKey) void runDelete(confirmKey);
                  setConfirmOpen(false);
                  setConfirmKey(null);
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
