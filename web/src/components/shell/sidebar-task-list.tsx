import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { isAutomationConfigurationSession, resolveSessionIdentity } from '@xopcai/gateway-contract';
import {
  Archive,
  ChevronDown,
  ClipboardCopy,
  Clock3,
  ExternalLink,
  Folder,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type UIEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import useSWRInfinite from 'swr/infinite';

import { AutomationRunList } from '@/features/automations/automation-run-list';
import { automationApi } from '@/features/automations/automation-api';

import { allProjectOptions } from '@/features/sessions/session-filter-projects';
import { sessionIdentityLabel } from '@/features/sessions/session-identity-label';
import { SessionRenameDialog } from '@/features/sessions/session-rename-dialog';

import { ExternalRuntimeAvatar, parseExternalRuntimeAvatar } from '@/components/brand/external-runtime-avatar';
import {
  ExternalRuntimeCornerBadge,
  externalRuntimeLabel,
} from '@/components/brand/external-runtime-badge';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import { SidebarExpertList } from '@/components/shell/sidebar-expert-list';
import { SidebarCreateSectionHeader, sidebarSectionLabelClass } from '@/components/shell/sidebar-create-section-header';
import { SessionChannelIcon } from '@/components/shell/session-channel-icon';
import { ProjectUnderstandingAction, ProjectUnderstandingCheckbox } from '@/features/projects/project-understanding';
import { shouldRefreshSidebarForTranscriptUpdate } from '@/components/shell/sidebar-session-refresh';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SlidingSegmented } from '@/components/ui/sliding-segmented';
import { fetchChatAgents, type ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import { resolveSessionAgentId } from '@/features/sessions/session-agent-resolve';
import { navigateToNewChat } from '@/features/chat/session/new-chat-navigation';
import { newChatHrefForProject } from '@/features/chat/session/composer-handoff-params';
import { useSidebarSessionAgentRun } from '@/features/chat/session/use-sidebar-session-agent-run';
import { taskDetailHref } from '@/features/tasks/task-detail-route';
import { formatTaskRawStatus } from '@/features/tasks/task-status';
import { useChatRunPresenceStore } from '@/features/chat/session/chat-run-presence-store';
import { useDirectoryPicker } from '@/features/fs/use-directory-picker';
import { WorkingDirectoryPickerModal } from '@/features/fs/working-directory-picker-modal';
import {
  archiveProject,
  createProject,
  deleteProject,
  pinProject,
  renameProject,
  unpinProject,
  type Project,
} from '@/features/projects/api';
import {
  deleteSession,
  fetchSidebarChatList,
  listSessions,
  pinSession,
  saveSidebarLayout,
  unpinSession,
} from '@/features/sessions/session-api';
import type { SessionMetadata } from '@/features/sessions/session.types';
import type { SidebarTaskGroup } from '@xopcai/gateway-contract';
import { messages } from '@/i18n/messages';
import { formControlBorderFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const TaskGroupsContext = createContext<Record<string, SidebarTaskGroup>>({});
const SidebarAgentsContext = createContext<{
  defaultAgentId: string;
  byId: ReadonlyMap<string, ChatAgentOption>;
}>({
  defaultAgentId: 'main',
  byId: new Map(),
});

const SidebarTaskChildRow = memo(function SidebarTaskChildRow({
  child,
  activeTaskId,
  onNavigate,
  sb,
}: {
  child: SidebarTaskGroup['items'][number];
  activeTaskId?: string;
  onNavigate?: () => void;
  sb: ReturnType<typeof messages>['sidebar'];
}) {
  const location = useLocation();
  const language = useLocaleStore((state) => state.language);
  const runPresence = useChatRunPresenceStore((state) => (
    child.activeConversationId ? state.runs[child.activeConversationId] : undefined
  ));
  return <Link
    to={child.activeConversationId ? `/chat/task/${encodeURIComponent(child.taskId)}` : taskDetailHref(`${location.pathname}${location.search}`, child.taskId)}
    className={cn(
      'ml-8 flex min-h-8 items-center gap-2 rounded-lg px-2 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg',
      activeTaskId === child.taskId && 'bg-surface-active text-fg')}
    onClick={() => onNavigate?.()}>
    {runPresence?.unread ? <span className="size-1.5 shrink-0 rounded-full bg-accent"
      aria-label={runPresence.status === 'failed' ? sb.taskSessionAgentFailed : sb.taskSessionAgentCompleted} /> : null}
    <span className="min-w-0 flex-1 truncate">{child.title}</span>
    <span className="shrink-0 text-xs text-fg-subtle">{formatTaskRawStatus(child.runStatus ?? child.phase, language)}</span>
  </Link>;
});

function isSidebarConversation(session: SessionMetadata): boolean {
  return resolveSessionIdentity(session).source !== 'automation';
}

const PAGE_SIZE = 20;
const OLDER_SESSION_PREVIEW_LIMIT = 4;
const PROJECT_LIMIT = 12;
const PROJECT_PREVIEW_LIMIT = 5;
const SIDEBAR_STALE_DAYS = 60;
const SIDEBAR_LOAD_MORE_THRESHOLD_PX = 100;
const SIDEBAR_DRAG_MIME = 'application/x-xopc-sidebar-item';

const SESSION_VIEWS = ['recent', 'projects', 'experts'] as const;
type SessionView = (typeof SESSION_VIEWS)[number];
type PaginatedSessionView = Exclude<SessionView, 'experts'>;

const SESSION_VIEW_STORAGE_KEY = 'xopc-web-sidebar-session-view';
const SESSION_VIEW_ORDER_STORAGE_KEY = 'xopc-web-sidebar-session-view-order';

function readSessionViewOrder(): SessionView[] {
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(SESSION_VIEW_ORDER_STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved)) {
      const known = [...new Set(saved)].filter((value): value is SessionView => SESSION_VIEWS.some(view => view === value));
      return [...known, ...SESSION_VIEWS.filter(view => !known.includes(view))];
    }
  } catch {
    // An invalid or unavailable preference falls back to the default order.
  }
  return [...SESSION_VIEWS];
}

function readSessionView(): SessionView {
  try {
    const saved = globalThis.localStorage?.getItem(SESSION_VIEW_STORAGE_KEY);
    return saved === 'projects' || saved === 'experts' ? saved : 'recent';
  } catch {
    return 'recent';
  }
}
type RecentPeriod = 'today' | 'yesterday' | 'older';

type SidebarSortSpec = {
  containerId: string;
  itemId: string;
  itemIds: string[];
  onReorder: (containerId: string, itemIds: string[]) => void;
};

function moveSidebarItem(itemIds: string[], itemId: string, targetId: string, after: boolean): string[] {
  const next = itemIds.filter((id) => id !== itemId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0) return itemIds;
  next.splice(targetIndex + (after ? 1 : 0), 0, itemId);
  return next;
}

function orderSidebarItems<T>(items: T[], order: string[] | undefined, idOf: (item: T) => string): T[] {
  if (!order?.length) return items;
  const ranks = new Map(order.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index, rank: ranks.get(idOf(item)) }))
    .sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
      if (a.rank !== undefined) return 1;
      if (b.rank !== undefined) return -1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

function SidebarSortableItem({ spec, children }: { spec?: SidebarSortSpec; children: ReactNode }) {
  const [dragging, setDragging] = useState(false);
  const [dropEdge, setDropEdge] = useState<'before' | 'after' | null>(null);
  if (!spec) return children;

  return (
    <div
      draggable
      className={cn(
        'relative cursor-grab transition-[opacity,transform] duration-200 ease-out active:cursor-grabbing',
        dragging && 'opacity-50',
      )}
      onDragStart={(event) => {
        setDragging(true);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(SIDEBAR_DRAG_MIME, JSON.stringify({ containerId: spec.containerId, itemId: spec.itemId }));
      }}
      onDragEnd={() => {
        setDragging(false);
        setDropEdge(null);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        setDropEdge(event.clientY >= rect.top + rect.height / 2 ? 'after' : 'before');
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropEdge(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const after = event.clientY >= rect.top + rect.height / 2;
        setDropEdge(null);
        try {
          const source = JSON.parse(event.dataTransfer.getData(SIDEBAR_DRAG_MIME)) as { containerId: string; itemId: string };
          if (source.containerId !== spec.containerId || source.itemId === spec.itemId) return;
          spec.onReorder(
            spec.containerId,
            moveSidebarItem(spec.itemIds, source.itemId, spec.itemId, after),
          );
        } catch {
          // Ignore drags from outside the sidebar.
        }
      }}
    >
      {dropEdge === 'before' ? <span className="pointer-events-none absolute inset-x-1 top-0 z-30 h-0.5 rounded-full bg-accent" /> : null}
      {children}
      {dropEdge === 'after' ? <span className="pointer-events-none absolute inset-x-1 bottom-0 z-30 h-0.5 rounded-full bg-accent" /> : null}
    </div>
  );
}

type ProjectSidebarGroup = {
  project: Project;
  sessions: SessionMetadata[];
  sessionHasMore: boolean;
  sessionLoading?: boolean;
};

type SidebarSessionPage = Awaited<ReturnType<typeof listSessions>>;

function sessionTitle(s: SessionMetadata, unnamedLabel: string): string {
  return s.name?.trim() || unnamedLabel;
}

/** Active chat session key from `/chat/:key` (excludes `/chat/new`). */
function chatConversationIdFromPath(pathname: string): string | undefined {
  const m = /^\/chat\/([^/]+)$/.exec(pathname);
  if (!m) return undefined;
  const seg = decodeURIComponent(m[1]);
  if (seg === 'new') return undefined;
  return seg;
}

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

function sessionUpdatedAtMs(session: SessionMetadata): number {
  const timestamp = new Date(session.updatedAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function groupRecentSessions(sessions: SessionMetadata[]): Record<RecentPeriod, SessionMetadata[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups: Record<RecentPeriod, SessionMetadata[]> = { today: [], yesterday: [], older: [] };
  for (const session of sessions) {
    const updatedAt = sessionUpdatedAtMs(session);
    const period = updatedAt >= today.getTime() ? 'today' : updatedAt >= yesterday.getTime() ? 'yesterday' : 'older';
    groups[period].push(session);
  }
  return groups;
}

function rowShellClass(isActive: boolean): string {
  return cn(
    'sidebar-hover-row group relative flex min-h-[2.125rem] w-full min-w-0 items-center rounded-lg pr-1 text-left text-[0.9375rem] leading-[1.375rem] transition-colors duration-200 ease-out',
    'pl-6',
    'focus-within:outline-none',
    isActive
      ? 'bg-accent-soft font-medium text-fg before:pointer-events-none before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent'
      : 'font-normal text-fg-muted hover:bg-surface-hover hover:text-fg',
  );
}

const sidebarSectionButtonClass = cn(
  sidebarSectionLabelClass,
  'transition-colors hover:text-fg-muted',
);

function SidebarSessionSkeletonRow({ indented = false }: { indented?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 p-1.5', indented && 'pl-6')}>
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3 w-4/5 animate-none" />
        <Skeleton className="mt-1.5 h-2.5 w-2/5 animate-none" />
      </div>
    </div>
  );
}

/** Mirrors the sidebar's section hierarchy so first load has a stable footprint. */
function SidebarTaskListSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-2 py-4" aria-busy="true">
      <div>
        <Skeleton className="mb-1.5 h-2.5 w-14 animate-none" />
        <SidebarSessionSkeletonRow />
      </div>
      <div>
        <Skeleton className="mb-1.5 h-2.5 w-16 animate-none" />
        <div className="flex flex-col gap-0.5">
          <SidebarSessionSkeletonRow />
          <SidebarSessionSkeletonRow indented />
          <SidebarSessionSkeletonRow indented />
        </div>
      </div>
      <div>
        <Skeleton className="mb-1.5 h-2.5 w-12 animate-none" />
        <SidebarSessionSkeletonRow />
        <SidebarSessionSkeletonRow />
      </div>
    </div>
  );
}

const SidebarTaskRow = memo(function SidebarTaskRow({
  session,
  isActive,
  onNavigate,
  onRequestRename,
  onRequestDelete,
  sb,
  sess,
  clipboard,
  defaultUnnamedTitle,
  contextLabel,
  sort,
}: {
  session: SessionMetadata;
  isActive: boolean;
  contextLabel?: string;
  onNavigate?: () => void;
  onRequestRename: (session: SessionMetadata) => void;
  onRequestDelete: (key: string) => void;
  sb: ReturnType<typeof messages>['sidebar'];
  sess: ReturnType<typeof messages>['sessions'];
  clipboard: ReturnType<typeof messages>['clipboard'];
  defaultUnnamedTitle: string;
  sort?: SidebarSortSpec;
}) {
  const taskGroup = useContext(TaskGroupsContext)[session.key];
  const sidebarAgents = useContext(SidebarAgentsContext);
  const location = useLocation();
  const language = useLocaleStore((state) => state.language);
  const setup = isAutomationConfigurationSession(session)
    ? session.customData?.automationSetup as { automationId?: unknown } : undefined;
  const automationId = typeof setup?.automationId === 'string' && setup.automationId.trim()
    ? setup.automationId : undefined;
  const searchParams = new URLSearchParams(location.search);
  const selectedRunId = location.pathname === '/automations' && searchParams.get('automation') === automationId
    ? searchParams.get('run') ?? undefined : undefined;
  const { data: automationHistory } = useSWR(
    automationId ? ['sidebar-automation-history', automationId, session.projectId ?? ''] : null,
    () => automationApi.runs(1, automationId, { projectId: session.projectId }),
    { refreshInterval: 15000, revalidateOnFocus: true },
  );
  const hasExpandableContent = Boolean(taskGroup?.items.length || automationHistory?.runs.length || selectedRunId);
  const activeTaskId = /^\/chat\/task\/([^/]+)$/.exec(location.pathname)?.[1];
  const activeChild = Boolean(selectedRunId) || (taskGroup?.items.some((child) => child.taskId === activeTaskId
    || child.activeConversationId === chatConversationIdFromPath(location.pathname)) ?? false);
  const [tasksExpanded, setTasksExpanded] = useState(activeChild);
  useEffect(() => { if (activeChild) setTasksExpanded(true); }, [activeChild]);
  const identity = resolveSessionIdentity(session);
  const showChannelIcon = isAutomationConfigurationSession(session) || identity.source !== 'workbench' || identity.purpose !== 'chat';
  const sessionAgentId = resolveSessionAgentId(session, sidebarAgents.defaultAgentId);
  const sessionAgent = sidebarAgents.byId.get(sessionAgentId);
  const externalRuntime = sessionAgent?.execution;
  const runtimeLabel = externalRuntime ? externalRuntimeLabel(externalRuntime, 'full') : undefined;
  const agentName = sessionAgent?.name?.trim();
  const runtimeSummary = runtimeLabel
    ? (agentName && agentName.toLowerCase() !== runtimeLabel.toLowerCase()
        ? `${agentName} (${runtimeLabel})`
        : runtimeLabel)
    : undefined;
  const identityLabel = sessionIdentityLabel(session, sb.sessionFilters);
  const iconTooltip = showChannelIcon && runtimeSummary
    ? `${identityLabel} · ${runtimeSummary}`
    : !showChannelIcon && runtimeSummary
      ? runtimeSummary
      : identityLabel;
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const agentRunActive = useSidebarSessionAgentRun(session.key);
  const runPresence = useChatRunPresenceStore((state) => state.runs[session.key]);
  const title = sessionTitle(session, defaultUnnamedTitle);
  const rowTooltip = [title, showChannelIcon ? identityLabel : undefined, runtimeSummary, contextLabel]
    .filter(Boolean)
    .join(' — ');
  const isPinned = session.status === 'pinned';
  const hasRunPresence = agentRunActive || Boolean(runPresence?.unread);

  const handlePinToggle = async () => {
    if (pinBusy) return;
    setPinBusy(true);
    try {
      if (isPinned) {
        await unpinSession(session.key);
      } else {
        await pinSession(session.key);
      }
      setMenuOpen(false);
    } catch {
      // Preserve the current sidebar state when the action fails.
    } finally {
      setPinBusy(false);
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
    <SidebarSortableItem spec={sort}>
    <div>
    <div
      data-actions-visible={menuOpen || pinBusy ? 'true' : undefined}
      className={rowShellClass(isActive)}
    >
      {hasExpandableContent ? (
        <button type="button" className="absolute left-0 flex size-6 items-center justify-center text-fg-subtle hover:text-fg"
          aria-label={automationId
            ? tasksExpanded ? sb.automationRunsCollapse : sb.automationRunsExpand
            : tasksExpanded ? sb.delegatedTasksCollapse : sb.delegatedTasksExpand}
          aria-expanded={tasksExpanded}
          onClick={() => setTasksExpanded((value) => !value)}>
          <ChevronDown className={cn('size-3.5 transition-transform', !tasksExpanded && '-rotate-90')} aria-hidden />
        </button>
      ) : null}
      <Link
        to={`/chat/${encodeURIComponent(session.key)}`}
        className={cn(
          'min-w-0 flex-1 self-stretch rounded-lg py-1 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
          'flex min-w-0 items-center gap-2',
          hasRunPresence ? 'pr-7' : 'pr-2',
        )}
        title={rowTooltip}
        aria-label={rowTooltip}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => onNavigate?.()}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRequestRename(session);
        }}
      >
        {showChannelIcon && externalRuntime ? (
          <span
            className="relative flex size-4 shrink-0 items-center justify-center text-fg-muted"
            title={iconTooltip}
            data-session-runtime={externalRuntime}
          >
            <SessionChannelIcon sourceChannel={session.sourceChannel} session={session} className="size-3.5" />
            <ExternalRuntimeCornerBadge kind={externalRuntime} size={9} ringClassName="ring-surface-rail" />
          </span>
        ) : showChannelIcon ? (
          <span className="flex size-4 shrink-0 items-center justify-center text-fg-muted" title={iconTooltip}>
            <SessionChannelIcon sourceChannel={session.sourceChannel} session={session} className="size-3.5" />
          </span>
        ) : externalRuntime ? (
          <span
            className="flex size-4 shrink-0 items-center justify-center"
            title={iconTooltip}
            data-session-runtime={externalRuntime}
          >
            {sessionAgent?.avatar && !parseExternalRuntimeAvatar(sessionAgent.avatar) ? (
              <AgentAvatarDisplay
                agentId={sessionAgentId}
                avatar={sessionAgent.avatar}
                runtimeBadge={externalRuntime}
                size={16}
                className="size-4 shrink-0"
              />
            ) : (
              <ExternalRuntimeAvatar kind={externalRuntime} size={14} />
            )}
          </span>
        ) : null}
        <span className="sidebar-hover-fade min-w-0 flex-1 truncate">{title}</span>
      </Link>
      {agentRunActive ? (
        <span
          className="pointer-events-none absolute right-2 top-1/2 z-10 flex size-2.5 -translate-y-1/2 items-center justify-center"
          title={sb.taskSessionAgentRunning}
          aria-label={sb.taskSessionAgentRunning}
        >
          <span className="absolute size-full animate-ping rounded-full bg-accent/70" aria-hidden />
          <span className="relative size-2 rounded-full bg-accent" aria-hidden />
        </span>
      ) : runPresence?.unread ? (
        <span
          className={cn(
            'pointer-events-none absolute right-2 top-1/2 z-10 size-2.5 -translate-y-1/2 rounded-full',
            runPresence.status === 'failed' ? 'bg-red-500' : 'bg-emerald-500',
          )}
          title={
            runPresence.status === 'failed'
              ? sb.taskSessionAgentFailed
              : sb.taskSessionAgentCompleted
          }
          aria-label={
            runPresence.status === 'failed'
              ? sb.taskSessionAgentFailed
              : sb.taskSessionAgentCompleted
          }
        />
      ) : null}
      <div
        className={cn(
          'pointer-events-none absolute inset-y-0 z-10 flex items-center gap-0.5 opacity-0 transition-opacity duration-150',
          'group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
          '[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
          hasRunPresence ? 'right-7' : 'right-1.5',
          (menuOpen || pinBusy) && 'pointer-events-auto opacity-100',
        )}
      >
        <button
          type="button"
          className={cn(
            'flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors',
            'hover:bg-surface-active/70 hover:text-fg',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface-base',
            'disabled:cursor-wait',
          )}
          aria-label={isPinned ? sess.unpin : sess.pin}
          title={isPinned ? sess.unpin : sess.pin}
          aria-pressed={isPinned}
          disabled={pinBusy}
          onClick={() => void handlePinToggle()}
        >
          {pinBusy ? (
            <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} aria-hidden />
          ) : (
            <Pin
              className="size-3.5 rotate-45"
              fill={isPinned ? 'currentColor' : 'none'}
              strokeWidth={1.75}
              aria-hidden
            />
          )}
        </button>
        <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={cn(
                'flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors',
                'hover:bg-surface-active/70 hover:text-fg',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface-base',
              )}
              aria-label={sb.taskSessionMenuAria}
              title={sb.taskSessionMenuAria}
              aria-expanded={menuOpen}
            >
              <MoreHorizontal className="size-3.5" strokeWidth={2} aria-hidden />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="z-50 w-[9.25rem] rounded-lg border border-edge bg-surface-overlay p-1 shadow-elevated dark:border-edge"
              side="bottom"
              align="end"
              sideOffset={4}
              collisionPadding={12}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
                onClick={() => {
                  setMenuOpen(false);
                  onRequestRename(session);
                }}
              >
                <Pencil className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                {sb.taskRename}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
                onClick={() => void copyChatId()}
              >
                <ClipboardCopy className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                {sb.taskCopyChatId}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium leading-snug text-red-600 transition-colors hover:bg-surface-hover dark:text-red-400"
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
    </div>
    {tasksExpanded && taskGroup?.items.map((child) => (
      <SidebarTaskChildRow key={child.taskId} child={child} activeTaskId={activeTaskId} onNavigate={onNavigate} sb={sb} />
    ))}
    {tasksExpanded && automationId ? (
      <AutomationRunList
        automationId={automationId}
        projectId={session.projectId}
        language={language}
        selectedRunId={selectedRunId}
        runHref={(run) => {
          const params = new URLSearchParams({ automation: automationId, view: 'execution', run: run.id });
          if (session.projectId) params.set('projectId', session.projectId);
          return `/automations?${params}`;
        }}
        onSelectRun={() => onNavigate?.()}
      />
    ) : null}
    </div>
    </SidebarSortableItem>
  );
});

function SidebarProjectMenu({
  project,
  onNavigate,
  onPinToggle,
  onRequestRename,
  onArchive,
  onRequestRemove,
  sb,
}: {
  project: Project;
  onNavigate?: () => void;
  onPinToggle: (project: Project) => void;
  onRequestRename: (project: Project) => void;
  onArchive: (project: Project) => void;
  onRequestRemove: (project: Project) => void;
  sb: ReturnType<typeof messages>['sidebar'];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const workspaceRoot = project.effectiveWorkspaceRoot?.trim() || project.workspaceRoot?.trim() || '';
  const canOpenWorkspace = Boolean(workspaceRoot && window.electronAPI?.shell?.openPath);
  const isPinned = Boolean(project.pinnedAt);

  const openWorkspace = async () => {
    if (!workspaceRoot || !window.electronAPI?.shell?.openPath) {
      showComposerNotification('warning', sb.projectOpenInExplorerUnavailable, undefined, { duration: 3500 });
      setMenuOpen(false);
      return;
    }
    const result = await window.electronAPI.shell.openPath(workspaceRoot);
    setMenuOpen(false);
    if (result.ok === false) {
      showComposerNotification('warning', result.error || sb.projectOpenInExplorerFailed, undefined, {
        duration: 4000,
      });
    }
  };

  return (
    <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'relative z-10 flex size-7 shrink-0 items-center justify-center rounded-lg text-fg-subtle transition-opacity',
            'opacity-0 group-hover:opacity-100 focus:opacity-100',
            menuOpen && 'opacity-100',
            'hover:bg-surface-hover hover:text-fg-muted',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
          )}
          aria-label={sb.projectMenuAria}
          title={sb.projectMenuAria}
          aria-expanded={menuOpen}
        >
          <MoreHorizontal className="size-3.5" strokeWidth={2} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-[12rem] rounded-lg border border-edge bg-surface-overlay p-1 shadow-elevated dark:border-edge"
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={12}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <Link
            to={`/projects/${encodeURIComponent(project.id)}`}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
            onClick={() => {
              setMenuOpen(false);
              onNavigate?.();
            }}
          >
            <ExternalLink className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {sb.projectOpen}
          </Link>
          <ProjectUnderstandingAction hasProjectFolder={Boolean(project.workspaceRoot?.trim())} projectId={project.id} onStarted={() => setMenuOpen(false)}
            className="flex w-full rounded-md px-2 py-1.5 text-left text-sm font-medium text-fg hover:bg-surface-hover disabled:opacity-50" />
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
            onClick={() => {
              setMenuOpen(false);
              onPinToggle(project);
            }}
          >
            {isPinned ? (
              <PinOff className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            ) : (
              <Pin className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            )}
            {isPinned ? sb.projectUnpin : sb.projectPin}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium leading-snug text-fg transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-fg-subtle disabled:hover:bg-transparent"
            onClick={() => void openWorkspace()}
            disabled={!canOpenWorkspace}
            title={!canOpenWorkspace ? sb.projectOpenInExplorerUnavailable : undefined}
          >
            <FolderOpen className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {sb.projectOpenInExplorer}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
            onClick={() => {
              setMenuOpen(false);
              onRequestRename(project);
            }}
          >
            <Pencil className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {sb.projectRename}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
            onClick={() => {
              setMenuOpen(false);
              onArchive(project);
            }}
          >
            <Archive className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {sb.projectArchive}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium leading-snug text-red-600 transition-colors hover:bg-surface-hover dark:text-red-400"
            onClick={() => {
              setMenuOpen(false);
              onRequestRemove(project);
            }}
          >
            <Trash2 className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {sb.projectRemove}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SidebarProjectSection({
  group,
  isExpanded,
  isCollapsed,
  activeConversationId,
  onToggleExpanded,
  onToggleCollapsed,
  onCreateProjectChat,
  onToggleProjectPin,
  onRequestProjectRename,
  onArchiveProject,
  onRequestProjectRemove,
  onNavigate,
  onRequestRename,
  onRequestDelete,
  sb,
  sess,
  clipboard,
  defaultUnnamedTitle,
  excludedConversationIds,
  projectSort,
  onReorder,
}: {
  group: ProjectSidebarGroup;
  isExpanded: boolean;
  isCollapsed: boolean;
  activeConversationId?: string;
  onToggleExpanded: (projectId: string) => void;
  onToggleCollapsed: (projectId: string) => void;
  onCreateProjectChat: (project: Project) => void;
  onToggleProjectPin: (project: Project) => void;
  onRequestProjectRename: (project: Project) => void;
  onArchiveProject: (project: Project) => void;
  onRequestProjectRemove: (project: Project) => void;
  onNavigate?: () => void;
  onRequestRename: (session: SessionMetadata) => void;
  onRequestDelete: (key: string) => void;
  sb: ReturnType<typeof messages>['sidebar'];
  sess: ReturnType<typeof messages>['sessions'];
  clipboard: ReturnType<typeof messages>['clipboard'];
  defaultUnnamedTitle: string;
  /** Sessions rendered in the dedicated pinned section stay out of their project list. */
  excludedConversationIds?: ReadonlySet<string>;
  projectSort?: SidebarSortSpec;
  onReorder: (containerId: string, itemIds: string[]) => void;
}) {
  const unpinnedSessions = excludedConversationIds
    ? group.sessions.filter((session) => !excludedConversationIds.has(session.key))
    : group.sessions;
  const visibleSessions = isExpanded ? unpinnedSessions : unpinnedSessions.slice(0, PROJECT_PREVIEW_LIMIT);
  const hasLoadedMore = unpinnedSessions.length > PROJECT_PREVIEW_LIMIT;
  const canToggleSessionLimit = group.sessionHasMore || hasLoadedMore;
  const showLess = isExpanded && !group.sessionHasMore && hasLoadedMore;
  const hasActiveSession = unpinnedSessions.some((session) => session.key === activeConversationId);

  return (
    <SidebarSortableItem spec={projectSort}>
    <section className="flex flex-col gap-0.5" aria-label={group.project.name}>
      <div
        className={cn(
          'group flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 text-[0.9375rem] font-medium leading-[1.375rem]',
          hasActiveSession ? 'text-fg' : 'text-fg-muted',
        )}
      >
        <button
          type="button"
          className="flex h-8 min-w-0 flex-1 items-center gap-1 text-left hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
          onClick={() => onToggleCollapsed(group.project.id)}
          title={group.project.name}
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? (
            <Folder className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden />
          ) : (
            <FolderOpen className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">{group.project.name}</span>
        </button>
        <SidebarProjectMenu
          project={group.project}
          onNavigate={onNavigate}
          onPinToggle={onToggleProjectPin}
          onRequestRename={onRequestProjectRename}
          onArchive={onArchiveProject}
          onRequestRemove={onRequestProjectRemove}
          sb={sb}
        />
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

      {!isCollapsed ? (
        <div className="flex flex-col gap-0.5">
          {visibleSessions.map((session) => (
            <SidebarTaskRow
              key={session.key}
              session={session}
              isActive={activeConversationId === session.key}
              onNavigate={onNavigate}
              onRequestRename={onRequestRename}
              onRequestDelete={onRequestDelete}
              sb={sb}
              sess={sess}
              clipboard={clipboard}
              defaultUnnamedTitle={defaultUnnamedTitle}
              sort={{
                containerId: `project:${group.project.id}`,
                itemId: session.key,
                itemIds: unpinnedSessions.map((item) => item.key),
                onReorder,
              }}
            />
          ))}
          {canToggleSessionLimit ? (
            <button
              type="button"
              className="ml-4 flex w-fit items-center gap-1 rounded-lg px-2 py-1 text-[0.8125rem] font-medium text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
              onClick={() => onToggleExpanded(group.project.id)}
              data-sidebar-load-more={group.sessionHasMore ? '' : undefined}
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
      ) : null}
    </section>
    </SidebarSortableItem>
  );
}

function SidebarInboxSection({
  sessions,
  hasMore,
  loadingMore,
  isCollapsed,
  onToggleCollapsed,
  onCreateChat,
  onLoadMore,
  activeConversationId,
  onNavigate,
  onRequestRename,
  onRequestDelete,
  sb,
  sess,
  clipboard,
  defaultUnnamedTitle,
  excludedConversationIds,
  onReorder,
  sortable = true,
}: {
  sessions: SessionMetadata[];
  hasMore: boolean;
  loadingMore: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onCreateChat: () => void;
  onLoadMore: () => void;
  activeConversationId?: string;
  onNavigate?: () => void;
  onRequestRename: (session: SessionMetadata) => void;
  onRequestDelete: (key: string) => void;
  sb: ReturnType<typeof messages>['sidebar'];
  sess: ReturnType<typeof messages>['sessions'];
  clipboard: ReturnType<typeof messages>['clipboard'];
  defaultUnnamedTitle: string;
  /** Sessions rendered in the dedicated pinned section stay out of the inbox. */
  excludedConversationIds?: ReadonlySet<string>;
  onReorder: (containerId: string, itemIds: string[]) => void;
  sortable?: boolean;
}) {
  const unpinnedSessions = excludedConversationIds
    ? sessions.filter((session) => !excludedConversationIds.has(session.key))
    : sessions;
  if (unpinnedSessions.length === 0 && !hasMore) return null;

  return (
    <section className="flex flex-col gap-0.5" aria-label={sb.inboxHeading}>
      <div className="group flex min-w-0 items-center pb-1">
        <button
          type="button"
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1 px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
            sidebarSectionButtonClass,
          )}
          onClick={onToggleCollapsed}
          aria-expanded={!isCollapsed}
        >
          {sb.inboxHeading}
          <ChevronDown
            className={cn(
              'size-3.5 transition-transform duration-150 ease-out',
              isCollapsed && '-rotate-90',
            )}
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
        <button
          type="button"
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-lg text-fg-subtle transition-opacity hover:bg-surface-hover hover:text-fg-muted',
            'opacity-0 group-hover:opacity-100 focus:opacity-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
          )}
          onClick={onCreateChat}
          title={defaultUnnamedTitle}
          aria-label={defaultUnnamedTitle}
        >
          <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <div className={cn('flex flex-col gap-0.5', isCollapsed && 'hidden')}>
        {unpinnedSessions.map((session) => (
          <SidebarTaskRow
            key={session.key}
            session={session}
            isActive={activeConversationId === session.key}
            onNavigate={onNavigate}
            onRequestRename={onRequestRename}
            onRequestDelete={onRequestDelete}
            sb={sb}
            sess={sess}
            clipboard={clipboard}
            defaultUnnamedTitle={defaultUnnamedTitle}
            sort={sortable ? {
              containerId: 'inbox',
              itemId: session.key,
              itemIds: unpinnedSessions.map((item) => item.key),
              onReorder,
            } : undefined}
          />
        ))}
        {hasMore ? (
          <button
            type="button"
            className="ml-4 flex w-fit items-center gap-1 rounded-lg px-2 py-1 text-[0.8125rem] font-medium text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
            onClick={onLoadMore}
            data-sidebar-load-more=""
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

function SidebarPinnedSection({
  sessions,
  activeConversationId,
  onNavigate,
  onRequestRename,
  onRequestDelete,
  sb,
  sess,
  clipboard,
  defaultUnnamedTitle,
  onReorder,
  projectNames,
}: {
  sessions: SessionMetadata[];
  activeConversationId?: string;
  onNavigate?: () => void;
  onRequestRename: (session: SessionMetadata) => void;
  onRequestDelete: (key: string) => void;
  sb: ReturnType<typeof messages>['sidebar'];
  sess: ReturnType<typeof messages>['sessions'];
  clipboard: ReturnType<typeof messages>['clipboard'];
  defaultUnnamedTitle: string;
  onReorder: (containerId: string, itemIds: string[]) => void;
  projectNames?: ReadonlyMap<string, string>;
}) {
  if (sessions.length === 0) return null;

  return (
    <section className="mb-3 flex flex-col gap-0.5" aria-label={sess.pinnedSessions}>
      <h2 className={cn('px-2 pb-1', sidebarSectionLabelClass)}>
        {sess.pinnedSessions}
      </h2>
      <div className="flex flex-col gap-0.5">
        {sessions.map((session) => (
          <SidebarTaskRow
            key={session.key}
            session={session}
            contextLabel={session.projectId ? projectNames?.get(session.projectId) : undefined}
            isActive={activeConversationId === session.key}
            onNavigate={onNavigate}
            onRequestRename={onRequestRename}
            onRequestDelete={onRequestDelete}
            sb={sb}
            sess={sess}
            clipboard={clipboard}
            defaultUnnamedTitle={defaultUnnamedTitle}
            sort={{
              containerId: 'pinned',
              itemId: session.key,
              itemIds: sessions.map((item) => item.key),
              onReorder,
            }}
          />
        ))}
      </div>
    </section>
  );
}

export function SidebarTaskList({
  onNavigate,
  scrollHeader,
}: {
  onNavigate?: () => void;
  scrollHeader?: ReactNode;
}) {
  const gateway = useGatewayStore((state) => state.baseUrl);
  return <SidebarTaskListContent key={gateway} gateway={gateway} onNavigate={onNavigate} scrollHeader={scrollHeader} />;
}

function SidebarTaskListContent({
  onNavigate,
  gateway,
  scrollHeader,
}: {
  onNavigate?: () => void;
  gateway: string;
  scrollHeader?: ReactNode;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sb = m.sidebar;
  const sess = m.sessions;
  const projectsText = m.projectsPage;
  const wd = m.chat.workingDirectory;
  const token = useGatewayStore((s) => s.conversationId);
  const openTokenDialog = useGatewayStore((s) => s.openTokenDialog);

  const { data: chatAgents, error: chatAgentsError, mutate: mutateChatAgents } = useSWR(
    token ? (['gateway-chat-agents', token] as const) : null,
    fetchChatAgents,
    { revalidateOnFocus: false },
  );
  const defaultAgentId = chatAgents?.defaultId ?? 'main';
  const sidebarAgentsCtx = useMemo(() => ({
    defaultAgentId,
    byId: new Map((chatAgents?.items ?? []).map((item) => [item.id.trim().toLowerCase(), item] as const)),
  }), [chatAgents?.items, defaultAgentId]);

  useEffect(() => {
    const onConfigReload = () => void mutateChatAgents();
    window.addEventListener('config-reload', onConfigReload);
    return () => window.removeEventListener('config-reload', onConfigReload);
  }, [mutateChatAgents]);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const activeConversationId = chatConversationIdFromPath(pathname);
  const sidebarUpdatedAfter = useMemo(
    () => Date.now() - SIDEBAR_STALE_DAYS * 24 * 60 * 60 * 1000,
    [],
  );

  const [renameTarget, setRenameTarget] = useState<{ key: string; name: string } | null>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null);
  const [renameProjectDraft, setRenameProjectDraft] = useState('');
  const [removeProjectId, setRemoveProjectId] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectName, setCreateProjectName] = useState('');
  const [createProjectWorkspace, setCreateProjectWorkspace] = useState('');
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [autoUnderstand, setAutoUnderstand] = useState(false);
  const includedConversationId = useRef(activeConversationId);
  const [view, setView] = useState<SessionView>(readSessionView);
  const [viewOrder, setViewOrder] = useState(readSessionViewOrder);
  const [showAllLoadedOlder, setShowAllLoadedOlder] = useState(false);
  const [inboxCollapsed, setInboxCollapsed] = useState(false);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set());
  const [expandedSessionLists, setExpandedSessionLists] = useState<Record<string, SidebarSessionPage>>({});
  const [loadingSessionLists, setLoadingSessionLists] = useState<Set<string>>(() => new Set());
  const sessionListScopes = useRef(new Map<string, { revalidate?: () => void } | null>());
  const pageWindows = useRef({ recent: { size: Infinity }, projects: { size: Infinity } });
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const previousScrollTop = useRef(0);
  const { mutate: mutateCache } = useSWRConfig();
  const [pendingOrders, setPendingOrders] = useState<Record<string, string[]>>({});
  const reorderBusyRef = useRef(new Set<string>());
  const workspacePicker = useDirectoryPicker({
    initialPath: createProjectWorkspace,
    onPicked: setCreateProjectWorkspace,
  });

  const fetchSidebarPage = useCallback(async <T,>(
    view: PaginatedSessionView,
    pageIndex: number,
    fetchPage: () => Promise<T>,
  ): Promise<T> => {
    if (pageIndex === 0) return fetchPage();

    const pageWindow = pageWindows.current[view];
    if (pageIndex >= pageWindow.size) throw new DOMException('Sidebar pagination reset', 'AbortError');
    const page = await fetchPage();
    // SWR caches individual pages even if its combined response has been superseded.
    if (pageWindow !== pageWindows.current[view]) throw new DOMException('Sidebar pagination reset', 'AbortError');
    return page;
  }, []);

  const { data, size, setSize, isValidating, mutate } = useSWRInfinite<Awaited<ReturnType<typeof fetchSidebarChatList>>>(
    (pageIndex, previousPageData) => {
      if (!token) return null;
      if (previousPageData && !previousPageData.projects.hasMore) return null;
      return ['sidebar-chat-list', gateway, token, pageIndex] as const;
    },
    async ([, , , pageIndex]: readonly [
      'sidebar-chat-list',
      string,
      string,
      number,
    ]) => {
      return fetchSidebarPage('projects', pageIndex, () => fetchSidebarChatList({
        projectLimit: PROJECT_LIMIT,
        projectOffset: pageIndex * PROJECT_LIMIT,
        sessionPreviewLimit: PROJECT_PREVIEW_LIMIT,
        inboxLimit: pageIndex === 0 ? PAGE_SIZE : 1,
        inboxOffset: 0,
        staleDays: SIDEBAR_STALE_DAYS,
        includeConversationId: includedConversationId.current,
      }));
    },
    { revalidateOnFocus: false },
  );

  const {
    data: recentPages,
    error: recentError,
    size: recentSize,
    setSize: setRecentSize,
    isValidating: validatingRecent,
    mutate: mutateRecent,
  } = useSWRInfinite<Awaited<ReturnType<typeof listSessions>>>(
    (page, previous) => !token || (previous && !previous.hasMore)
      ? null
      : ['sidebar-recent-sessions', gateway, token, page] as const,
    ([, , , page]: readonly ['sidebar-recent-sessions', string, string, number]) => fetchSidebarPage('recent', page, () => listSessions({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      excludeArchived: true,
      rootConversationsOnly: true,
      excludeAutomationRuns: true,
    })),
    { revalidateOnFocus: false },
  );
  const recentItems = useMemo(() => {
    const sessions = new Map<string, SessionMetadata>();
    for (const page of recentPages ?? []) {
      for (const session of page.items) {
        if (!sessions.has(session.key) && session.status !== 'archived' &&
            isSidebarConversation(session) && resolveSessionIdentity(session).source !== 'system') {
          sessions.set(session.key, session);
        }
      }
    }
    return [...sessions.values()].sort((a, b) => sessionUpdatedAtMs(b) - sessionUpdatedAtMs(a));
  }, [recentPages]);

  const projectGroups = useMemo(() => {
    const pages = data ?? [];
    const groups: ProjectSidebarGroup[] = [];
    const seenProjects = new Set<string>();
    for (const p of pages) {
      for (const entry of p.projects.items) {
        if (seenProjects.has(entry.project.id)) continue;
        seenProjects.add(entry.project.id);
        const containerId = `project:${entry.project.id}`;
        const expanded = expandedSessionLists[containerId];
        const sessions = (expanded?.items ?? entry.sessions).filter(isSidebarConversation);
        groups.push({
          project: entry.project,
          sessions: orderSidebarItems(
            sessions,
            pendingOrders[containerId] ?? data?.[0]?.layouts[containerId]?.itemIds,
            (session) => session.key,
          ),
          sessionHasMore: !expanded && entry.sessionHasMore,
          sessionLoading: loadingSessionLists.has(containerId),
        });
      }
    }
    return orderSidebarItems(groups, pendingOrders.projects, (group) => group.project.id);
  }, [data, expandedSessionLists, loadingSessionLists, pendingOrders]);
  const taskGroups = useMemo((): Record<string, SidebarTaskGroup> => {
    const groups: Record<string, SidebarTaskGroup> = {};
    for (const page of recentPages ?? []) Object.assign(groups, page.childrenByConversationId);
    for (const page of data ?? []) Object.assign(groups, page.childrenByConversationId);
    for (const page of Object.values(expandedSessionLists)) Object.assign(groups, page.childrenByConversationId);
    return groups;
  }, [data, expandedSessionLists, recentPages]);

  const firstInbox = data?.[0]?.inbox;
  const expandedInbox = expandedSessionLists.inbox;
  const inboxItems = useMemo(() => {
    const out = (expandedInbox?.items ?? firstInbox?.items ?? []).filter(isSidebarConversation);
    out.sort((a, b) => sessionUpdatedAtMs(b) - sessionUpdatedAtMs(a));
    return orderSidebarItems(
      out,
      pendingOrders.inbox ?? data?.[0]?.layouts.inbox?.itemIds,
      (session) => session.key,
    );
  }, [data, expandedInbox, firstInbox?.items, pendingOrders.inbox]);
  const inboxHasMore = !expandedInbox && (firstInbox?.hasMore ?? false);
  const loadingInboxMore = loadingSessionLists.has('inbox');

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
  const visibleConversationIds = useMemo(
    () => new Set([...items, ...recentItems].map((session) => session.key)),
    [items, recentItems],
  );

  const hasGroupedItems = projectGroups.length > 0 || inboxItems.length > 0 || inboxHasMore;

  const pinnedSessions = useMemo(
    () => orderSidebarItems((data?.[0]?.pinned ?? []).filter(isSidebarConversation), pendingOrders.pinned, (session) => session.key),
    [data, pendingOrders.pinned],
  );
  const pinnedConversationIds = useMemo(
    () => new Set(pinnedSessions.map((session) => session.key)),
    [pinnedSessions],
  );

  const loadedProjectNames = useMemo(
    () => new Map(projectGroups.map(({ project }) => [project.id, project.name])),
    [projectGroups],
  );
  const needsProjectNames = [...recentItems, ...pinnedSessions].some(
    ({ projectId }) => projectId && !loadedProjectNames.has(projectId),
  );
  const { data: projectOptions, mutate: mutateProjectOptions } = useSWR(
    token && (data || !isValidating) && needsProjectNames ? ['sidebar-project-names', gateway, token] : null,
    allProjectOptions,
    { revalidateOnFocus: false },
  );
  const projectNames = useMemo(
    () => new Map([...projectOptions?.map((project) => [project.id, project.name] as const) ?? [], ...loadedProjectNames]),
    [loadedProjectNames, projectOptions],
  );
  const recentGroups = groupRecentSessions(recentItems.filter(
    (session) => session.status !== 'pinned' && !pinnedConversationIds.has(session.key),
  ));
  const activeOlderIndex = recentGroups.older.findIndex((session) => session.key === activeConversationId);
  const visibleOlder = showAllLoadedOlder
    ? recentGroups.older
    : recentGroups.older.slice(0, Math.max(OLDER_SESSION_PREVIEW_LIMIT, activeOlderIndex + 1));

  const loadingMore = Boolean(isValidating && data && size > data.length);
  const lastPage = data?.[data.length - 1];
  const hasMorePages = lastPage?.projects.hasMore ?? false;
  const loadingFirst = Boolean(token && !data && isValidating);

  const setViewPageCount = useCallback((view: PaginatedSessionView, pageCount: number) => {
    pageWindows.current[view].size = pageCount;
    void (view === 'recent' ? setRecentSize : setSize)(pageCount);
  }, [setRecentSize, setSize]);

  const releaseSessionLists = useCallback((containerId?: string) => {
    if (containerId === undefined) {
      sessionListScopes.current.clear();
      setExpandedSessionLists({});
      setLoadingSessionLists(new Set());
      return;
    }
    sessionListScopes.current.delete(containerId);
    setExpandedSessionLists((current) => {
      if (!current[containerId]) return current;
      const next = { ...current };
      delete next[containerId];
      return next;
    });
    setLoadingSessionLists((current) => {
      if (!current.has(containerId)) return current;
      const next = new Set(current);
      next.delete(containerId);
      return next;
    });
  }, []);

  const loadSessionList = useCallback(async function loadSessionList(containerId: string, background = false) {
    const pending = sessionListScopes.current.get(containerId);
    if (pending) {
      if (background) pending.revalidate = () => void loadSessionList(containerId, true);
      return;
    }

    let loaded = pending === null;
    const request: { revalidate?: () => void } = {};
    sessionListScopes.current.set(containerId, request);
    if (!background) setLoadingSessionLists((current) => new Set(current).add(containerId));
    try {
      const result = await listSessions({
        ...(containerId === 'inbox' ? { unassigned: true } : { projectId: containerId.slice('project:'.length) }),
        limit: 5000,
        offset: 0,
        updatedAfter: sidebarUpdatedAfter,
        includePinned: true,
        includeConversationId: activeConversationId,
        rootConversationsOnly: true,
        excludeAutomationRuns: true,
      });
      if (sessionListScopes.current.get(containerId) === request) {
        loaded = true;
        setExpandedSessionLists((current) => ({ ...current, [containerId]: result }));
      }
    } catch {
      if (!background && sessionListScopes.current.get(containerId) === request) {
        showComposerNotification('warning', sb.sessionFilters.error);
      }
    } finally {
      if (sessionListScopes.current.get(containerId) === request) {
        if (loaded) sessionListScopes.current.set(containerId, null);
        else sessionListScopes.current.delete(containerId);
        if (!background) {
          setLoadingSessionLists((current) => {
            const next = new Set(current);
            next.delete(containerId);
            return next;
          });
        }
        request.revalidate?.();
      }
    }
  }, [activeConversationId, sb.sessionFilters.error, sidebarUpdatedAfter]);

  const revalidateExpandedSessionLists = useCallback(() => {
    // Keep expanded rows mounted while their data is refreshed.
    for (const containerId of sessionListScopes.current.keys()) void loadSessionList(containerId, true);
  }, [loadSessionList]);

  const refreshSidebar = useCallback(() => {
    revalidateExpandedSessionLists();
    void mutate();
    void mutateRecent();
  }, [mutate, mutateRecent, revalidateExpandedSessionLists]);

  const reorderSidebar = useCallback((containerId: string, itemIds: string[]) => {
    if (reorderBusyRef.current.has(containerId)) return;
    const expectedRevision = data?.[0]?.layouts[containerId]?.revision ?? 0;
    setPendingOrders((current) => ({ ...current, [containerId]: itemIds }));
    reorderBusyRef.current.add(containerId);
    void (async () => {
      try {
        await saveSidebarLayout({ containerId, itemIds, expectedRevision });
        await mutate();
      } catch {
        showComposerNotification(
          'warning',
          language === 'zh' ? '未能保存侧栏顺序，已恢复原位置' : 'Could not save sidebar order; the previous order was restored',
          undefined,
          { duration: 3500 },
        );
      } finally {
        reorderBusyRef.current.delete(containerId);
        setPendingOrders((current) => {
          const next = { ...current };
          delete next[containerId];
          return next;
        });
      }
    })();
  }, [data, language, mutate]);

  const onScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const lastScrollTop = previousScrollTop.current;
      previousScrollTop.current = el.scrollTop;
      if (el.scrollTop <= lastScrollTop) return;

      const bottom = el.getBoundingClientRect().top + el.clientHeight;
      const controls = el.querySelectorAll<HTMLButtonElement>('button[data-sidebar-load-more]');
      // Prefer the lowest control near the viewport edge when multiple groups are visible.
      for (const control of Array.from(controls).reverse()) {
        const bounds = control.getBoundingClientRect();
        if (bounds.height === 0 || bounds.top > bottom + SIDEBAR_LOAD_MORE_THRESHOLD_PX
          || bounds.bottom < bottom - SIDEBAR_LOAD_MORE_THRESHOLD_PX) continue;
        if (!control.disabled) control.click();
        break;
      }
    },
    [],
  );

  useEffect(() => {
    if (!token) return;
    const onSessionListRefresh = () => {
      refreshSidebar();
    };
    const onProjectUpdated = () => {
      refreshSidebar();
      void mutateProjectOptions();
    };
    const onRunCompleted = () => void mutateRecent();
    const onSessionTranscriptUpdated = (e: Event) => {
      if (shouldRefreshSidebarForTranscriptUpdate(
        (e as CustomEvent<unknown>).detail,
        visibleConversationIds,
      )) {
        refreshSidebar();
      }
    };
    window.addEventListener('session-updated', onSessionListRefresh);
    window.addEventListener('session-created', onSessionListRefresh);
    window.addEventListener('project-updated', onProjectUpdated);
    window.addEventListener('task-updated', onSessionListRefresh);
    window.addEventListener('session-transcript-updated', onSessionTranscriptUpdated);
    window.addEventListener('run-completed', onRunCompleted);
    window.addEventListener('agent-run-ended', onRunCompleted);
    return () => {
      window.removeEventListener('session-updated', onSessionListRefresh);
      window.removeEventListener('session-created', onSessionListRefresh);
      window.removeEventListener('project-updated', onProjectUpdated);
      window.removeEventListener('task-updated', onSessionListRefresh);
      window.removeEventListener('session-transcript-updated', onSessionTranscriptUpdated);
      window.removeEventListener('run-completed', onRunCompleted);
      window.removeEventListener('agent-run-ended', onRunCompleted);
    };
  }, [token, refreshSidebar, mutateProjectOptions, mutateRecent, visibleConversationIds]);

  useEffect(() => {
    if (view !== 'projects' || !token || !activeConversationId || !data) return;
    if (includedConversationId.current === activeConversationId) return;
    if (items.some((session) => session.key === activeConversationId)) return;
    includedConversationId.current = activeConversationId;
    void mutate();
    revalidateExpandedSessionLists();
  }, [activeConversationId, data, items, mutate, revalidateExpandedSessionLists, token, view]);

  const openRename = useCallback((session: SessionMetadata) => {
    setRenameTarget({ key: session.key, name: sessionTitle(session, m.chat.newSession) });
  }, [m.chat.newSession]);

  const runDelete = async (key: string) => {
    try {
      await deleteSession(key);
      if (activeConversationId === key) {
        navigate('/chat/new?projectScope=none', { state: { forceNewChat: true } });
      }
      refreshSidebar();
    } catch {
      // Preserve the current sidebar state when the action fails.
    }
  };

  const openProjectRename = useCallback((project: Project) => {
    setRenameProjectId(project.id);
    setRenameProjectDraft(project.name.trim());
  }, []);

  const runProjectRename = async () => {
    if (!renameProjectId || !renameProjectTarget) return;
    const name = renameProjectDraft.trim();
    if (!name) return;
    try {
      await renameProject(renameProjectId, name, renameProjectTarget.version);
      setRenameProjectId(null);
      refreshSidebar();
      window.dispatchEvent(new CustomEvent('project-updated', { detail: { id: renameProjectId } }));
    } catch {
      // Preserve the current sidebar state when the action fails.
    }
  };

  const runProjectArchive = useCallback(async (project: Project) => {
    try {
      await archiveProject(project.id, project.version);
      if (pathname === `/projects/${encodeURIComponent(project.id)}`) {
        navigate('/projects');
      }
      refreshSidebar();
      window.dispatchEvent(new CustomEvent('project-updated', { detail: { id: project.id } }));
    } catch {
      // Preserve the current sidebar state when the action fails.
    }
  }, [navigate, pathname, refreshSidebar]);

  const toggleProjectPin = useCallback(async (project: Project) => {
    try {
      if (project.pinnedAt) {
        await unpinProject(project.id, project.version);
      } else {
        await pinProject(project.id, project.version);
      }
      refreshSidebar();
      window.dispatchEvent(new CustomEvent('project-updated', { detail: { id: project.id } }));
    } catch {
      // Preserve the current sidebar state when the action fails.
    }
  }, [refreshSidebar]);

  const runProjectRemove = async (project: Project) => {
    const projectId = project.id;
    try {
      await deleteProject(projectId, project.version);
      if (pathname === `/projects/${encodeURIComponent(projectId)}`) {
        navigate('/projects');
      }
      refreshSidebar();
      window.dispatchEvent(new CustomEvent('project-updated', { detail: { id: projectId } }));
    } catch {
      // Preserve the current sidebar state when the action fails.
    }
  };

  const toggleProjectExpanded = useCallback((projectId: string) => {
    const containerId = `project:${projectId}`;
    if (expandedSessionLists[containerId]) releaseSessionLists(containerId);
    else void loadSessionList(containerId);
  }, [expandedSessionLists, loadSessionList, releaseSessionLists]);

  const toggleProjectCollapsed = useCallback((projectId: string) => {
    if (!collapsedProjectIds.has(projectId)) releaseSessionLists(`project:${projectId}`);
    setCollapsedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, [collapsedProjectIds, releaseSessionLists]);

  const toggleInboxCollapsed = () => {
    if (!inboxCollapsed) releaseSessionLists('inbox');
    setInboxCollapsed(!inboxCollapsed);
  };

  const loadMoreInbox = useCallback(() => {
    if (inboxHasMore) void loadSessionList('inbox');
  }, [inboxHasMore, loadSessionList]);

  const createProjectChat = useCallback((project: Project) => {
    navigateToNewChat(navigate, newChatHrefForProject(project.id), {
      state: { forceNewChat: true, agentId: project.defaultAgentId ?? defaultAgentId },
    }, onNavigate);
  }, [defaultAgentId, navigate, onNavigate]);

  const submitCreateProject = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = createProjectName.trim();
    const workspaceRoot = createProjectWorkspace.trim();
    if (!name || creatingProject) return;

    setCreatingProject(true);
    setCreateProjectError(null);
    try {
      const project = await createProject({ name, ...(workspaceRoot ? { workspaceRoot } : {}), autoUnderstand: Boolean(workspaceRoot) && autoUnderstand });
      setCreateProjectName('');
      setCreateProjectWorkspace('');
      setAutoUnderstand(false);
      setCreateProjectOpen(false);
      refreshSidebar();
      window.dispatchEvent(new CustomEvent('project-updated', { detail: { id: project.id } }));
    } catch (cause) {
      setCreateProjectError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreatingProject(false);
    }
  }, [createProjectName, createProjectWorkspace, creatingProject, refreshSidebar, autoUnderstand]);

  const renameProjectTarget = renameProjectId
    ? projectGroups.find((group) => group.project.id === renameProjectId)?.project
    : undefined;
  const removeProjectTarget = removeProjectId
    ? projectGroups.find((group) => group.project.id === removeProjectId)?.project
    : undefined;

  const recentHasMore = recentPages?.at(-1)?.hasMore ?? false;
  const pendingRecentPage = Boolean(recentPages && recentSize > recentPages.length);
  const needsOlderPreview = recentGroups.older.length < OLDER_SESSION_PREVIEW_LIMIT;
  const hasHiddenOlder = visibleOlder.length < recentGroups.older.length;
  const hasMoreOlder = hasHiddenOlder || (recentHasMore && !needsOlderPreview && !recentError);
  const canLoadRecentPage = recentHasMore && !recentError && !validatingRecent && !pendingRecentPage;
  useEffect(() => {
    if (view === 'recent' && needsOlderPreview && canLoadRecentPage) {
      setViewPageCount('recent', recentSize + 1);
    }
  }, [canLoadRecentPage, needsOlderPreview, recentSize, setViewPageCount, view]);

  const recentLoadError = recentError ? (
    <div role="alert" className="space-y-2 p-2 text-xs text-fg-muted">
      <p>{sb.sessionFilters.error}</p>
      <Button variant="secondary" onClick={() => void mutateRecent()}>{sb.sessionFilters.retry}</Button>
    </div>
  ) : null;
  const sessionRowProps = {
    onNavigate,
    onRequestRename: openRename,
    onRequestDelete: setDeleteKey,
    sb,
    sess,
    clipboard: m.clipboard,
    defaultUnnamedTitle: m.chat.newSession,
  };

  const reorderViews = (order: SessionView[]) => {
    setViewOrder(order);
    try {
      globalThis.localStorage?.setItem(SESSION_VIEW_ORDER_STORAGE_KEY, JSON.stringify(order));
    } catch {
      // The new order still applies to this window.
    }
  };
  const viewOptions = {
    recent: { label: sb.sessionViewRecent, icon: Clock3 },
    projects: { label: sb.sessionViewProjects, icon: Folder },
    experts: { label: sb.sessionViewExperts, icon: UsersRound },
  };

  const changeView = (next: SessionView) => {
    if (next === view) return;
    if (view !== 'experts') {
      pageWindows.current[view] = { size: 1 };
      setViewPageCount(view, 1);
      const pageKey = view === 'recent' ? 'sidebar-recent-sessions' : 'sidebar-chat-list';
      void mutateCache((key) => Array.isArray(key) && key[0] === pageKey
        && key[1] === gateway && key[2] === token && key.at(-1) > 0, undefined, { revalidate: false });
    }
    if (view === 'recent') setShowAllLoadedOlder(false);
    if (view === 'projects') releaseSessionLists();
    if (scrollRegionRef.current) scrollRegionRef.current.scrollTop = 0;
    previousScrollTop.current = 0;
    setView(next);
    try {
      globalThis.localStorage?.setItem(SESSION_VIEW_STORAGE_KEY, next);
    } catch {
      /* Optional preference; storage may be unavailable. */
    }
    if (next !== 'projects' || !activeConversationId) return;
    const active = recentItems.find((session) => session.key === activeConversationId)
      ?? items.find((session) => session.key === activeConversationId);
    const projectId = active?.projectId;
    if (projectId) {
      setCollapsedProjectIds((current) => {
        if (!current.has(projectId)) return current;
        const expanded = new Set(current);
        expanded.delete(projectId);
        return expanded;
      });
    } else if (active) {
      setInboxCollapsed(false);
    }
  };

  const renderRecentRows = (sessions: SessionMetadata[]) => (
    <div className="flex flex-col gap-0.5">
      {sessions.map((session) => (
        <SidebarTaskRow
          key={session.key}
          session={session}
          contextLabel={session.projectId ? projectNames.get(session.projectId) : undefined}
          isActive={activeConversationId === session.key}
          {...sessionRowProps}
        />
      ))}
    </div>
  );

  const renderRecentPeriod = (label: string, sessions: SessionMetadata[], footer?: ReactNode) => sessions.length > 0 || footer ? (
    <section aria-label={label}>
      <h2 className={cn('px-2 pb-1', sidebarSectionLabelClass)}>{label}</h2>
      {renderRecentRows(sessions)}
      {footer}
    </section>
  ) : null;

  if (!token) {
    return (
      <div className="app-sidebar-nav-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-2">
        {scrollHeader}
        <div className="flex flex-col gap-1.5 px-4 pt-4">
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
    <TaskGroupsContext value={taskGroups}>
    <SidebarAgentsContext value={sidebarAgentsCtx}>
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRegionRef}
        className="app-sidebar-nav-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-2"
        onScroll={onScroll}
      >
        {scrollHeader}
        <div className="px-4 pb-2">
          <SlidingSegmented<SessionView>
            aria-label={sb.sessionViewLabel}
            value={view}
            onChange={changeView}
            onReorder={reorderViews}
            flush
            buttonClassName="h-8 min-w-0 px-1 text-[0.8125rem]"
            options={viewOrder.map(value => ({ value, ...viewOptions[value] }))}
          />
        </div>
        {view !== 'experts' ? <div className="px-2">
          <SidebarPinnedSection
            sessions={pinnedSessions}
            projectNames={view === 'recent' ? projectNames : undefined}
            activeConversationId={activeConversationId}
            {...sessionRowProps}
            onReorder={reorderSidebar}
          />
        </div> : null}
        {view === 'experts' ? (
          <div className="px-2">
            {chatAgentsError && !chatAgents ? (
              <div role="alert" className="space-y-2 p-2 text-xs text-fg-muted">
                <p>{sb.expertsLoadError}</p>
                <Button variant="secondary" onClick={() => void mutateChatAgents()}>{sb.sessionFilters.retry}</Button>
              </div>
            ) : chatAgents ? (
              <SidebarExpertList agents={chatAgents.items} defaultAgentId={defaultAgentId} activeConversationId={activeConversationId} onNavigate={onNavigate} />
            ) : <SidebarTaskListSkeleton />}
          </div>
        ) : view === 'recent' ? (
          <div className="flex flex-col gap-2 px-2">
            {!recentPages && !recentError ? <SidebarTaskListSkeleton /> : null}
            {!pendingRecentPage ? recentLoadError : null}
            {recentPages && !recentError && !recentItems.length && !pinnedSessions.length && !recentHasMore
              ? <p className="px-2 py-3 text-[0.8125rem] text-fg-muted">{sb.taskListEmpty}</p>
              : null}
            {renderRecentPeriod(sb.timelineToday, recentGroups.today)}
            {renderRecentPeriod(sb.timelineYesterday, recentGroups.yesterday)}
            {renderRecentPeriod(sb.timelineOlder, visibleOlder, pendingRecentPage || hasMoreOlder ? (
              <>
                {pendingRecentPage ? recentLoadError ?? <SidebarSessionSkeletonRow /> : null}
                {hasMoreOlder ? (
                  <button
                    type="button"
                    className="min-h-8 w-full rounded-lg px-2 text-left text-[0.8125rem] text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                    data-sidebar-load-more=""
                    disabled={!hasHiddenOlder && !canLoadRecentPage}
                    onClick={() => {
                      setShowAllLoadedOlder(true);
                      if (!hasHiddenOlder && canLoadRecentPage) setViewPageCount('recent', recentSize + 1);
                    }}
                  >
                    {sb.timelineViewMore}
                  </button>
                ) : null}
              </>
            ) : null)}
          </div>
        ) : (
          <div>
          <SidebarCreateSectionHeader
            label={sb.sessionViewProjects}
            createLabel={projectsText.createTitle}
            onCreate={() => setCreateProjectOpen(true)}
          />
          {loadingFirst ? (
            <SidebarTaskListSkeleton />
          ) : hasGroupedItems ? (
            <div className="flex flex-col px-2">
              {projectGroups.length > 0 ? (
                <div className="pb-1">
                  {projectGroups.map((group) => (
                        <SidebarProjectSection
                          key={group.project.id}
                          group={group}
                          isExpanded={Boolean(expandedSessionLists[`project:${group.project.id}`])}
                          isCollapsed={collapsedProjectIds.has(group.project.id)}
                          activeConversationId={activeConversationId}
                          onToggleExpanded={toggleProjectExpanded}
                          onToggleCollapsed={toggleProjectCollapsed}
                          onCreateProjectChat={(project) => void createProjectChat(project)}
                          onToggleProjectPin={(project) => void toggleProjectPin(project)}
                          onRequestProjectRename={openProjectRename}
                          onArchiveProject={(project) => void runProjectArchive(project)}
                          onRequestProjectRemove={(project) => setRemoveProjectId(project.id)}
                          onNavigate={onNavigate}
                          onRequestRename={openRename}
                          onRequestDelete={setDeleteKey}
                          sb={sb}
                          sess={sess}
                          clipboard={m.clipboard}
                          defaultUnnamedTitle={m.chat.newSession}
                          excludedConversationIds={pinnedConversationIds}
                          projectSort={{
                            containerId: 'projects',
                            itemId: group.project.id,
                            itemIds: projectGroups.map((item) => item.project.id),
                            onReorder: reorderSidebar,
                          }}
                          onReorder={reorderSidebar}
                        />
                  ))}
                </div>
              ) : null}

              <SidebarInboxSection
                sessions={inboxItems.filter((session) => resolveSessionIdentity(session).source !== 'system')}
                hasMore={inboxHasMore}
                loadingMore={loadingInboxMore}
                isCollapsed={inboxCollapsed}
                onToggleCollapsed={toggleInboxCollapsed}
                onCreateChat={() => {
                  navigateToNewChat(navigate, '/chat/new?projectScope=none', { state: { forceNewChat: true } }, onNavigate);
                }}
                onLoadMore={loadMoreInbox}
                activeConversationId={activeConversationId}
                onNavigate={onNavigate}
                onRequestRename={openRename}
                onRequestDelete={setDeleteKey}
                sb={sb}
                sess={sess}
                clipboard={m.clipboard}
                defaultUnnamedTitle={m.chat.newSession}
                excludedConversationIds={pinnedConversationIds}
                onReorder={reorderSidebar}
              />
              {inboxItems.some((session) => resolveSessionIdentity(session).source === 'system') ? <details className="mt-3" open={inboxItems.some((session) => session.key === activeConversationId && resolveSessionIdentity(session).source === 'system')}>
                <summary className="cursor-pointer px-2 py-2 text-[0.8125rem] font-medium text-fg-muted">{language === 'zh' ? '系统活动' : 'System activity'}</summary>
              <SidebarInboxSection
                sessions={inboxItems.filter((session) => resolveSessionIdentity(session).source === 'system')}
                hasMore={false}
                loadingMore={loadingInboxMore}
                isCollapsed={false}
                onToggleCollapsed={() => undefined}
                onCreateChat={() => {
                  navigateToNewChat(navigate, '/chat/new?projectScope=none', { state: { forceNewChat: true } }, onNavigate);
                }}
                onLoadMore={loadMoreInbox}
                activeConversationId={activeConversationId}
                onNavigate={onNavigate}
                onRequestRename={openRename}
                onRequestDelete={setDeleteKey}
                sb={sb}
                sess={sess}
                clipboard={m.clipboard}
                defaultUnnamedTitle={m.chat.newSession}
                excludedConversationIds={pinnedConversationIds}
                onReorder={reorderSidebar}
                sortable={false}
              />
              </details> : null}
            </div>
          ) : (
            <div className="px-4 pb-2">
              <p className="rounded-xl bg-surface-panel p-3 text-[0.8125rem] leading-relaxed text-fg-muted">
                {sb.taskListEmpty}
              </p>
            </div>
          )}

          {loadingMore ? <SidebarSessionSkeletonRow /> : hasMorePages ? (
            <button
              type="button"
              className="mx-4 rounded-lg px-2 py-1.5 text-[0.8125rem] text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              data-sidebar-load-more=""
              onClick={() => setViewPageCount('projects', (data?.length ?? 0) + 1)}
            >
              {sb.sessionFilters.more}
            </button>
          ) : null}
          </div>
        )}
      </div>

      <Dialog.Root
        open={createProjectOpen}
        onOpenChange={(open) => {
          if (creatingProject) return;
          setCreateProjectOpen(open);
          if (!open) setCreateProjectError(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim" />
          <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[90] flex h-[min(30rem,calc(100vh-2rem))] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-float focus:outline-none">
            <div className="shrink-0 border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">{projectsText.createTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">
                {projectsText.createDescription}
              </Dialog.Description>
            </div>
            <form onSubmit={submitCreateProject} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <label className="grid gap-1.5 text-sm font-medium text-fg">
                  {projectsText.projectName}
                  <input
                    autoFocus
                    className="h-10 rounded-lg border border-edge bg-surface-base px-3 font-normal outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    value={createProjectName}
                    onChange={(event) => setCreateProjectName(event.target.value)}
                    maxLength={160}
                  />
                </label>
                <div className="grid gap-1.5 text-sm">
                  <span className="font-medium text-fg">{projectsText.workspaceRoot}</span>
                  <button
                    type="button"
                    className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-edge bg-surface-base px-3 py-2 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={workspacePicker.pick}
                    disabled={creatingProject || workspacePicker.picking}
                  >
                    {workspacePicker.picking
                      ? <Loader2 className="size-5 shrink-0 animate-spin text-accent" aria-hidden />
                      : <FolderOpen className="size-5 shrink-0 text-accent" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-fg">
                        {createProjectWorkspace ? wd.chooseFolder : wd.selectWorkingDirectory}
                      </span>
                      <span
                        className={cn(
                          'mt-0.5 block truncate font-mono text-xs font-normal',
                          createProjectWorkspace ? 'text-fg-muted' : 'text-fg-subtle',
                        )}
                        title={createProjectWorkspace || undefined}
                      >
                        {createProjectWorkspace || projectsText.workspaceSelectionPlaceholder}
                      </span>
                    </span>
                  </button>
                  <p className="text-xs font-normal text-fg-muted">{projectsText.workspaceSelectionHint}</p>
                </div>
                <ProjectUnderstandingCheckbox checked={autoUnderstand} onChange={setAutoUnderstand} disabled={creatingProject || !createProjectWorkspace.trim()} />
                {createProjectError ? (
                  <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
                    {createProjectError}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-4">
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" disabled={creatingProject}>{projectsText.cancel}</Button>
                </Dialog.Close>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={creatingProject || !createProjectName.trim()}
                >
                  {creatingProject ? projectsText.home.creating : projectsText.create}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {!workspacePicker.hasNativePicker ? (
        <WorkingDirectoryPickerModal
          open={workspacePicker.modalOpen}
          onOpenChange={workspacePicker.setModalOpen}
          initialAbsolutePath={createProjectWorkspace || undefined}
          onConfirm={workspacePicker.confirmPick}
          wd={wd}
        />
      ) : null}

      {renameTarget ? (
        <SessionRenameDialog
          key={renameTarget.key}
          conversationId={renameTarget.key}
          initialName={renameTarget.name}
          onClose={() => setRenameTarget(null)}
        />
      ) : null}

      <Dialog.Root open={deleteKey !== null} onOpenChange={(o) => !o && setDeleteKey(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[60] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-overlay p-4 shadow-popover dark:border-edge">
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

      <Dialog.Root open={renameProjectId !== null} onOpenChange={(o) => !o && setRenameProjectId(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[60] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-overlay p-4 shadow-popover dark:border-edge">
            <Dialog.Title className="text-base font-semibold text-fg">{sb.projectRenameTitle}</Dialog.Title>
            <label className="mt-3 block text-xs font-medium text-fg-subtle" htmlFor="sidebar-project-rename-input">
              {sb.projectRenamePlaceholder}
            </label>
            <input
              id="sidebar-project-rename-input"
              type="text"
              value={renameProjectDraft}
              onChange={(e) => setRenameProjectDraft(e.target.value)}
              className={cn(
                'mt-1.5 w-full rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg',
                formControlBorderFocusClass,
                'dark:border-edge',
              )}
              placeholder={renameProjectTarget?.name ?? ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runProjectRename();
                }
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRenameProjectId(null)}>
                {sb.taskRenameCancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => void runProjectRename()}
                disabled={!renameProjectDraft.trim()}
              >
                {sb.taskRenameSave}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={removeProjectId !== null} onOpenChange={(o) => !o && setRemoveProjectId(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[60] w-[min(100%-2rem,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-overlay p-4 shadow-popover dark:border-edge">
            <Dialog.Title className="text-base font-semibold text-fg">{sb.projectRemoveTitle}</Dialog.Title>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              {removeProjectTarget
                ? interpolate(sb.projectRemoveMessage, { name: removeProjectTarget.name })
                : ''}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRemoveProjectId(null)}>
                {sess.cancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                className="bg-red-600 hover:bg-red-700"
                onClick={() => {
                  if (removeProjectTarget) void runProjectRemove(removeProjectTarget);
                  setRemoveProjectId(null);
                }}
              >
                {sb.projectRemove}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
    </SidebarAgentsContext>
    </TaskGroupsContext>
  );
}
