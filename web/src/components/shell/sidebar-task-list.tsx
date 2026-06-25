import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import {
  CheckSquare,
  ClipboardCopy,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

import { SessionChannelIcon } from '@/components/shell/session-channel-icon';
import { Button } from '@/components/ui/button';
import { SlidingSegmented } from '@/components/ui/sliding-segmented';
import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { WEB_UI_SESSION_SOURCE_CHANNELS } from '@/features/chat/session/session-manager';
import { useSidebarSessionAgentRun } from '@/features/chat/session/use-sidebar-session-agent-run';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import { agentAvatarFromOptions, resolveSessionAgentId } from '@/features/sessions/session-agent-resolve';
import {
  deleteSession,
  listSessions,
  pinSession,
  renameSession,
  unpinSession,
} from '@/features/sessions/session-api';
import { patchSidebarSessionName } from '@/features/sessions/patch-sidebar-session-meta';
import type { SessionMetadata } from '@/features/sessions/session.types';
import { messages } from '@/i18n/messages';
import { formControlBorderFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const PAGE_SIZE = 20;

type SessionSidebarFilter = 'web' | 'channels';

type SidebarTaskPage = {
  items: SessionMetadata[];
  hasMore: boolean;
};

type TimelineGroup = 'pinned' | 'today' | 'yesterday' | 'last7days' | 'thisMonth' | 'older';

const TIMELINE_GROUP_ORDER: TimelineGroup[] = ['pinned', 'today', 'yesterday', 'last7days', 'thisMonth', 'older'];

function getTimelineGroup(session: SessionMetadata): TimelineGroup {
  if (session.status === 'pinned') return 'pinned';
  const updated = new Date(session.updatedAt);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
  const startOf7DaysAgo = new Date(startOfToday.getTime() - 6 * 86400000);

  if (updated >= startOfToday) return 'today';
  if (updated >= startOfYesterday) return 'yesterday';
  if (updated >= startOf7DaysAgo) return 'last7days';
  if (updated.getMonth() === now.getMonth() && updated.getFullYear() === now.getFullYear()) return 'thisMonth';
  return 'older';
}

type TimelineGroupLabelKey = 'timelinePinned' | 'timelineToday' | 'timelineYesterday' | 'timelineLast7Days' | 'timelineThisMonth' | 'timelineOlder';

const TIMELINE_LABEL_KEY: Record<TimelineGroup, TimelineGroupLabelKey> = {
  pinned: 'timelinePinned',
  today: 'timelineToday',
  yesterday: 'timelineYesterday',
  last7days: 'timelineLast7Days',
  thisMonth: 'timelineThisMonth',
  older: 'timelineOlder',
};

function sessionTitle(s: SessionMetadata, unnamedLabel: string): string {
  return s.name?.trim() || unnamedLabel;
}

/** Active chat session key from `/chat/:key` (excludes `/chat/new`). */
function chatSessionKeyFromPath(pathname: string): string | undefined {
  const m = /^\/chat\/([^/]+)$/.exec(pathname);
  if (!m) return undefined;
  const seg = decodeURIComponent(m[1]);
  if (seg === 'new') return undefined;
  return seg;
}

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

function rowShellClass(isActive: boolean): string {
  return cn(
    // `px-4` list + `pl-3` row = same inset as nav `px-4` + item `px-3` → aligns with menu icons.
    'group flex w-full min-w-0 items-center gap-0.5 rounded-xl pl-1.5 pr-1 text-left text-sm font-medium leading-5 transition-colors duration-200 ease-out',
    'focus-within:outline-none',
    isActive ? 'bg-surface-active text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
  );
}

const SidebarTaskRow = memo(function SidebarTaskRow({
  session,
  isActive,
  showSourceChannelIcon,
  onNavigate,
  mutate,
  onRequestRename,
  onRequestDelete,
  sb,
  sess,
  clipboard,
  defaultUnnamedTitle,
  sessionAgentId,
  sessionAgentAvatar,
}: {
  session: SessionMetadata;
  isActive: boolean;
  /** When true (IM list), show a channel glyph before the title. */
  showSourceChannelIcon?: boolean;
  onNavigate?: () => void;
  mutate: () => void;
  onRequestRename: (key: string) => void;
  onRequestDelete: (key: string) => void;
  sb: ReturnType<typeof messages>['sidebar'];
  sess: ReturnType<typeof messages>['sessions'];
  clipboard: ReturnType<typeof messages>['clipboard'];
  defaultUnnamedTitle: string;
  sessionAgentId: string;
  sessionAgentAvatar?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const agentRunActive = useSidebarSessionAgentRun(session.key);
  const title = sessionTitle(session, defaultUnnamedTitle);
  const isPinned = session.status === 'pinned';

  const handlePinToggle = async () => {
    try {
      if (isPinned) {
        await unpinSession(session.key);
      } else {
        await pinSession(session.key);
      }
      setMenuOpen(false);
      void mutate();
    } catch {
      /* optional toast */
    }
  };

  const copyChatId = async () => {
    const ok = await copyTextToClipboard(session.key);
    setMenuOpen(false);
    if (ok) {
      showComposerNotification('success', sb.taskChatIdCopied, undefined, { duration: 2000 });
      return;
    }
    showComposerNotification('warning', clipboard.copyFailed, undefined, { duration: 4000 });
  };

  return (
    <div className={rowShellClass(isActive)}>
      <Link
        to={`/chat/${encodeURIComponent(session.key)}`}
        className={cn(
          'min-w-0 flex-1 rounded-xl py-1 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
          'flex min-w-0 items-center gap-2',
        )}
        title={title}
        onClick={() => onNavigate?.()}
      >
        <span className="relative shrink-0">
          <AgentAvatarDisplay
            agentId={sessionAgentId}
            avatar={sessionAgentAvatar}
            size={24}
            className="size-6 shrink-0 ring-1 ring-edge/60 dark:ring-edge"
          />
          {agentRunActive ? (
            <span
              className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex size-2.5 items-center justify-center"
              title={sb.taskSessionAgentRunning}
              aria-label={sb.taskSessionAgentRunning}
            >
              <span className="absolute size-full animate-ping rounded-full bg-accent/70" aria-hidden />
              <span
                className="relative size-2 rounded-full bg-accent shadow-sm ring-2 ring-surface-panel dark:ring-surface-base"
                aria-hidden
              />
            </span>
          ) : null}
        </span>
        {showSourceChannelIcon ? (
          <>
            <span
              className={cn(
                'flex size-4 shrink-0 items-center justify-center',
                isActive ? 'text-fg-muted' : 'text-fg-subtle',
              )}
              title={session.sourceChannel}
            >
              <SessionChannelIcon sourceChannel={session.sourceChannel} className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate">{title}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate">{title}</span>
        )}
      </Link>
      <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-opacity',
              'opacity-0 group-hover:opacity-100 focus:opacity-100',
              menuOpen && 'opacity-100',
              'hover:bg-surface-hover hover:text-fg',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
            )}
            aria-label={sb.taskSessionMenuAria}
            title={sb.taskSessionMenuAria}
            aria-expanded={menuOpen}
          >
            <MoreHorizontal className="size-4" strokeWidth={2} aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="z-50 w-[9.25rem] rounded-lg border border-edge bg-surface-panel p-1 shadow-elevated dark:border-edge"
            side="bottom"
            align="end"
            sideOffset={4}
            collisionPadding={12}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
              onClick={() => {
                setMenuOpen(false);
                onRequestRename(session.key);
              }}
            >
              <Pencil className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              {sb.taskRename}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
              onClick={() => void handlePinToggle()}
            >
              {isPinned ? (
                <PinOff className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              ) : (
                <Pin className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              )}
              {isPinned ? sess.unpin : sess.pin}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
              onClick={() => void copyChatId()}
            >
              <ClipboardCopy className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              {sb.taskCopyChatId}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium leading-snug text-red-600 transition-colors hover:bg-surface-hover dark:text-red-400"
              onClick={() => {
                setMenuOpen(false);
                onRequestDelete(session.key);
              }}
            >
              <Trash2 className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              {sb.taskDeleteTask}
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
});

export function SidebarTaskList({ onNavigate }: { onNavigate?: () => void }) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sb = m.sidebar;
  const sess = m.sessions;
  const token = useGatewayStore((s) => s.token);
  const openTokenDialog = useGatewayStore((s) => s.openTokenDialog);

  const { data: chatAgents, mutate: mutateChatAgents } = useSWR(
    token ? (['gateway-chat-agents', token] as const) : null,
    fetchChatAgents,
    { revalidateOnFocus: false },
  );
  const defaultAgentId = chatAgents?.defaultId ?? 'main';
  const agentItems = chatAgents?.items ?? [];

  useEffect(() => {
    const onConfigReload = () => void mutateChatAgents();
    window.addEventListener('config-reload', onConfigReload);
    return () => window.removeEventListener('config-reload', onConfigReload);
  }, [mutateChatAgents]);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const [renameKey, setRenameKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const lastActiveSessionKeyRef = useRef<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<SessionSidebarFilter>('web');

  const { data, size, setSize, isValidating, mutate } = useSWRInfinite<SidebarTaskPage>(
    (pageIndex, previousPageData) => {
      if (!token) return null;
      if (previousPageData && !previousPageData.hasMore) return null;
      return ['sidebar-tasks', token, sessionFilter, pageIndex] as const;
    },
    async ([, , filter, pageIndex]: readonly [
      'sidebar-tasks',
      string,
      SessionSidebarFilter,
      number,
    ]) => {
      const offset = pageIndex * PAGE_SIZE;
      if (filter === 'web') {
        const result = await listSessions({
          channel: WEB_UI_SESSION_SOURCE_CHANNELS,
          limit: PAGE_SIZE,
          offset,
        });
        return {
          items: result.items,
          hasMore: result.hasMore,
        };
      }
      const result = await listSessions({
        // IM channel sessions: include Feishu/Lark alongside Telegram/WeChat.
        channel: 'telegram,weixin,feishu,lark',
        limit: PAGE_SIZE,
        offset,
      });
      return {
        items: result.items,
        hasMore: result.hasMore,
      };
    },
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    void setSize(1);
  }, [sessionFilter, setSize]);

  const items = useMemo(() => {
    const pages = data ?? [];
    const out: SessionMetadata[] = [];
    const seen = new Set<string>();
    for (const p of pages) {
      for (const s of p.items) {
        if (!seen.has(s.key)) {
          seen.add(s.key);
          out.push(s);
        }
      }
    }
    return out;
  }, [data]);

  const groupedItems = useMemo(() => {
    const groups: Record<TimelineGroup, SessionMetadata[]> = {
      pinned: [], today: [], yesterday: [], last7days: [], thisMonth: [], older: [],
    };
    for (const s of items) {
      groups[getTimelineGroup(s)].push(s);
    }
    return groups;
  }, [items]);

  const loadingMore = Boolean(data && size > data.length);
  const lastPage = data?.[data.length - 1];
  const hasMorePages = lastPage?.hasMore ?? false;
  const loadingFirst = Boolean(token && !data && isValidating);

  const onScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (!hasMorePages || loadingMore) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight - scrollTop - clientHeight > 100) return;
      void setSize((s) => s + 1);
    },
    [hasMorePages, loadingMore, setSize],
  );

  useEffect(() => {
    if (!token) return;
    const onSessionListRefresh = () => {
      void mutate();
    };
    const onSessionUpdated = (e: Event) => {
      const d = (e as CustomEvent<{ key?: string; name?: string }>).detail;
      if (!d?.key) {
        void mutate();
        return;
      }
      if (typeof d.name === 'string' && d.name.trim()) {
        if (data?.length) {
          patchSidebarSessionName(mutate, d.key, d.name);
        } else {
          void mutate();
        }
        return;
      }
      void mutate();
    };
    window.addEventListener('session-updated', onSessionUpdated);
    window.addEventListener('session-created', onSessionListRefresh);
    return () => {
      window.removeEventListener('session-updated', onSessionUpdated);
      window.removeEventListener('session-created', onSessionListRefresh);
    };
  }, [token, mutate, data?.length]);

  // If a server page has no web UI sessions after filtering, fetch the next page until we have rows or run out.
  useEffect(() => {
    if (!token || !data?.length || loadingMore) return;
    if (items.length > 0) return;
    if (!lastPage?.hasMore) return;
    if (sessionFilter !== 'web') return;
    void setSize((s) => s + 1);
  }, [token, data, items.length, loadingMore, lastPage?.hasMore, setSize, sessionFilter]);

  const activeSessionKey = chatSessionKeyFromPath(pathname);

  // Refetch on session switch (skip initial mount) to refresh metadata (message count, etc).
  useEffect(() => {
    if (!token || !activeSessionKey || sessionFilter !== 'web') return;
    if (lastActiveSessionKeyRef.current === null) {
      lastActiveSessionKeyRef.current = activeSessionKey;
      return;
    }
    if (lastActiveSessionKeyRef.current === activeSessionKey) return;
    lastActiveSessionKeyRef.current = activeSessionKey;
    void mutate();
  }, [token, activeSessionKey, sessionFilter, mutate]);

  const openRename = useCallback((key: string) => {
    const row = items.find((s) => s.key === key);
    setRenameKey(key);
    setRenameDraft(row?.name?.trim() ?? '');
  }, [items]);

  const runRename = async () => {
    if (!renameKey) return;
    const name = renameDraft.trim();
    if (!name) return;
    try {
      await renameSession(renameKey, name);
      setRenameKey(null);
      void mutate();
    } catch {
      /* optional toast */
    }
  };

  const runDelete = async (key: string) => {
    try {
      await deleteSession(key);
      if (activeSessionKey === key) {
        navigate('/chat/new');
      }
      void mutate();
    } catch {
      /* optional toast */
    }
  };

  const renameTarget = renameKey ? items.find((s) => s.key === renameKey) : undefined;

  if (!token) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-1.5 px-4 pt-2">
          <div className="rounded-xl bg-surface-panel p-3">
            <p className="text-xs leading-relaxed text-fg-muted">{sb.taskListNeedToken}</p>
            <Button
              type="button"
              variant="secondary"
              className="mt-3 h-8 w-full text-xs font-medium"
              onClick={() => {
                openTokenDialog();
                onNavigate?.();
              }}
            >
              {sb.taskListAddToken}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          'app-sidebar-nav-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain',
          'pb-2',
        )}
        onScroll={onScroll}
      >
        <div className="sticky top-0 z-[1] bg-surface-base px-4 pb-1 pt-2">
          <div className="mt-2">
            <SlidingSegmented
              value={sessionFilter}
              onChange={setSessionFilter}
              aria-label={sb.sessionChannelFilterAria}
              options={[
                { value: 'web', label: sb.sessionTasksTab, icon: CheckSquare },
                { value: 'channels', label: sb.sessionChannelsTab, icon: MessageCircle },
              ]}
            />
          </div>
        </div>

        {loadingFirst ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-fg-subtle" strokeWidth={1.75} aria-hidden />
          </div>
        ) : items.length > 0 ? (
          <div className="flex flex-col gap-0.5 px-4">
            {TIMELINE_GROUP_ORDER.map((group) => {
              const groupSessions = groupedItems[group];
              if (groupSessions.length === 0) return null;
              return (
                <div key={group} className="flex flex-col gap-0.5">
                  <div className="sticky top-0 z-[1] bg-surface-base pb-0.5 pt-2.5">
                    <span className="pl-2 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                      {sb[TIMELINE_LABEL_KEY[group]]}
                    </span>
                  </div>
                  {groupSessions.map((session) => {
                    const sessionAgentId = resolveSessionAgentId(session, defaultAgentId);
                    return (
                      <SidebarTaskRow
                        key={session.key}
                        session={session}
                        isActive={activeSessionKey === session.key}
                        showSourceChannelIcon={sessionFilter === 'channels'}
                        onNavigate={onNavigate}
                        mutate={mutate}
                        onRequestRename={openRename}
                        onRequestDelete={setDeleteKey}
                        sb={sb}
                        sess={sess}
                        clipboard={m.clipboard}
                        defaultUnnamedTitle={m.chat.newSession}
                        sessionAgentId={sessionAgentId}
                        sessionAgentAvatar={agentAvatarFromOptions(sessionAgentId, agentItems)}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-4 pb-2">
            <p className="rounded-xl bg-surface-panel p-3 text-xs leading-relaxed text-fg-muted">
              {sb.taskListEmpty}
            </p>
          </div>
        )}

        {loadingMore ? (
          <div className="flex justify-center py-2" aria-busy>
            <Loader2 className="size-4 animate-spin text-fg-subtle" strokeWidth={1.75} aria-hidden />
          </div>
        ) : null}
      </div>

      <Dialog.Root open={renameKey !== null} onOpenChange={(o) => !o && setRenameKey(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[60] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-4 shadow-popover dark:border-edge">
            <Dialog.Title className="text-base font-semibold text-fg">{sb.taskRenameTitle}</Dialog.Title>
            <label className="mt-3 block text-xs font-medium text-fg-subtle" htmlFor="sidebar-rename-input">
              {sb.taskRenamePlaceholder}
            </label>
            <input
              id="sidebar-rename-input"
              type="text"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              className={cn(
                'mt-1.5 w-full rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg',
                formControlBorderFocusClass,
                'dark:border-edge',
              )}
              placeholder={renameTarget ? sessionTitle(renameTarget, m.chat.newSession) : ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runRename();
                }
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRenameKey(null)}>
                {sb.taskRenameCancel}
              </Button>
              <Button type="button" variant="primary" onClick={() => void runRename()} disabled={!renameDraft.trim()}>
                {sb.taskRenameSave}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={deleteKey !== null} onOpenChange={(o) => !o && setDeleteKey(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[60] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-4 shadow-popover dark:border-edge">
            <Dialog.Title className="text-base font-semibold text-fg">{sess.deleteSessionTitle}</Dialog.Title>
            <p className="mt-2 text-sm text-fg-muted">
              {deleteKey
                ? interpolate(sess.deleteSessionMessage, {
                    name: items.find((x) => x.key === deleteKey)?.name?.trim() || m.chat.newSession,
                  })
                : ''}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDeleteKey(null)}>
                {sess.cancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                className="bg-red-600 hover:bg-red-700"
                onClick={() => {
                  if (deleteKey) void runDelete(deleteKey);
                  setDeleteKey(null);
                }}
              >
                {sess.delete}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
