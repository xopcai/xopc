import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import {
  ChevronDown,
  ClipboardCopy,
  ExternalLink,
  FolderKanban,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

import { SessionChannelIcon } from '@/components/shell/session-channel-icon';
import { Button } from '@/components/ui/button';
import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { useSidebarSessionAgentRun } from '@/features/chat/session/use-sidebar-session-agent-run';
import { createProjectSession, type Project } from '@/features/projects/api';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import { agentAvatarFromOptions, resolveSessionAgentId } from '@/features/sessions/session-agent-resolve';
import {
  deleteSession,
  fetchSidebarChatList,
  listSessions,
  pinSession,
  renameSession,
  unpinSession,
} from '@/features/sessions/session-api';
import type { SessionMetadata } from '@/features/sessions/session.types';
import { messages } from '@/i18n/messages';
import { formControlBorderFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const PAGE_SIZE = 20;
const PROJECT_LIMIT = 12;
const PROJECT_PREVIEW_LIMIT = 5;
const SIDEBAR_STALE_DAYS = 60;

type ProjectSidebarGroup = {
  project: Project;
  sessions: SessionMetadata[];
  sessionTotal: number;
  sessionHasMore: boolean;
  sessionLoading?: boolean;
  latestAt: number;
};

type ProjectSessionOverride = {
  sessions: SessionMetadata[];
  sessionTotal: number;
  hasMore: boolean;
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

function timeAgoLabel(value: string | undefined, language: string): string {
  if (!value) return '';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const diffMs = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) {
    const n = Math.max(1, Math.floor(diffMs / minute));
    return language === 'zh' ? `${n} 分` : `${n}m`;
  }
  if (diffMs < day) {
    const n = Math.max(1, Math.floor(diffMs / hour));
    return language === 'zh' ? `${n} 小时` : `${n}h`;
  }
  if (diffMs < 7 * day) {
    const n = Math.max(1, Math.floor(diffMs / day));
    return language === 'zh' ? `${n} 天` : `${n}d`;
  }
  const n = Math.max(1, Math.floor(diffMs / (7 * day)));
  return language === 'zh' ? `${n} 周` : `${n}w`;
}

function sessionUpdatedAtMs(session: SessionMetadata): number {
  const timestamp = new Date(session.updatedAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function projectUpdatedAtMs(project: Project): number {
  const timestamp = new Date(project.lastActiveAt ?? project.updatedAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isWebSession(session: SessionMetadata): boolean {
  return session.sourceChannel === 'webchat' || session.sourceChannel === 'web';
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
  timeLabel,
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
  timeLabel?: string;
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
            <span className="min-w-0 max-w-[8.5rem] truncate">{title}</span>
          </>
        ) : (
          <span className="min-w-0 max-w-[10rem] truncate">{title}</span>
        )}
        {timeLabel ? (
          <span
            className={cn(
              'ml-auto shrink-0 tabular-nums',
              isActive ? 'text-fg-muted' : 'text-fg-subtle',
            )}
            aria-hidden
          >
            {timeLabel}
          </span>
        ) : null}
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

function SidebarProjectSection({
  group,
  isExpanded,
  isCollapsed,
  activeSessionKey,
  onToggleCollapsed,
  onToggleExpanded,
  onCreateProjectChat,
  onNavigate,
  mutate,
  onRequestRename,
  onRequestDelete,
  sb,
  sess,
  clipboard,
  defaultUnnamedTitle,
  defaultAgentId,
  agentItems,
  language,
}: {
  group: ProjectSidebarGroup;
  isExpanded: boolean;
  isCollapsed: boolean;
  activeSessionKey?: string;
  onToggleCollapsed: (projectId: string) => void;
  onToggleExpanded: (projectId: string) => void;
  onCreateProjectChat: (project: Project) => void;
  onNavigate?: () => void;
  mutate: () => void;
  onRequestRename: (key: string) => void;
  onRequestDelete: (key: string) => void;
  sb: ReturnType<typeof messages>['sidebar'];
  sess: ReturnType<typeof messages>['sessions'];
  clipboard: ReturnType<typeof messages>['clipboard'];
  defaultUnnamedTitle: string;
  defaultAgentId: string;
  agentItems: Awaited<ReturnType<typeof fetchChatAgents>>['items'];
  language: string;
}) {
  const visibleSessions = isCollapsed
    ? []
    : isExpanded
    ? group.sessions
    : group.sessions.slice(0, PROJECT_PREVIEW_LIMIT);
  const hasLoadedMore = group.sessions.length > PROJECT_PREVIEW_LIMIT;
  const canToggleSessionLimit = group.sessionHasMore || hasLoadedMore;
  const showLess = isExpanded && !group.sessionHasMore && hasLoadedMore;
  const hasActiveSession = group.sessions.some((session) => session.key === activeSessionKey);

  return (
    <section className="flex flex-col gap-0.5" aria-label={group.project.name}>
      <div
        className={cn(
          'group flex min-w-0 items-center gap-2 rounded-xl px-2 text-sm font-medium leading-5',
          hasActiveSession ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted',
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
          onClick={() => onToggleCollapsed(group.project.id)}
          title={group.project.name}
          aria-expanded={!isCollapsed}
        >
          <FolderKanban className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 max-w-[9rem] truncate">{group.project.name}</span>
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-fg-subtle transition-transform duration-150 ease-out',
              isCollapsed && '-rotate-90',
            )}
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
        <Link
          to={`/projects/${encodeURIComponent(group.project.id)}`}
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-lg text-fg-subtle transition-opacity hover:bg-surface-hover hover:text-fg-muted',
            'opacity-0 group-hover:opacity-100 focus:opacity-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
          )}
          onClick={() => onNavigate?.()}
          title={sb.projectOpen}
          aria-label={sb.projectOpen}
        >
          <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
        </Link>
        <button
          type="button"
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-lg text-fg-subtle transition-opacity hover:bg-surface-hover hover:text-fg-muted',
            'opacity-0 group-hover:opacity-100 focus:opacity-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
          )}
          onClick={() => onCreateProjectChat(group.project)}
          title={sb.projectNewChat}
          aria-label={sb.projectNewChat}
        >
          <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      <div className={cn('ml-6 flex flex-col gap-0.5', isCollapsed && 'hidden')}>
        {visibleSessions.map((session) => {
          const sessionAgentId = resolveSessionAgentId(session, defaultAgentId);
          return (
            <SidebarTaskRow
              key={session.key}
              session={session}
              isActive={activeSessionKey === session.key}
              showSourceChannelIcon={!isWebSession(session)}
              onNavigate={onNavigate}
              mutate={mutate}
              onRequestRename={onRequestRename}
              onRequestDelete={onRequestDelete}
              sb={sb}
              sess={sess}
              clipboard={clipboard}
              defaultUnnamedTitle={defaultUnnamedTitle}
              sessionAgentId={sessionAgentId}
              sessionAgentAvatar={agentAvatarFromOptions(sessionAgentId, agentItems)}
              timeLabel={timeAgoLabel(session.updatedAt, language)}
            />
          );
        })}
        {canToggleSessionLimit ? (
          <button
            type="button"
            className="ml-1 flex w-fit items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
            onClick={() => onToggleExpanded(group.project.id)}
            disabled={group.sessionLoading}
            aria-busy={group.sessionLoading || undefined}
          >
            {group.sessionLoading ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} aria-hidden />
            ) : (
              <ChevronDown
                className={cn(
                  'size-3.5 transition-transform duration-150 ease-out',
                  showLess && 'rotate-180',
                )}
                strokeWidth={1.75}
                aria-hidden
              />
            )}
            {showLess ? sb.projectShowLess : sb.projectShowMore}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function SidebarInboxSection({
  sessions,
  hasMore,
  loadingMore,
  isCollapsed,
  onToggleCollapsed,
  onLoadMore,
  activeSessionKey,
  onNavigate,
  mutate,
  onRequestRename,
  onRequestDelete,
  sb,
  sess,
  clipboard,
  defaultUnnamedTitle,
  defaultAgentId,
  agentItems,
  language,
}: {
  sessions: SessionMetadata[];
  hasMore: boolean;
  loadingMore: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onLoadMore: () => void;
  activeSessionKey?: string;
  onNavigate?: () => void;
  mutate: () => void;
  onRequestRename: (key: string) => void;
  onRequestDelete: (key: string) => void;
  sb: ReturnType<typeof messages>['sidebar'];
  sess: ReturnType<typeof messages>['sessions'];
  clipboard: ReturnType<typeof messages>['clipboard'];
  defaultUnnamedTitle: string;
  defaultAgentId: string;
  agentItems: Awaited<ReturnType<typeof fetchChatAgents>>['items'];
  language: string;
}) {
  if (sessions.length === 0) return null;

  const hasActiveSession = sessions.some((session) => session.key === activeSessionKey);

  return (
    <section className="flex flex-col gap-0.5" aria-label={sb.inboxHeading}>
      <div
        className={cn(
          'group flex min-w-0 items-center gap-2 rounded-xl px-2 text-sm font-medium leading-5',
          hasActiveSession ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted',
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
          onClick={onToggleCollapsed}
          title={sb.inboxHeading}
          aria-expanded={!isCollapsed}
        >
          <MessageSquareText className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 max-w-[9rem] truncate">{sb.inboxHeading}</span>
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-fg-subtle transition-transform duration-150 ease-out',
              isCollapsed && '-rotate-90',
            )}
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
      </div>
      <div className={cn('ml-6 flex flex-col gap-0.5', isCollapsed && 'hidden')}>
        {sessions.map((session) => {
          const sessionAgentId = resolveSessionAgentId(session, defaultAgentId);
          return (
            <SidebarTaskRow
              key={session.key}
              session={session}
              isActive={activeSessionKey === session.key}
              showSourceChannelIcon={!isWebSession(session)}
              onNavigate={onNavigate}
              mutate={mutate}
              onRequestRename={onRequestRename}
              onRequestDelete={onRequestDelete}
              sb={sb}
              sess={sess}
              clipboard={clipboard}
              defaultUnnamedTitle={defaultUnnamedTitle}
              sessionAgentId={sessionAgentId}
              sessionAgentAvatar={agentAvatarFromOptions(sessionAgentId, agentItems)}
              timeLabel={timeAgoLabel(session.updatedAt, language)}
            />
          );
        })}
        {hasMore ? (
          <button
            type="button"
            className="ml-1 flex w-fit items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
            onClick={onLoadMore}
            disabled={loadingMore}
            aria-busy={loadingMore || undefined}
          >
            {loadingMore ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} aria-hidden />
            ) : (
              <ChevronDown className="size-3.5" strokeWidth={1.75} aria-hidden />
            )}
            {sb.projectShowMore}
          </button>
        ) : null}
      </div>
    </section>
  );
}

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
  const activeSessionKey = chatSessionKeyFromPath(pathname);
  const sidebarUpdatedAfter = useMemo(
    () => Date.now() - SIDEBAR_STALE_DAYS * 24 * 60 * 60 * 1000,
    [],
  );

  const [renameKey, setRenameKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const lastActiveSessionKeyRef = useRef<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set());
  const [inboxCollapsed, setInboxCollapsed] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());
  const [projectSessionOverrides, setProjectSessionOverrides] = useState<Record<string, ProjectSessionOverride>>({});
  const [loadingProjectIds, setLoadingProjectIds] = useState<Set<string>>(() => new Set());
  const [inboxExtraItems, setInboxExtraItems] = useState<SessionMetadata[]>([]);
  const [inboxHasMoreOverride, setInboxHasMoreOverride] = useState<boolean | null>(null);
  const [loadingInboxMore, setLoadingInboxMore] = useState(false);

  const { data, size, setSize, isValidating, mutate } = useSWRInfinite<Awaited<ReturnType<typeof fetchSidebarChatList>>>(
    (pageIndex, previousPageData) => {
      if (!token) return null;
      if (previousPageData && !previousPageData.projects.hasMore) return null;
      return ['sidebar-chat-list', token, activeSessionKey ?? '', pageIndex] as const;
    },
    async ([, , includeSessionKey, pageIndex]: readonly [
      'sidebar-chat-list',
      string,
      string,
      number,
    ]) => {
      return fetchSidebarChatList({
        projectLimit: PROJECT_LIMIT,
        projectOffset: pageIndex * PROJECT_LIMIT,
        sessionPreviewLimit: PROJECT_PREVIEW_LIMIT,
        inboxLimit: pageIndex === 0 ? PAGE_SIZE : 1,
        inboxOffset: 0,
        staleDays: SIDEBAR_STALE_DAYS,
        includeSessionKey: includeSessionKey || undefined,
      });
    },
    { revalidateOnFocus: false },
  );

  const projectGroups = useMemo(() => {
    const pages = data ?? [];
    const groups: ProjectSidebarGroup[] = [];
    const seenProjects = new Set<string>();
    for (const p of pages) {
      for (const entry of p.projects.items) {
        if (seenProjects.has(entry.project.id)) continue;
        seenProjects.add(entry.project.id);
        const override = projectSessionOverrides[entry.project.id];
        const sessions = override?.sessions ?? entry.sessions;
        groups.push({
          project: entry.project,
          sessions,
          sessionTotal: override?.sessionTotal ?? entry.sessionTotal,
          sessionHasMore: override?.hasMore ?? entry.sessionHasMore,
          sessionLoading: loadingProjectIds.has(entry.project.id),
          latestAt: Math.max(projectUpdatedAtMs(entry.project), ...sessions.map(sessionUpdatedAtMs)),
        });
      }
    }
    groups.sort((a, b) => b.latestAt - a.latestAt);
    return groups;
  }, [data, loadingProjectIds, projectSessionOverrides]);

  const firstInbox = data?.[0]?.inbox;
  const inboxItems = useMemo(() => {
    const out: SessionMetadata[] = [];
    const seen = new Set<string>();
    for (const session of [...(firstInbox?.items ?? []), ...inboxExtraItems]) {
      if (seen.has(session.key)) continue;
      seen.add(session.key);
      out.push(session);
    }
    out.sort((a, b) => sessionUpdatedAtMs(b) - sessionUpdatedAtMs(a));
    return out;
  }, [firstInbox?.items, inboxExtraItems]);
  const inboxHasMore = inboxHasMoreOverride ?? firstInbox?.hasMore ?? false;

  const items = useMemo(() => {
    const out: SessionMetadata[] = [];
    const seen = new Set<string>();
    for (const group of projectGroups) {
      for (const session of group.sessions) {
        if (seen.has(session.key)) continue;
        seen.add(session.key);
        out.push(session);
      }
    }
    for (const session of inboxItems) {
      if (seen.has(session.key)) continue;
      seen.add(session.key);
      out.push(session);
    }
    return out;
  }, [inboxItems, projectGroups]);

  const hasGroupedItems = projectGroups.length > 0 || inboxItems.length > 0;

  const loadingMore = Boolean(data && size > data.length);
  const lastPage = data?.[data.length - 1];
  const hasMorePages = lastPage?.projects.hasMore ?? false;
  const loadingFirst = Boolean(token && !data && isValidating);

  const refreshSidebar = useCallback(() => {
    setProjectSessionOverrides({});
    setInboxExtraItems([]);
    setInboxHasMoreOverride(null);
    void mutate();
  }, [mutate]);

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
      refreshSidebar();
    };
    const onSessionUpdated = (e: Event) => {
      const d = (e as CustomEvent<{ key?: string; name?: string }>).detail;
      if (!d?.key) {
        refreshSidebar();
        return;
      }
      refreshSidebar();
    };
    window.addEventListener('session-updated', onSessionUpdated);
    window.addEventListener('session-created', onSessionListRefresh);
    return () => {
      window.removeEventListener('session-updated', onSessionUpdated);
      window.removeEventListener('session-created', onSessionListRefresh);
    };
  }, [token, refreshSidebar]);

  // Refetch on session switch (skip initial mount) to refresh metadata (message count, etc).
  useEffect(() => {
    if (!token || !activeSessionKey) return;
    if (lastActiveSessionKeyRef.current === null) {
      lastActiveSessionKeyRef.current = activeSessionKey;
      return;
    }
    if (lastActiveSessionKeyRef.current === activeSessionKey) return;
    lastActiveSessionKeyRef.current = activeSessionKey;
    refreshSidebar();
  }, [token, activeSessionKey, refreshSidebar]);

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
      refreshSidebar();
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
      refreshSidebar();
    } catch {
      /* optional toast */
    }
  };

  const toggleProjectCollapsed = useCallback((projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  const toggleProjectExpanded = useCallback((projectId: string) => {
    const group = projectGroups.find((candidate) => candidate.project.id === projectId);
    if (!group) return;
    const isExpanded = expandedProjects.has(projectId);
    if (isExpanded && !group.sessionHasMore) {
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
      return;
    }
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });
    if (!group.sessionHasMore || loadingProjectIds.has(projectId)) return;

    setLoadingProjectIds((prev) => new Set(prev).add(projectId));
    void (async () => {
      try {
        const result = await listSessions({
          projectId,
          limit: PAGE_SIZE,
          offset: group.sessions.length,
          updatedAfter: sidebarUpdatedAfter,
          includePinned: true,
          includeSessionKey: activeSessionKey,
        });
        setProjectSessionOverrides((prev) => {
          const existing = prev[projectId]?.sessions ?? group.sessions;
          const seen = new Set(existing.map((session) => session.key));
          const appended = [...existing];
          for (const session of result.items) {
            if (seen.has(session.key)) continue;
            seen.add(session.key);
            appended.push(session);
          }
          appended.sort((a, b) => sessionUpdatedAtMs(b) - sessionUpdatedAtMs(a));
          return {
            ...prev,
            [projectId]: {
              sessions: appended,
              sessionTotal: result.total,
              hasMore: result.hasMore,
            },
          };
        });
      } finally {
        setLoadingProjectIds((prev) => {
          const next = new Set(prev);
          next.delete(projectId);
          return next;
        });
      }
    })();
  }, [activeSessionKey, expandedProjects, loadingProjectIds, projectGroups, sidebarUpdatedAfter]);

  const loadMoreInbox = useCallback(() => {
    if (!inboxHasMore || loadingInboxMore) return;
    setLoadingInboxMore(true);
    void (async () => {
      try {
        const result = await listSessions({
          unassigned: true,
          limit: PAGE_SIZE,
          offset: inboxItems.length,
          updatedAfter: sidebarUpdatedAfter,
          includePinned: true,
          includeSessionKey: activeSessionKey,
        });
        setInboxExtraItems((prev) => {
          const seen = new Set([...(firstInbox?.items ?? []), ...prev].map((session) => session.key));
          const next = [...prev];
          for (const session of result.items) {
            if (seen.has(session.key)) continue;
            seen.add(session.key);
            next.push(session);
          }
          return next;
        });
        setInboxHasMoreOverride(result.hasMore);
      } finally {
        setLoadingInboxMore(false);
      }
    })();
  }, [activeSessionKey, firstInbox?.items, inboxHasMore, inboxItems.length, loadingInboxMore, sidebarUpdatedAfter]);

  const createProjectChat = useCallback(async (project: Project) => {
    try {
      const session = await createProjectSession(project.id, project.defaultAgentId ?? defaultAgentId);
      refreshSidebar();
      navigate(`/chat/${encodeURIComponent(session.key)}`);
      onNavigate?.();
    } catch {
      /* optional toast */
    }
  }, [defaultAgentId, navigate, onNavigate, refreshSidebar]);

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
        {loadingFirst ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-fg-subtle" strokeWidth={1.75} aria-hidden />
          </div>
        ) : hasGroupedItems ? (
          <div className="flex flex-col px-4 pt-2">
            {projectGroups.length > 0 ? (
              <div className="pb-1">
                <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                  {sb.projectsHeading}
                </div>
                {projectGroups.map((group) => (
                  <SidebarProjectSection
                    key={group.project.id}
                    group={group}
                    isExpanded={expandedProjects.has(group.project.id)}
                    isCollapsed={collapsedProjects.has(group.project.id)}
                    activeSessionKey={activeSessionKey}
                    onToggleCollapsed={toggleProjectCollapsed}
                    onToggleExpanded={toggleProjectExpanded}
                    onCreateProjectChat={(project) => void createProjectChat(project)}
                    onNavigate={onNavigate}
                    mutate={refreshSidebar}
                    onRequestRename={openRename}
                    onRequestDelete={setDeleteKey}
                    sb={sb}
                    sess={sess}
                    clipboard={m.clipboard}
                    defaultUnnamedTitle={m.chat.newSession}
                    defaultAgentId={defaultAgentId}
                    agentItems={agentItems}
                    language={language}
                  />
                ))}
              </div>
            ) : null}

            <SidebarInboxSection
              sessions={inboxItems}
              hasMore={inboxHasMore}
              loadingMore={loadingInboxMore}
              isCollapsed={inboxCollapsed}
              onToggleCollapsed={() => setInboxCollapsed((value) => !value)}
              onLoadMore={loadMoreInbox}
              activeSessionKey={activeSessionKey}
              onNavigate={onNavigate}
              mutate={refreshSidebar}
              onRequestRename={openRename}
              onRequestDelete={setDeleteKey}
              sb={sb}
              sess={sess}
              clipboard={m.clipboard}
              defaultUnnamedTitle={m.chat.newSession}
              defaultAgentId={defaultAgentId}
              agentItems={agentItems}
              language={language}
            />
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
