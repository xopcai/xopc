import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { resolveSessionIdentity } from '@xopcai/gateway-contract';
import {
  Archive,
  ChevronDown,
  ClipboardCopy,
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
} from 'lucide-react';
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type UIEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

import { SessionFilterToolbar } from '@/features/sessions/session-filter-toolbar';
import { useSessionDiscovery } from '@/features/sessions/use-session-discovery';
import { sessionIdentityLabel } from '@/features/sessions/session-identity-label';

import { SessionChannelIcon } from '@/components/shell/session-channel-icon';
import { ProjectUnderstandingAction, ProjectUnderstandingCheckbox } from '@/features/projects/project-understanding';
import { shouldRefreshSidebarForTranscriptUpdate } from '@/components/shell/sidebar-session-refresh';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { newChatHrefForProject } from '@/features/chat/session/composer-handoff-params';
import { useSidebarSessionAgentRun } from '@/features/chat/session/use-sidebar-session-agent-run';
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
  renameSession,
  saveSidebarLayout,
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

const SessionDescriptionContext = createContext(false);

const PAGE_SIZE = 20;
const PROJECT_LIMIT = 12;
const PROJECT_PREVIEW_LIMIT = 5;
const SIDEBAR_STALE_DAYS = 60;
const SIDEBAR_DRAG_MIME = 'application/x-xopc-sidebar-item';

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
  sessionTotal: number;
  sessionHasMore: boolean;
  sessionLoading?: boolean;
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

function rowShellClass(isActive: boolean, indented: boolean): string {
  return cn(
    'group relative flex min-h-8 w-full min-w-0 items-center rounded-lg pr-1 text-left text-sm leading-5 transition-colors duration-200 ease-out',
    indented ? 'pl-[1.125rem]' : 'pl-1.5',
    'focus-within:outline-none',
    isActive
      ? 'bg-surface-active font-medium text-fg'
      : 'font-normal text-fg-muted hover:bg-surface-hover hover:text-fg',
  );
}

const sidebarSectionLabelClass =
  'text-xs font-normal leading-5 text-fg-subtle';
const sidebarSectionButtonClass = cn(
  sidebarSectionLabelClass,
  'transition-colors hover:text-fg-muted',
);

function SidebarSessionSkeletonRow({ indented = false }: { indented?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 p-1.5', indented && 'pl-7')}>
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
  indented = false,
  onNavigate,
  mutate,
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
  /** Keep nested titles indented while allowing the row background to span the full list width. */
  indented?: boolean;
  contextLabel?: string;
  onNavigate?: () => void;
  mutate: () => void;
  onRequestRename: (session: SessionMetadata) => void;
  onRequestDelete: (key: string) => void;
  sb: ReturnType<typeof messages>['sidebar'];
  sess: ReturnType<typeof messages>['sessions'];
  clipboard: ReturnType<typeof messages>['clipboard'];
  defaultUnnamedTitle: string;
  sort?: SidebarSortSpec;
}) {
  const showDescription = useContext(SessionDescriptionContext);
  const identity = resolveSessionIdentity(session);
  const showIdentityIcon = identity.source !== 'workbench' || identity.purpose !== 'chat';
  const identityLabel = sessionIdentityLabel(session, sb.sessionFilters);
  const description = [identityLabel, contextLabel].filter(Boolean).join(' · ');
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const agentRunActive = useSidebarSessionAgentRun(session.key);
  const runPresence = useChatRunPresenceStore((state) => state.runs[session.key]);
  const title = sessionTitle(session, defaultUnnamedTitle);
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
      void mutate();
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
    <div className={rowShellClass(isActive, indented)}>
      <Link
        to={`/chat/${encodeURIComponent(session.key)}`}
        className={cn(
          'min-w-0 flex-1 self-stretch rounded-lg py-1 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
          'flex min-w-0 items-center gap-2',
          hasRunPresence ? 'pr-[4.75rem]' : 'pr-12',
        )}
        title={`${title} — ${description}`}
        aria-label={`${title} — ${description}`}
        onClick={() => onNavigate?.()}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRequestRename(session);
        }}
      >
        {showIdentityIcon ? <span className="flex size-4 shrink-0 items-center justify-center text-fg-muted" title={identityLabel}>
          <SessionChannelIcon sourceChannel={session.sourceChannel} session={session} className="size-3.5" />
        </span> : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{title}</span>
          {showDescription ? <span className="block truncate text-xs font-normal text-fg-muted">{description}</span> : null}
        </span>
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
          'pointer-events-none absolute inset-y-0 z-10 flex items-center opacity-0 transition-opacity',
          'group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
          hasRunPresence ? 'right-7' : 'right-1',
          menuOpen && 'pointer-events-auto opacity-100',
        )}
      >
        <button
          type="button"
          className={cn(
            'flex h-8 w-6 shrink-0 items-center justify-center rounded-lg text-fg-muted',
            'hover:bg-surface-hover hover:text-fg',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
            'disabled:cursor-wait',
          )}
          aria-label={isPinned ? sess.unpin : sess.pin}
          title={isPinned ? sess.unpin : sess.pin}
          aria-pressed={isPinned}
          disabled={pinBusy}
          onClick={() => void handlePinToggle()}
        >
          {pinBusy ? (
            <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden />
          ) : isPinned ? (
            <PinOff className="size-4 rotate-45" strokeWidth={1.75} aria-hidden />
          ) : (
            <Pin className="size-4 rotate-45" strokeWidth={1.75} aria-hidden />
          )}
        </button>
        <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={cn(
                'flex h-8 w-6 shrink-0 items-center justify-center rounded-lg text-fg-muted',
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
                  onRequestRename(session);
                }}
              >
                <Pencil className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                {sb.taskRename}
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
          className="z-50 w-[12rem] rounded-lg border border-edge bg-surface-panel p-1 shadow-elevated dark:border-edge"
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={12}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <Link
            to={`/projects/${encodeURIComponent(project.id)}`}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
            onClick={() => {
              setMenuOpen(false);
              onNavigate?.();
            }}
          >
            <ExternalLink className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {sb.projectOpen}
          </Link>
          <ProjectUnderstandingAction projectId={project.id} onStarted={() => setMenuOpen(false)}
            className="flex w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-fg hover:bg-surface-hover disabled:opacity-50" />
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
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
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium leading-snug text-fg transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-fg-subtle disabled:hover:bg-transparent"
            onClick={() => void openWorkspace()}
            disabled={!canOpenWorkspace}
            title={!canOpenWorkspace ? sb.projectOpenInExplorerUnavailable : undefined}
          >
            <FolderOpen className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {sb.projectOpenInExplorer}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
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
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium leading-snug text-fg transition-colors hover:bg-surface-hover"
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
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium leading-snug text-red-600 transition-colors hover:bg-surface-hover dark:text-red-400"
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
  mutate,
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
  mutate: () => void;
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
          'group flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium leading-5',
          hasActiveSession ? 'text-fg' : 'text-fg-muted',
        )}
      >
        <button
          type="button"
          className="flex h-7 min-w-0 flex-1 items-center gap-1 text-left hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
          onClick={() => onToggleCollapsed(group.project.id)}
          title={group.project.name}
          aria-expanded={!isCollapsed}
        >
          <Folder className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden />
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
              indented
              onNavigate={onNavigate}
              mutate={mutate}
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
              className="ml-4 flex w-fit items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
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
  mutate,
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
  mutate: () => void;
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
            indented
            onNavigate={onNavigate}
            mutate={mutate}
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
            className="ml-4 flex w-fit items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
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

function SidebarPinnedSection({
  sessions,
  activeConversationId,
  onNavigate,
  mutate,
  onRequestRename,
  onRequestDelete,
  sb,
  sess,
  clipboard,
  defaultUnnamedTitle,
  onReorder,
}: {
  sessions: SessionMetadata[];
  activeConversationId?: string;
  onNavigate?: () => void;
  mutate: () => void;
  onRequestRename: (session: SessionMetadata) => void;
  onRequestDelete: (key: string) => void;
  sb: ReturnType<typeof messages>['sidebar'];
  sess: ReturnType<typeof messages>['sessions'];
  clipboard: ReturnType<typeof messages>['clipboard'];
  defaultUnnamedTitle: string;
  onReorder: (containerId: string, itemIds: string[]) => void;
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
            isActive={activeConversationId === session.key}
            onNavigate={onNavigate}
            mutate={mutate}
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

export function SidebarTaskList({ onNavigate }: { onNavigate?: () => void }) {
  const gateway = useGatewayStore((state) => state.baseUrl);
  return <SidebarTaskListContent key={gateway} gateway={gateway} onNavigate={onNavigate} />;
}

function SidebarTaskListContent({ onNavigate, gateway }: { onNavigate?: () => void; gateway: string }) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sb = m.sidebar;
  const sess = m.sessions;
  const projectsText = m.projectsPage;
  const wd = m.chat.workingDirectory;
  const token = useGatewayStore((s) => s.conversationId);
  const discovery = useSessionDiscovery(gateway, token);
  const filterLabels = sb.sessionFilters;
  const listScrollRef = useRef<HTMLDivElement>(null);
  const browseScrollTop = useRef(0);
  useLayoutEffect(() => {
    if (listScrollRef.current) listScrollRef.current.scrollTop = discovery.active ? 0 : browseScrollTop.current;
  }, [discovery.active]);
  const openTokenDialog = useGatewayStore((s) => s.openTokenDialog);

  const { data: chatAgents, mutate: mutateChatAgents } = useSWR(
    token ? (['gateway-chat-agents', token] as const) : null,
    fetchChatAgents,
    { revalidateOnFocus: false },
  );
  const defaultAgentId = chatAgents?.defaultId ?? 'main';

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

  const [renameKey, setRenameKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null);
  const [renameProjectDraft, setRenameProjectDraft] = useState('');
  const [removeProjectId, setRemoveProjectId] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectName, setCreateProjectName] = useState('');
  const [createProjectWorkspace, setCreateProjectWorkspace] = useState('');
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [autoUnderstand, setAutoUnderstand] = useState(true);
  const [includedConversationId, setIncludedConversationId] = useState<string | undefined>(() => activeConversationId);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [inboxCollapsed, setInboxCollapsed] = useState(false);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());
  const [projectSessionOverrides, setProjectSessionOverrides] = useState<Record<string, ProjectSessionOverride>>({});
  const [loadingProjectIds, setLoadingProjectIds] = useState<Set<string>>(() => new Set());
  const [inboxExtraItems, setInboxExtraItems] = useState<SessionMetadata[]>([]);
  const [inboxHasMoreOverride, setInboxHasMoreOverride] = useState<boolean | null>(null);
  const [loadingInboxMore, setLoadingInboxMore] = useState(false);
  const [pendingOrders, setPendingOrders] = useState<Record<string, string[]>>({});
  const reorderBusyRef = useRef(new Set<string>());
  const workspacePicker = useDirectoryPicker({
    initialPath: createProjectWorkspace,
    onPicked: setCreateProjectWorkspace,
  });

  const { data, size, setSize, isValidating, mutate } = useSWRInfinite<Awaited<ReturnType<typeof fetchSidebarChatList>>>(
    (pageIndex, previousPageData) => {
      if (!token) return null;
      if (previousPageData && !previousPageData.projects.hasMore) return null;
      return ['sidebar-chat-list', token, includedConversationId ?? '', pageIndex] as const;
    },
    async ([, , includeConversationId, pageIndex]: readonly [
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
        includeConversationId: includeConversationId || undefined,
      });
    },
    {
      // Changing includeConversationId to reveal a freshly created chat must not
      // replace the visible list with the first-load skeleton.
      keepPreviousData: true,
      revalidateOnFocus: false,
    },
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
        });
      }
    }
    const orderedGroups = groups.map((group) => ({
      ...group,
      sessions: orderSidebarItems(
        group.sessions,
        pendingOrders[`project:${group.project.id}`],
        (session) => session.key,
      ),
    }));
    return orderSidebarItems(orderedGroups, pendingOrders.projects, (group) => group.project.id);
  }, [data, loadingProjectIds, pendingOrders, projectSessionOverrides]);

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
    return orderSidebarItems(
      out,
      pendingOrders.inbox ?? data?.[0]?.layouts.inbox?.itemIds,
      (session) => session.key,
    );
  }, [data, firstInbox?.items, inboxExtraItems, pendingOrders.inbox]);
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
  const visibleConversationIds = useMemo(
    () => new Set(items.map((session) => session.key)),
    [items],
  );

  const hasGroupedItems = projectGroups.length > 0 || inboxItems.length > 0;

  const pinnedSessions = useMemo(
    () => orderSidebarItems(data?.[0]?.pinned ?? [], pendingOrders.pinned, (session) => session.key),
    [data, pendingOrders.pinned],
  );
  const pinnedConversationIds = useMemo(
    () => new Set(pinnedSessions.map((session) => session.key)),
    [pinnedSessions],
  );

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
      if (discovery.active) return;
      browseScrollTop.current = el.scrollTop;
      if (!hasMorePages || loadingMore) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight - scrollTop - clientHeight > 100) return;
      void setSize((s) => s + 1);
    },
    [discovery.active, hasMorePages, loadingMore, setSize],
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
    const onSessionTranscriptUpdated = (e: Event) => {
      if (shouldRefreshSidebarForTranscriptUpdate(
        (e as CustomEvent<unknown>).detail,
        visibleConversationIds,
      )) {
        refreshSidebar();
      }
    };
    window.addEventListener('session-updated', onSessionUpdated);
    window.addEventListener('session-created', onSessionListRefresh);
    window.addEventListener('project-updated', onSessionListRefresh);
    window.addEventListener('session-transcript-updated', onSessionTranscriptUpdated);
    return () => {
      window.removeEventListener('session-updated', onSessionUpdated);
      window.removeEventListener('session-created', onSessionListRefresh);
      window.removeEventListener('project-updated', onSessionListRefresh);
      window.removeEventListener('session-transcript-updated', onSessionTranscriptUpdated);
    };
  }, [token, refreshSidebar, visibleConversationIds]);

  useEffect(() => {
    if (!token || !activeConversationId || !data) return;
    if (items.some((session) => session.key === activeConversationId)) return;
    setIncludedConversationId((prev) => (prev === activeConversationId ? prev : activeConversationId));
  }, [activeConversationId, data, items, token]);

  const openRename = useCallback((session: SessionMetadata) => {
    setRenameKey(session.key);
    setRenameDraft(sessionTitle(session, m.chat.newSession));
  }, [m.chat.newSession]);

  const runRename = async () => {
    if (!renameKey) return;
    const name = renameDraft.trim();
    if (!name) return;
    try {
      await renameSession(renameKey, name);
      setRenameKey(null);
      discovery.refresh();
      refreshSidebar();
    } catch {
      // Preserve the current sidebar state when the action fails.
    }
  };

  const runDelete = async (key: string) => {
    try {
      await deleteSession(key);
      discovery.refresh();
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
          limit: 5000,
          offset: 0,
          updatedAfter: sidebarUpdatedAfter,
          includePinned: true,
          includeConversationId: activeConversationId,
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
          const ordered = orderSidebarItems(
            appended,
            pendingOrders[`project:${projectId}`] ?? data?.[0]?.layouts[`project:${projectId}`]?.itemIds,
            (session) => session.key,
          );
          return {
            ...prev,
            [projectId]: {
              sessions: ordered,
              sessionTotal: result.total,
              hasMore: false,
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
  }, [activeConversationId, data, expandedProjects, loadingProjectIds, pendingOrders, projectGroups, sidebarUpdatedAfter]);

  const toggleProjectCollapsed = useCallback((projectId: string) => {
    setCollapsedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  const loadMoreInbox = useCallback(() => {
    if (!inboxHasMore || loadingInboxMore) return;
    setLoadingInboxMore(true);
    void (async () => {
      try {
        const result = await listSessions({
          unassigned: true,
          limit: 5000,
          offset: 0,
          updatedAfter: sidebarUpdatedAfter,
          includePinned: true,
          includeConversationId: activeConversationId,
        });
        setInboxExtraItems((prev) => {
          const seen = new Set([...(firstInbox?.items ?? []), ...prev].map((session) => session.key));
          const next = [...prev];
          for (const session of result.items) {
            if (seen.has(session.key)) continue;
            seen.add(session.key);
            next.push(session);
          }
          return orderSidebarItems(
            next,
            pendingOrders.inbox ?? data?.[0]?.layouts.inbox?.itemIds,
            (session) => session.key,
          );
        });
        setInboxHasMoreOverride(false);
      } finally {
        setLoadingInboxMore(false);
      }
    })();
  }, [activeConversationId, data, firstInbox?.items, inboxHasMore, loadingInboxMore, pendingOrders.inbox, sidebarUpdatedAfter]);

  const createProjectChat = useCallback((project: Project) => {
    navigate(newChatHrefForProject(project.id), {
      state: { forceNewChat: true, agentId: project.defaultAgentId ?? defaultAgentId },
    });
    onNavigate?.();
  }, [defaultAgentId, navigate, onNavigate]);

  const submitCreateProject = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = createProjectName.trim();
    const workspaceRoot = createProjectWorkspace.trim();
    if (!name || !workspaceRoot || creatingProject) return;

    setCreatingProject(true);
    setCreateProjectError(null);
    try {
      const project = await createProject({ name, workspaceRoot, autoUnderstand });
      setCreateProjectName('');
      setCreateProjectWorkspace('');
      setAutoUnderstand(true);
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

  if (!token) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
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
    <SessionDescriptionContext value={discovery.filters.details}>
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listScrollRef}
        className="app-sidebar-nav-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain pt-3 pb-2"
        onScroll={onScroll}
      >
        <div hidden={discovery.active || loadingFirst} className="px-2">
          <SidebarPinnedSection
            sessions={pinnedSessions}
            activeConversationId={activeConversationId}
            onNavigate={onNavigate}
            mutate={refreshSidebar}
            onRequestRename={openRename}
            onRequestDelete={setDeleteKey}
            sb={sb}
            sess={sess}
            clipboard={m.clipboard}
            defaultUnnamedTitle={m.chat.newSession}
            onReorder={reorderSidebar}
          />
        </div>
        <div className="px-2">
          <div className="group flex min-w-0 items-center gap-1.5 px-2 pb-1">
            <button
              type="button"
              className={cn(
                'flex shrink-0 items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
                sidebarSectionButtonClass,
              )}
              onClick={() => setProjectsCollapsed((value) => !value)}
              aria-expanded={!projectsCollapsed}
            >
              {sb.projectsHeading}
              <ChevronDown
                className={cn(
                  'size-3.5 transition-transform duration-150 ease-out',
                  projectsCollapsed && '-rotate-90',
                )}
                strokeWidth={1.75}
                aria-hidden
              />
            </button>
            <SessionFilterToolbar
              filters={discovery.filters} onChange={discovery.updateFilters}
              search={discovery.search} onSearch={discovery.setSearch}
              labels={filterLabels} gateway={gateway} agents={chatAgents?.items ?? []}
            />
            <button
              type="button"
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-md text-fg-subtle opacity-0 transition-[color,background-color,opacity] hover:bg-surface-hover hover:text-fg focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                'group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100',
                createProjectOpen && 'opacity-100',
              )}
              onClick={() => setCreateProjectOpen(true)}
              aria-label={projectsText.createTitle}
              title={projectsText.createTitle}
            >
              <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
        {discovery.active ? (
          <div className="px-2 py-2">
            {discovery.pendingUpdate ? <button type="button" className="mb-2 w-full rounded-md px-2 py-1 text-xs text-accent-fg hover:bg-surface-hover" onClick={discovery.refresh}>{filterLabels.refresh}</button> : null}
            {discovery.error ? <div role="alert" className="space-y-2 p-2 text-xs text-fg-muted"><p>{filterLabels.error}</p><Button variant="secondary" onClick={discovery.refresh}>{filterLabels.retry}</Button></div>
              : discovery.loading ? <SidebarTaskListSkeleton />
              : <>
                <p className="px-2 pb-2 text-xs text-fg-muted" aria-live="polite">{filterLabels.results.replace('{{count}}', String(discovery.total))}</p>
                {!discovery.items.length ? <p className="px-2 py-4 text-xs text-fg-muted">{filterLabels.empty}</p> : null}
                <SessionDescriptionContext value={true}>
                  {discovery.items.map((session) => <SidebarTaskRow
                    key={session.key} session={session} isActive={session.key === activeConversationId}
                    contextLabel={session.projectId ? discovery.projects?.find((project) => project.id === session.projectId)?.name ?? projectGroups.find((group) => group.project.id === session.projectId)?.project.name ?? session.projectId : filterLabels.unassigned}
                    onNavigate={onNavigate} mutate={() => { discovery.refresh(); refreshSidebar(); }}
                    onRequestRename={openRename} onRequestDelete={setDeleteKey}
                    sb={sb} sess={sess} clipboard={m.clipboard} defaultUnnamedTitle={m.chat.newSession}
                  />)}
                </SessionDescriptionContext>
                {discovery.loadingMore ? <SidebarSessionSkeletonRow /> : discovery.hasMore ? <button type="button" className="w-full rounded-md py-2 text-xs text-fg-muted hover:bg-surface-hover" onClick={discovery.loadMore}>{filterLabels.more}</button> : null}
              </>}
          </div>
        ) : null}
        <div hidden={discovery.active}>
          {loadingFirst ? (
            <SidebarTaskListSkeleton />
          ) : hasGroupedItems ? (
            <div className="flex flex-col px-2">
              {projectGroups.length > 0 ? (
                <div className="pb-1">
                  {!projectsCollapsed
                    ? projectGroups.map((group) => (
                        <SidebarProjectSection
                          key={group.project.id}
                          group={group}
                          isExpanded={expandedProjects.has(group.project.id)}
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
                          mutate={refreshSidebar}
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
                      ))
                    : null}
                </div>
              ) : null}

              <SidebarInboxSection
                sessions={inboxItems.filter((session) => resolveSessionIdentity(session).source !== 'system')}
                hasMore={inboxHasMore}
                loadingMore={loadingInboxMore}
                isCollapsed={inboxCollapsed}
                onToggleCollapsed={() => setInboxCollapsed((value) => !value)}
                onCreateChat={() => {
                  navigate('/chat/new?projectScope=none', { state: { forceNewChat: true } });
                  onNavigate?.();
                }}
                onLoadMore={loadMoreInbox}
                activeConversationId={activeConversationId}
                onNavigate={onNavigate}
                mutate={refreshSidebar}
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
                <summary className="cursor-pointer px-2 py-2 text-xs text-fg-muted">{language === 'zh' ? '系统活动' : 'System activity'}</summary>
              <SidebarInboxSection
                sessions={inboxItems.filter((session) => resolveSessionIdentity(session).source === 'system')}
                hasMore={false}
                loadingMore={loadingInboxMore}
                isCollapsed={false}
                onToggleCollapsed={() => undefined}
                onCreateChat={() => {
                  navigate('/chat/new?projectScope=none', { state: { forceNewChat: true } });
                  onNavigate?.();
                }}
                onLoadMore={loadMoreInbox}
                activeConversationId={activeConversationId}
                onNavigate={onNavigate}
                mutate={refreshSidebar}
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
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
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
                  <p className="text-xs font-normal text-fg-subtle">{projectsText.workspaceSelectionHint}</p>
                </div>
                <ProjectUnderstandingCheckbox checked={autoUnderstand} onChange={setAutoUnderstand} disabled={creatingProject} />
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
                  disabled={creatingProject || !createProjectName.trim() || !createProjectWorkspace.trim()}
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

      <Dialog.Root open={renameKey !== null} onOpenChange={(o) => !o && setRenameKey(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[60] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-overlay p-4 shadow-popover dark:border-edge">
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
              placeholder={m.chat.newSession}
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
    </SessionDescriptionContext>
  );
}
