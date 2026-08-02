import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { AlertCircle, Archive, ArrowLeft, Check, ChevronDown, Clock, Copy, File, Folder, FolderPlus, History, LayoutDashboard, ListChecks, MessageSquarePlus, Pause, Pin, PinOff, Play, Plus, RotateCcw, Save, Search, Settings, Square, Target, Trash2, X, Zap, type LucideIcon } from 'lucide-react';
import { type CSSProperties, type FormEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { PageTabs } from '@/components/ui/page-tabs';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { RefreshButton } from '@/components/ui/refresh-button';
import { Skeleton } from '@/components/ui/skeleton';
import { automationApi, type Automation, type AutomationRun } from '@/features/automations/automation-api';
import { inferMimeTypeFromFileName } from '@/features/chat/attachments/attachment-utils-core';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { fetchConfiguredModelsCached } from '@/features/chat/api/registry-api';
import { FileTree } from '@/features/file-tree/file-tree';
import type { FileTreeAction, TreeEntry } from '@/features/file-tree/file-tree-types';
import { DirectoryPickerPathField } from '@/features/fs/directory-picker-path-field';
import { fetchGatewayConfigSwrResponse } from '@/features/gateway/gateway-config-swr';
import { normalizeChecklist } from '@/features/goals/goal-create-draft';
import { GoalCreateDialog, type CreateGoalDraft, type GoalCreateOptions } from '@/features/goals/goal-create-dialog';
import { NotesWorkbench } from '@/features/notes/notes-workbench';
import {
  archiveProject,
  createProjectBlocker,
  createProjectSession,
  createProjectGoal,
  createProject,
  deleteProject,
  fetchProjectActivity,
  fetchProjectFiles,
  fetchProjectGoals,
  fetchProjectOverview,
  fetchProjects,
  fetchProjectSessions,
  saveProjectDigest,
  searchProjectFiles,
  pinProject,
  restoreProject,
  unpinProject,
  updateProject,
  type Project,
  type ProjectActivityEvent,
  type ProjectFileEntry,
  type ProjectFileSearchEntry,
  type ProjectGoal,
  type ProjectOverview,
  type ProjectSession,
  type ProjectStatus,
  type ProjectWithDetails,
} from '@/features/projects/api';
import { fetchGatewayAgents, type GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { normalizeGoalsConfigFromConfig } from '@/features/settings/goals-config-api';
import {
  cancelWorkflowRun,
  listWorkflowDefinitions,
  listWorkflowRuns,
  retryWorkflowRun,
  type WorkflowDefinition,
  type WorkflowRunSummary,
} from '@/features/workflows/workflow-api';
import { workflowBoardHref } from '@/features/workflows/workflow-page.utils';
import { WorkItemsPanel } from '@/features/work-items/work-items-panel';
import { detectPreviewFileType, getPreviewFileName, readModeForPreviewType } from '@/features/preview-runtime';
import {
  downloadBinaryFile,
  downloadTextFile,
  fetchWorkspaceFileBlob,
  readWorkspaceFile,
} from '@/features/workspace/workspace-api';
import { WorkspaceFilePreviewPanel } from '@/features/workspace/workspace-file-preview-dialog';
import { WorkspaceOpenLocationMenu } from '@/features/workspace/workspace-open-location-menu';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

type WorkTabId = 'work-items' | 'goals' | 'workflows' | 'automations';
type PrimaryTabId = 'overview' | 'work' | 'files' | 'notes' | 'sessions' | 'activity' | 'settings';
type TabId = Exclude<PrimaryTabId, 'work'> | WorkTabId;

const TABS: Array<{ id: TabId; icon: LucideIcon }> = [
  { id: 'overview', icon: LayoutDashboard },
  { id: 'work-items', icon: ListChecks },
  { id: 'sessions', icon: MessageSquarePlus },
  { id: 'goals', icon: Target },
  { id: 'workflows', icon: Play },
  { id: 'files', icon: Folder },
  { id: 'activity', icon: History },
  { id: 'automations', icon: Zap },
  { id: 'notes', icon: File },
  { id: 'settings', icon: Settings },
];

const WORK_TAB_IDS = new Set<WorkTabId>(['work-items', 'goals', 'workflows', 'automations']);

const PROJECT_TAB_IDS = new Set<TabId>(TABS.map((tab) => tab.id));
const PROJECT_FILES_PANEL_WIDTH_STORAGE_KEY = 'xopc.projectFiles.panelWidthPx';
const PROJECT_FILES_PANEL_WIDTH_DEFAULT = 320;
const PROJECT_FILES_PANEL_WIDTH_MIN = 220;
const PROJECT_FILES_PANEL_WIDTH_MAX = 560;
type WorkspaceMigrationMode = 'follow' | 'fixed';

function clampProjectFilesPanelWidth(px: number): number {
  return Math.min(PROJECT_FILES_PANEL_WIDTH_MAX, Math.max(PROJECT_FILES_PANEL_WIDTH_MIN, Math.round(px)));
}

function readProjectFilesPanelWidth(): number {
  try {
    const raw = window.localStorage.getItem(PROJECT_FILES_PANEL_WIDTH_STORAGE_KEY);
    if (raw == null) return PROJECT_FILES_PANEL_WIDTH_DEFAULT;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? clampProjectFilesPanelWidth(parsed) : PROJECT_FILES_PANEL_WIDTH_DEFAULT;
  } catch {
    return PROJECT_FILES_PANEL_WIDTH_DEFAULT;
  }
}

function writeProjectFilesPanelWidth(px: number): void {
  try {
    window.localStorage.setItem(PROJECT_FILES_PANEL_WIDTH_STORAGE_KEY, String(clampProjectFilesPanelWidth(px)));
  } catch {
    /* ignore storage failures */
  }
}

function isProjectTabId(value: string | undefined): value is TabId {
  return Boolean(value && PROJECT_TAB_IDS.has(value as TabId));
}

function isWorkTab(tab: TabId): tab is WorkTabId {
  return WORK_TAB_IDS.has(tab as WorkTabId);
}

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''));
}

function formatDate(value?: string | number, fallback = ''): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return formatMediumDateTime(date);
}

function statusTone(status: string): string {
  if (status === 'active') return 'bg-accent-soft text-accent-fg';
  if (status === 'done') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'paused') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'archived') return 'bg-surface-muted text-fg-subtle';
  return 'bg-surface-hover text-fg-muted';
}

function workflowStatusTone(status: string): string {
  if (status === 'succeeded') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed' || status === 'timeout' || status === 'cancelled') return 'bg-red-500/10 text-red-700 dark:text-red-300';
  if (status === 'running' || status === 'queued') return 'bg-accent-soft text-accent-fg';
  return 'bg-surface-hover text-fg-muted';
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium text-fg-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-5 text-fg-subtle">{hint}</span> : null}
    </label>
  );
}

function inputClass(multiline = false): string {
  return cn(
    'w-full rounded-md border border-edge bg-surface-base px-3 text-sm text-fg outline-none focus:border-accent',
    multiline ? 'min-h-24 py-2 leading-5' : 'min-h-10',
  );
}

function SettingsMetaItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-md bg-surface-base px-3 py-2">
      <div className="text-xs font-medium text-fg-subtle">{label}</div>
      <div className={cn('mt-1 min-w-0 truncate text-sm text-fg', mono && 'font-mono text-xs')} title={value}>
        {value}
      </div>
    </div>
  );
}

function projectSearchText(project: Project): string {
  return [
    project.name,
    project.slug,
    project.workspaceRoot,
    project.description,
    project.brief,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function projectRecentTime(project: Project): number {
  const raw = project.lastActiveAt ?? project.updatedAt ?? project.createdAt;
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function directoryName(path: string): string {
  return path.trim().replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() ?? '';
}

function getMissingWorkspaceRoot(err: unknown): string | null {
  const body = (err as { body?: { code?: string; workspaceRoot?: string } } | null)?.body;
  return body?.code === 'workspace_root_missing' && body.workspaceRoot ? body.workspaceRoot : null;
}

function activityActorLabel(activity: ProjectActivityEvent): string {
  const actor = activity.actor;
  if (actor.name) return actor.name;
  if (actor.agentId) return actor.agentId;
  if (actor.id) return actor.id;
  if (actor.sessionKey) return actor.sessionKey;
  return actor.kind;
}

function activityObjectLabel(activity: ProjectActivityEvent): string {
  return activity.primaryObject.title?.trim() || activity.primaryObject.id;
}

function activitySourceLabel(activity: ProjectActivityEvent): string {
  const source = activity.source;
  if (source.toolCallId) return `${source.kind} · ${source.toolCallId}`;
  if (source.runId) return `${source.kind} · ${source.runId}`;
  if (source.requestId) return `${source.kind} · ${source.requestId}`;
  return source.kind;
}

function projectSessionSource(session: ProjectSession): string {
  const explicit = session.sourceChannel?.trim();
  if (explicit) return formatProjectSessionSource(explicit);

  const parts = session.key.split(':').filter(Boolean);
  const rest = parts[0]?.toLowerCase() === 'agent' ? parts.slice(2).join(':') : session.key;
  const candidate = rest.split(':')[0]?.split(/[-_]/)[0]?.trim();
  return formatProjectSessionSource(candidate || '');
}

function formatProjectSessionSource(source: string): string {
  const normalized = source.trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'tui') return 'TUI';
  if (normalized === 'acp') return 'ACP';
  if (normalized === 'webchat') return 'Webchat';
  return normalized;
}

function activityPayloadPreview(activity: ProjectActivityEvent): string {
  const changes = activity.payload.changes;
  if (Array.isArray(changes) && changes.length) {
    return changes.filter((value): value is string => typeof value === 'string').join(', ');
  }
  const contentPreview = activity.payload.contentPreview;
  if (typeof contentPreview === 'string' && contentPreview.trim()) return contentPreview.trim();
  const title = activity.payload.title ?? activity.payload.name;
  if (typeof title === 'string' && title.trim()) return title.trim();
  return '';
}

function projectFileEntriesToTreeEntries(entries: ProjectFileEntry[]): TreeEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    absolutePath: entry.absolutePath,
    isDirectory: entry.type === 'directory',
    children: entry.type === 'directory' ? [] : undefined,
  }));
}

function mergeProjectFileChildren(
  tree: TreeEntry[],
  targetPath: string,
  children: TreeEntry[],
): TreeEntry[] {
  return tree.map((entry) => {
    if (entry.path === targetPath) {
      return { ...entry, children };
    }
    if (entry.isDirectory && entry.children?.length) {
      return { ...entry, children: mergeProjectFileChildren(entry.children, targetPath, children) };
    }
    return entry;
  });
}

function ProjectSwitcher({
  currentProject,
  pm,
  projectsText,
  wd,
}: {
  currentProject: ProjectWithDetails;
  pm: ReturnType<typeof messages>['projectDetailPage'];
  projectsText: ReturnType<typeof messages>['projectsPage'];
  wd: ReturnType<typeof messages>['chat']['workingDirectory'];
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([currentProject]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<'new' | 'directory'>('new');
  const [name, setName] = useState('');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [missingWorkspaceRoot, setMissingWorkspaceRoot] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchProjects({ limit: 100 });
      setProjects((items) => {
        const byId = new Map<string, Project>();
        byId.set(currentProject.id, currentProject);
        for (const item of items) byId.set(item.id, item);
        for (const item of res.items) byId.set(item.id, item);
        return Array.from(byId.values());
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [currentProject]);

  useEffect(() => {
    setProjects((items) => {
      const rest = items.filter((item) => item.id !== currentProject.id);
      return [currentProject, ...rest];
    });
  }, [currentProject]);

  useEffect(() => {
    if (!open) return;
    void loadProjects();
  }, [loadProjects, open]);

  const filteredProjects = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return projects
      .filter((project) => project.id !== currentProject.id)
      .filter((project) => {
        if (tokens.length === 0) return true;
        const haystack = projectSearchText(project);
        return tokens.every((token) => haystack.includes(token));
      })
      .sort((a, b) => projectRecentTime(b) - projectRecentTime(a));
  }, [currentProject.id, projects, query]);

  const statusLabel = (project: Project) => pm.statuses[project.status] ?? project.status;
  const subtitle = (project: Project) =>
    project.workspaceRoot || project.effectiveWorkspaceRoot || project.description || project.brief || pm.common.defaultWorkspace;

  const openCreateDialog = (mode: 'new' | 'directory') => {
    setCreateMode(mode);
    setName('');
    setWorkspaceRoot('');
    setCreateError(null);
    setCreateOpen(true);
    setOpen(false);
  };

  const submitCreate = useCallback(async (options: { createWorkspaceRoot?: boolean } = {}) => {
    const trimmedWorkspace = workspaceRoot.trim();
    const trimmedName = name.trim() || (createMode === 'directory' ? directoryName(trimmedWorkspace) : '');
    if (!trimmedName) return;
    setCreating(true);
    setCreateError(null);
    setMissingWorkspaceRoot(null);
    try {
      const project = await createProject({
        name: trimmedName,
        ...(trimmedWorkspace ? { workspaceRoot: trimmedWorkspace } : {}),
        ...(options.createWorkspaceRoot ? { createWorkspaceRoot: true } : {}),
      });
      setCreateOpen(false);
      setName('');
      setWorkspaceRoot('');
      setProjects((items) => [project, ...items.filter((item) => item.id !== project.id)]);
      navigate(`/projects/${encodeURIComponent(project.id)}`);
    } catch (err) {
      const missingRoot = getMissingWorkspaceRoot(err);
      if (missingRoot) {
        setMissingWorkspaceRoot(missingRoot);
        setCreateOpen(false);
      } else {
        setCreateError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setCreating(false);
    }
  }, [createMode, name, navigate, workspaceRoot]);

  const onCreate = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitCreate();
  }, [submitCreate]);

  const createMissingWorkspaceAndProject = useCallback(() => {
    void submitCreate({ createWorkspaceRoot: true });
  }, [submitCreate]);

  const returnToCreateFromMissingWorkspace = useCallback(() => {
    setMissingWorkspaceRoot(null);
    setCreateOpen(true);
  }, []);

  const onWorkspaceChange = (next: string) => {
    setWorkspaceRoot(next);
    if (createMode === 'directory' && !name.trim()) {
      setName(directoryName(next));
    }
  };

  const projectRow = (project: Project, current: boolean) => (
    <button
      key={project.id}
      type="button"
      className={cn(
        'grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md p-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        current && 'bg-accent-soft/55 hover:bg-accent-soft/70',
      )}
      onClick={() => {
        setOpen(false);
        if (!current) navigate(`/projects/${encodeURIComponent(project.id)}`);
      }}
    >
      <Check className={cn('size-4 text-accent-fg', !current && 'invisible')} aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-fg">{project.name}</span>
        <span className="block truncate text-xs text-fg-muted">{subtitle(project)}</span>
      </span>
      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', statusTone(project.status))}>
        {statusLabel(project)}
      </span>
    </button>
  );

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="group flex max-w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label={pm.projectSwitcher.switchProject}
            title={pm.projectSwitcher.switchProject}
          >
            <span className="min-w-0">
              <span className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-base font-semibold tracking-tight text-fg">{currentProject.name}</h1>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', statusTone(currentProject.status))}>
                  {statusLabel(currentProject)}
                </span>
              </span>
              <span className="block truncate text-xs text-fg-muted">{subtitle(currentProject)}</span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-fg-subtle transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={6}
            className="z-[70] w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-edge bg-surface-panel p-1.5 shadow-popover outline-none"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
              <input
                type="search"
                className="h-9 w-full rounded-lg border border-edge bg-surface-base pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={pm.projectSwitcher.searchPlaceholder}
                aria-label={pm.projectSwitcher.searchPlaceholder}
              />
            </label>

            <div className="mt-1 max-h-[min(54vh,24rem)] overflow-y-auto pr-0.5 [scrollbar-gutter:stable]">
              <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                {pm.projectSwitcher.current}
              </div>
              {projectRow(currentProject, true)}

              <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                {pm.projectSwitcher.recent}
              </div>
              {loadError ? (
                <div className="p-2 text-xs text-red-600 dark:text-red-400">{loadError}</div>
              ) : null}
              {loading && filteredProjects.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-fg-muted">{pm.projectSwitcher.loading}</div>
              ) : null}
              {!loading && filteredProjects.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-fg-muted">{pm.projectSwitcher.noMatches}</div>
              ) : null}
              {filteredProjects.map((project) => projectRow(project, false))}
            </div>

            <div className="mt-1 border-t border-edge-subtle pt-1">
              <button
                type="button"
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg hover:bg-surface-hover"
                onClick={() => openCreateDialog('new')}
              >
                <Plus className="size-4 text-fg-muted" aria-hidden />
                <span className="min-w-0 truncate">{pm.projectSwitcher.newProject}</span>
              </button>
              <button
                type="button"
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg hover:bg-surface-hover"
                onClick={() => openCreateDialog('directory')}
              >
                <Folder className="size-4 text-fg-muted" aria-hidden />
                <span className="min-w-0 truncate">{pm.projectSwitcher.openDirectory}</span>
              </button>
              <button
                type="button"
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg hover:bg-surface-hover"
                onClick={() => {
                  setOpen(false);
                  navigate('/projects');
                }}
              >
                <Settings className="size-4 text-fg-muted" aria-hidden />
                <span className="min-w-0 truncate">{pm.projectSwitcher.manageProjects}</span>
              </button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <Dialog.Root open={createOpen} onOpenChange={(next) => !creating && setCreateOpen(next)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(32rem,calc(100vh-2rem))] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="shrink-0 border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">
                {createMode === 'directory' ? pm.projectSwitcher.createFromDirectoryTitle : projectsText.createTitle}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">
                {createMode === 'directory' ? pm.projectSwitcher.createFromDirectoryDescription : projectsText.createDescription}
              </Dialog.Description>
            </div>
            <form onSubmit={onCreate} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                {createError ? (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                    {createError}
                  </div>
                ) : null}
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-fg-muted">{projectsText.projectName}</span>
                  <input
                    className="min-h-10 rounded-md border border-edge bg-surface-base px-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="xopc"
                  />
                </label>
                <div className="grid gap-1.5 text-sm">
                  <span className="font-medium text-fg-muted">{projectsText.workspaceRoot}</span>
                  <DirectoryPickerPathField
                    value={workspaceRoot}
                    onChange={onWorkspaceChange}
                    disabled={creating}
                    wd={wd}
                    placeholder={projectsText.workspacePlaceholder}
                    inputClassName="min-h-10 rounded-md border border-edge bg-surface-base px-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent"
                  />
                  <p className="text-xs text-fg-subtle">{projectsText.workspaceHint}</p>
                </div>
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-4">
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" className="rounded-lg" disabled={creating}>
                    {projectsText.cancel}
                  </Button>
                </Dialog.Close>
                <Button
                  type="submit"
                  variant="primary"
                  className="rounded-lg"
                  disabled={creating || !(name.trim() || (createMode === 'directory' && directoryName(workspaceRoot)))}
                >
                  <Plus className="size-4" aria-hidden />
                  {projectsText.create}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(missingWorkspaceRoot)} onOpenChange={(next) => {
        if (!next) setMissingWorkspaceRoot(null);
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[110] flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">{projectsText.workspaceMissingTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">
                {missingWorkspaceRoot
                  ? interpolate(projectsText.workspaceMissingDescription, { workspace: missingWorkspaceRoot })
                  : null}
              </Dialog.Description>
            </div>
            {missingWorkspaceRoot ? (
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg-muted">
                  <Folder className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                  <span className="min-w-0 truncate">{missingWorkspaceRoot}</span>
                </div>
              </div>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-edge px-5 py-4">
              <Button type="button" variant="ghost" className="rounded-lg" onClick={returnToCreateFromMissingWorkspace} disabled={creating}>
                {projectsText.workspaceMissingBack}
              </Button>
              <Button type="button" variant="primary" className="rounded-lg" onClick={createMissingWorkspaceAndProject} disabled={creating}>
                <FolderPlus className="size-4" aria-hidden />
                {projectsText.workspaceMissingCreate}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

export function ProjectDetailPage() {
  const { projectId = '', tabId, noteId } = useParams();
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const msg = messages(language);
  const wd = msg.chat.workingDirectory;
  const pm = msg.projectDetailPage;
  const projectsText = msg.projectsPage;
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const [project, setProject] = useState<ProjectWithDetails | null>(null);
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [goals, setGoals] = useState<ProjectGoal[]>([]);
  const [workflowDefinitions, setWorkflowDefinitions] = useState<WorkflowDefinition[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunSummary[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [automationRuns, setAutomationRuns] = useState<AutomationRun[]>([]);
  const [automationsLoading, setAutomationsLoading] = useState(false);
  const [automationActionBusy, setAutomationActionBusy] = useState<string | null>(null);
  const [projectActivity, setProjectActivity] = useState<ProjectActivityEvent[]>([]);
  const [projectActivityTotal, setProjectActivityTotal] = useState(0);
  const [projectActivityLoading, setProjectActivityLoading] = useState(false);
  const [projectActivityIncludeRelated, setProjectActivityIncludeRelated] = useState(false);
  const [savingDigest, setSavingDigest] = useState(false);
  const [projectFileTree, setProjectFileTree] = useState<TreeEntry[]>([]);
  const loadedProjectFileDirsRef = useRef<Set<string>>(new Set());
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);
  const [projectFilesPanelWidth, setProjectFilesPanelWidth] = useState(readProjectFilesPanelWidth);
  const [projectFilesPanelResizing, setProjectFilesPanelResizing] = useState(false);
  const [projectFileSearchOpen, setProjectFileSearchOpen] = useState(false);
  const [projectFileSearchQuery, setProjectFileSearchQuery] = useState('');
  const [projectFileSearchResults, setProjectFileSearchResults] = useState<ProjectFileSearchEntry[]>([]);
  const [projectFileSearchLoading, setProjectFileSearchLoading] = useState(false);
  const [projectFileSearchError, setProjectFileSearchError] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [agents, setAgents] = useState<GatewayAgentRow[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [missingWorkspaceRoot, setMissingWorkspaceRoot] = useState<string | null>(null);
  const [workspaceMigrationOpen, setWorkspaceMigrationOpen] = useState(false);
  const [workspaceMigrationMode, setWorkspaceMigrationMode] = useState<WorkspaceMigrationMode>('fixed');
  const [workspaceMigrationRoot, setWorkspaceMigrationRoot] = useState('');
  const [projectActionBusy, setProjectActionBusy] = useState<'pin' | 'archive' | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const [createWorkItemRequestKey, setCreateWorkItemRequestKey] = useState(0);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [workflowActionBusy, setWorkflowActionBusy] = useState<string | null>(null);
  const [creatingGoal, setCreatingGoal] = useState(false);
  const [creatingBlocker, setCreatingBlocker] = useState(false);
  const [createGoalOpen, setCreateGoalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createGoalOptions, setCreateGoalOptions] = useState<GoalCreateOptions>({
    defaultAgentId: '',
    agents: [],
    models: [],
    checklistDecomposePolicy: 'empty_only',
  });
  const [blockerDraft, setBlockerDraft] = useState({ title: '', reason: '' });
  const [draft, setDraft] = useState({
    name: '',
    description: '',
    status: 'active' as ProjectStatus,
    defaultAgentId: '',
    workspaceRoot: '',
    brief: '',
    instructions: '',
  });
  const defaultTab: TabId = 'overview';
  const tab = noteId ? 'notes' : isProjectTabId(tabId) ? tabId : defaultTab;

  const navigateProjectTab = useCallback((nextTab: TabId) => {
    if (!projectId) return;
    navigate(`/projects/${encodeURIComponent(projectId)}/${nextTab}`);
  }, [navigate, projectId]);

  const projectTabHref = useCallback((nextTab: TabId) => {
    if (!projectId) return '/projects';
    return `/projects/${encodeURIComponent(projectId)}/${nextTab}`;
  }, [projectId]);

  const projectGoalHref = useCallback((goalId: string) => {
    const returnTo = projectTabHref('goals');
    return `/goals/${encodeURIComponent(goalId)}?returnTo=${encodeURIComponent(returnTo)}`;
  }, [projectTabHref]);

  const replaceProjectHistoryTab = useCallback((nextTab: TabId) => {
    if (!projectId) return;
    navigate(projectTabHref(nextTab), { replace: true });
  }, [navigate, projectId, projectTabHref]);

  const navigateFromProjectTab = useCallback((nextTab: TabId, target: string) => {
    replaceProjectHistoryTab(nextTab);
    navigate(target);
  }, [navigate, replaceProjectHistoryTab]);

  const onProjectTabLinkClick = useCallback((nextTab: TabId) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    replaceProjectHistoryTab(nextTab);
  }, [replaceProjectHistoryTab]);

  const projectTabForHref = useCallback((href: string): TabId => {
    if (href.startsWith('/goals/')) return 'goals';
    if (href.startsWith('/chat/')) return 'sessions';
    if (href.startsWith('/workflows')) return 'workflows';
    if (href.startsWith('/automations')) return 'automations';
    if (href.startsWith('/notes')) return 'notes';
    return tab;
  }, [tab]);

  useEffect(() => {
    if (!projectId || !tabId || isProjectTabId(tabId)) return;
    navigate(`/projects/${encodeURIComponent(projectId)}/${defaultTab}`, { replace: true });
  }, [defaultTab, navigate, projectId, tabId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      fetchProjectOverview(projectId),
      fetchProjectSessions(projectId),
      fetchProjectGoals(projectId),
      fetchGatewayAgents().catch(() => null),
    ])
      .then(([overviewResult, sessionResult, goalResult, agentPayload]) => {
        if (cancelled) return;
        const projectResult = overviewResult.project;
        setProject(projectResult);
        setOverview(overviewResult);
        setSessions(sessionResult);
        setGoals(goalResult);
        const nextAgents = agentPayload?.agents ?? [];
        setAgents(nextAgents);
        setSelectedAgentId(projectResult.defaultAgentId ?? '');
        setDraft({
          name: projectResult.name,
          description: projectResult.description ?? '',
          status: projectResult.status,
          defaultAgentId: projectResult.defaultAgentId ?? '',
          workspaceRoot: projectResult.workspaceRoot ?? '',
          brief: projectResult.brief ?? '',
          instructions: projectResult.instructions ?? '',
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    async function loadGoalCreateOptions() {
      const [agentsResult, modelsResult, configResult] = await Promise.allSettled([
        fetchGatewayAgents(),
        fetchConfiguredModelsCached(),
        fetchGatewayConfigSwrResponse(),
      ]);
      if (cancelled) return;
      setCreateGoalOptions((prev) => {
        const globalDefaultAgentId = agentsResult.status === 'fulfilled' ? agentsResult.value.defaultId : prev.defaultAgentId;
        const defaultAgentId = project?.defaultAgentId || selectedAgentId || globalDefaultAgentId;
        const nextAgents = agentsResult.status === 'fulfilled' ? agentsResult.value.agents : prev.agents;
        const models = modelsResult.status === 'fulfilled' ? modelsResult.value : prev.models;
        const checklistDecomposePolicy = configResult.status === 'fulfilled'
          ? normalizeGoalsConfigFromConfig(configResult.value.payload?.config).checklistDecomposePolicy
          : prev.checklistDecomposePolicy;
        return {
          defaultAgentId,
          agents: nextAgents.length ? nextAgents : [{
            id: defaultAgentId || 'main',
            workspace: '',
            profileDir: '',
            typedModels: { defaultRole: 'deep', preset: [], effective: [] },
            extends: [],
            isDefault: true,
            skills: { preset: [] },
            tools: { presetDenied: [], entryDisable: [], effectiveDisable: [] },
          }],
          models,
          checklistDecomposePolicy,
        };
      });
    }
    void loadGoalCreateOptions();
    return () => {
      cancelled = true;
    };
  }, [project?.defaultAgentId, selectedAgentId]);

  const refreshProjectWorkflows = useCallback(async () => {
    if (!project) return;
    setWorkflowsLoading(true);
    setError(null);
    try {
      const [definitionsResult, runsResult] = await Promise.all([
        listWorkflowDefinitions(),
        listWorkflowRuns(100, {
          ownerAgentId: selectedAgentId || undefined,
          projectId: project.id,
        }),
      ]);
      setWorkflowDefinitions(definitionsResult);
      setWorkflowRuns(runsResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkflowsLoading(false);
    }
  }, [project, selectedAgentId]);

  useEffect(() => {
    if (!project) return;
    void refreshProjectWorkflows();
  }, [project, refreshProjectWorkflows]);

  const refreshProjectAutomations = useCallback(async () => {
    if (!project) return;
    setAutomationsLoading(true);
    setError(null);
    try {
      const [automationResult, runResult] = await Promise.all([
        automationApi.list({ projectId: project.id }),
        automationApi.runs(50, undefined, { projectId: project.id }),
      ]);
      setAutomations(automationResult.automations);
      setAutomationRuns(runResult.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutomationsLoading(false);
    }
  }, [project]);

  useEffect(() => {
    if (tab !== 'automations') return;
    void refreshProjectAutomations();
  }, [refreshProjectAutomations, tab]);

  const refreshProjectActivity = useCallback(async () => {
    if (!project) return;
    setProjectActivityLoading(true);
    setError(null);
    try {
      const result = await fetchProjectActivity(project.id, {
        includeRelated: projectActivityIncludeRelated,
        limit: 100,
      });
      setProjectActivity(result.items);
      setProjectActivityTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProjectActivityLoading(false);
    }
  }, [project, projectActivityIncludeRelated]);

  useEffect(() => {
    if (tab !== 'activity') return;
    void refreshProjectActivity();
  }, [refreshProjectActivity, tab]);

  const runAutomation = useCallback(async (automation: Automation) => {
    setAutomationActionBusy(`run:${automation.id}`);
    setError(null);
    try {
      await automationApi.runNow(automation.id);
      await refreshProjectAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutomationActionBusy(null);
    }
  }, [refreshProjectAutomations]);

  const toggleAutomation = useCallback(async (automation: Automation) => {
    setAutomationActionBusy(`toggle:${automation.id}`);
    setError(null);
    try {
      if (automation.enabled) {
        await automationApi.pause(automation.id);
      } else {
        await automationApi.resume(automation.id);
      }
      await refreshProjectAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutomationActionBusy(null);
    }
  }, [refreshProjectAutomations]);

  const refreshProjectFiles = useCallback(async () => {
    if (!project?.effectiveWorkspaceRoot?.trim()) {
      setProjectFileTree([]);
      loadedProjectFileDirsRef.current.clear();
      setFilesError(null);
      return;
    }
    setFilesLoading(true);
    setFilesError(null);
    loadedProjectFileDirsRef.current.clear();
    try {
      const result = await fetchProjectFiles(project.id, '');
      setProjectFileTree(projectFileEntriesToTreeEntries(result.entries));
      loadedProjectFileDirsRef.current.add('');
    } catch (err) {
      setProjectFileTree([]);
      loadedProjectFileDirsRef.current.clear();
      setFilesError(err instanceof Error ? err.message : String(err));
    } finally {
      setFilesLoading(false);
    }
  }, [project]);

  const loadProjectFileChildren = useCallback(
    async (dirPath: string) => {
      if (!project?.effectiveWorkspaceRoot?.trim() || loadedProjectFileDirsRef.current.has(dirPath)) return;
      loadedProjectFileDirsRef.current.add(dirPath);
      setFilesError(null);
      try {
        const result = await fetchProjectFiles(project.id, dirPath);
        setProjectFileTree((current) =>
          mergeProjectFileChildren(current, dirPath, projectFileEntriesToTreeEntries(result.entries)),
        );
      } catch (err) {
        loadedProjectFileDirsRef.current.delete(dirPath);
        setFilesError(err instanceof Error ? err.message : String(err));
      }
    },
    [project],
  );

  useEffect(() => {
    if (tab !== 'files') return;
    void refreshProjectFiles();
  }, [refreshProjectFiles, tab]);

  const normalizedProjectFileSearchQuery = projectFileSearchQuery.trim();

  useEffect(() => {
    if (tab !== 'files' || !project || !projectFileSearchOpen || !normalizedProjectFileSearchQuery) {
      setProjectFileSearchResults([]);
      setProjectFileSearchLoading(false);
      setProjectFileSearchError(null);
      return;
    }
    let cancelled = false;
    setProjectFileSearchLoading(true);
    setProjectFileSearchError(null);
    setProjectFileSearchResults([]);
    const timer = window.setTimeout(() => {
      void searchProjectFiles(project.id, normalizedProjectFileSearchQuery, 50)
        .then((entries) => {
          if (!cancelled) setProjectFileSearchResults(entries);
        })
        .catch((err) => {
          if (!cancelled) setProjectFileSearchError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setProjectFileSearchLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [normalizedProjectFileSearchQuery, project, projectFileSearchOpen, tab]);

  const startChat = useCallback(async () => {
    if (!project) return;
    setStartingChat(true);
    setError(null);
    try {
      const session = await createProjectSession(project.id);
      navigateFromProjectTab('sessions', `/chat/${encodeURIComponent(session.key)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStartingChat(false);
    }
  }, [navigateFromProjectTab, project]);

  const openCreateWorkItem = useCallback(() => {
    navigateProjectTab('work-items');
    setCreateWorkItemRequestKey((value) => value + 1);
  }, [navigateProjectTab]);

  const refreshProjectGoals = useCallback(async () => {
    if (!project) return;
    const [nextOverview, nextGoals] = await Promise.all([
      fetchProjectOverview(project.id),
      fetchProjectGoals(project.id),
    ]);
    setOverview(nextOverview);
    setProject(nextOverview.project);
    setGoals(nextGoals);
  }, [project]);

  const submitGoal = useCallback(async (goalDraft: CreateGoalDraft) => {
    if (!project || !goalDraft.title.trim()) return;
    const maxTurns = Number.parseInt(goalDraft.maxTurns, 10);
    const deadlineAt = goalDraft.deadline ? new Date(goalDraft.deadline).getTime() : undefined;
    setCreatingGoal(true);
    setError(null);
    try {
      await createProjectGoal(project.id, {
        title: goalDraft.title.trim(),
        description: goalDraft.description.trim() || undefined,
        attachments: goalDraft.attachments.length ? goalDraft.attachments : undefined,
        priority: goalDraft.priority,
        deadlineAt: Number.isFinite(deadlineAt) ? deadlineAt : undefined,
        maxTurns: Number.isFinite(maxTurns) ? maxTurns : undefined,
        agentId: goalDraft.agentId.trim() || undefined,
        judgeModelRef: goalDraft.judgeModelRef.trim() || undefined,
        contract: {
          objective: goalDraft.objective.trim() || goalDraft.title.trim(),
          scopeBoundary: goalDraft.scopeBoundary.trim() || undefined,
          evidencePlan: normalizeChecklist(goalDraft.evidencePlan),
          criteria: normalizeChecklist(goalDraft.checklist),
        },
      });
      setCreateGoalOpen(false);
      navigateProjectTab('goals');
      await refreshProjectGoals();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setCreatingGoal(false);
    }
  }, [navigateProjectTab, project, refreshProjectGoals]);

  const submitBlocker = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!project || !blockerDraft.title.trim()) return;
    setCreatingBlocker(true);
    setError(null);
    try {
      await createProjectBlocker(project.id, {
        title: blockerDraft.title.trim(),
        reason: blockerDraft.reason.trim() || undefined,
      });
      setBlockerDraft({ title: '', reason: '' });
      await refreshProjectGoals();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingBlocker(false);
    }
  }, [blockerDraft.reason, blockerDraft.title, project, refreshProjectGoals]);

  const retryRun = useCallback(async (run: WorkflowRunSummary) => {
    if (!project) return;
    setWorkflowActionBusy(`retry:${run.id}`);
    setError(null);
    try {
      const result = await retryWorkflowRun(run.id, {
        ownerAgentId: selectedAgentId || run.metadata?.agentId,
        projectId: run.metadata?.projectId || project.id,
      });
      await refreshProjectWorkflows();
      navigateFromProjectTab('workflows', workflowBoardHref(result.runId, {
        ownerAgentId: selectedAgentId || run.metadata?.agentId || project.defaultAgentId,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkflowActionBusy(null);
    }
  }, [navigateFromProjectTab, project, refreshProjectWorkflows, selectedAgentId]);

  const cancelRun = useCallback(async (run: WorkflowRunSummary) => {
    setWorkflowActionBusy(`cancel:${run.id}`);
    setError(null);
    try {
      await cancelWorkflowRun(run.id, { ownerAgentId: selectedAgentId || run.metadata?.agentId });
      await refreshProjectWorkflows();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkflowActionBusy(null);
    }
  }, [refreshProjectWorkflows, selectedAgentId]);

  const headerStart = useMemo(
    () => (
      <Link to="/projects" className="inline-flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={pm.backToProjects}>
        <ArrowLeft className="size-4" aria-hidden />
      </Link>
    ),
    [pm.backToProjects],
  );

  const headerEnd = useMemo(
    () => project ? (
      <>
        <Button variant="secondary" className="h-9 rounded-lg" onClick={openCreateWorkItem}>
          <Plus className="size-4" aria-hidden />
          {pm.workItems.create.header}
        </Button>
        <Button variant="primary" className="h-9 rounded-lg" onClick={() => void startChat()} disabled={startingChat}>
          <MessageSquarePlus className="size-4" aria-hidden />
          {pm.common.newChat}
        </Button>
      </>
    ) : null,
    [openCreateWorkItem, pm.common.newChat, pm.workItems.create.header, project, startChat, startingChat],
  );

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: headerStart,
      main: (
        project ? (
          <ProjectSwitcher currentProject={project} pm={pm} projectsText={projectsText} wd={wd} />
        ) : (
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight text-fg">{pm.fallbackTitle}</h1>
            <p className="truncate text-xs text-fg-muted">{pm.fallbackContext}</p>
          </div>
        )
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, headerStart, pm, project, projectsText, setPageHeader, wd]);

  function applyProjectUpdate(updated: Project) {
    setProject((current) => current ? { ...current, ...updated } : null);
    setOverview((current) => current ? { ...current, project: { ...current.project, ...updated } } : null);
    setSelectedAgentId(updated.defaultAgentId ?? '');
    setDraft((current) => ({
      ...current,
      name: updated.name,
      description: updated.description ?? '',
      status: updated.status,
      defaultAgentId: updated.defaultAgentId ?? '',
      workspaceRoot: updated.workspaceRoot ?? '',
      brief: updated.brief ?? '',
      instructions: updated.instructions ?? '',
    }));
    window.dispatchEvent(new CustomEvent('project-updated', { detail: { id: updated.id } }));
  }

  async function submitProjectSave() {
    if (!project || !draft.name.trim()) return;
    setSaving(true);
    setError(null);
    setMissingWorkspaceRoot(null);
    try {
      const updated = await updateProject(project.id, {
        name: draft.name.trim(),
        status: draft.status,
        description: draft.description,
        defaultAgentId: draft.defaultAgentId,
        brief: draft.brief,
        instructions: draft.instructions,
      });
      applyProjectUpdate(updated);
    } catch (err) {
      const missingRoot = getMissingWorkspaceRoot(err);
      if (missingRoot) {
        setMissingWorkspaceRoot(missingRoot);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSaving(false);
    }
  }

  function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitProjectSave();
  }

  const openWorkspaceMigration = useCallback(() => {
    if (!project) return;
    const fixedRoot = project.workspaceRoot?.trim() ?? '';
    setWorkspaceMigrationMode(fixedRoot ? 'fixed' : 'follow');
    setWorkspaceMigrationRoot(fixedRoot || project.effectiveWorkspaceRoot || '');
    setWorkspaceMigrationOpen(true);
  }, [project]);

  async function submitWorkspaceMigration(options: { createWorkspaceRoot?: boolean } = {}) {
    if (!project) return;
    const nextWorkspaceRoot = workspaceMigrationMode === 'fixed' ? workspaceMigrationRoot.trim() : '';
    if (workspaceMigrationMode === 'fixed' && !nextWorkspaceRoot) return;
    setSaving(true);
    setError(null);
    setMissingWorkspaceRoot(null);
    try {
      const updated = await updateProject(project.id, {
        workspaceRoot: nextWorkspaceRoot,
        ...(options.createWorkspaceRoot ? { createWorkspaceRoot: true } : {}),
      });
      applyProjectUpdate(updated);
      setWorkspaceMigrationOpen(false);
      setMissingWorkspaceRoot(null);
    } catch (err) {
      const missingRoot = getMissingWorkspaceRoot(err);
      if (missingRoot) {
        setMissingWorkspaceRoot(missingRoot);
        setWorkspaceMigrationOpen(false);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleProjectPin() {
    if (!project || projectActionBusy) return;
    setProjectActionBusy('pin');
    setError(null);
    try {
      const updated = project.pinnedAt ? await unpinProject(project.id) : await pinProject(project.id);
      applyProjectUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProjectActionBusy(null);
    }
  }

  async function toggleProjectArchive() {
    if (!project || projectActionBusy) return;
    setProjectActionBusy('archive');
    setError(null);
    try {
      const updated = project.status === 'archived' ? await restoreProject(project.id) : await archiveProject(project.id);
      applyProjectUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProjectActionBusy(null);
    }
  }

  async function removeProject() {
    if (!project) return;
    setDeletingProject(true);
    setError(null);
    try {
      await deleteProject(project.id);
      setDeleteConfirmOpen(false);
      navigate('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingProject(false);
    }
  }

  async function saveDigest() {
    if (!project || savingDigest) return;
    setSavingDigest(true);
    setError(null);
    try {
      await saveProjectDigest(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingDigest(false);
    }
  }

  const previewProjectFile = useCallback((path: string) => {
    setPreviewFilePath(path);
  }, []);

  const handleProjectFileEntrySelect = useCallback((path: string, isDirectory: boolean) => {
    if (!isDirectory) setPreviewFilePath(path);
  }, []);

  const handleProjectFileAction = useCallback(
    async (action: FileTreeAction, entry: TreeEntry, appPath?: string) => {
      const pid = project?.id;
      if (!pid) return;
      switch (action) {
        case 'preview':
          if (!entry.isDirectory) setPreviewFilePath(entry.path);
          break;
        case 'download':
          if (entry.isDirectory) return;
          try {
            const fileName = getPreviewFileName(entry.path);
            if (readModeForPreviewType(detectPreviewFileType(fileName)) !== 'text') {
              const blob = await fetchWorkspaceFileBlob(entry.path, { projectId: pid });
              const mime = inferMimeTypeFromFileName(fileName) ?? 'application/octet-stream';
              downloadBinaryFile(fileName, await blob.arrayBuffer(), mime);
            } else {
              const { content } = await readWorkspaceFile(entry.path, { projectId: pid });
              downloadTextFile(fileName, content);
            }
          } catch (err) {
            showComposerNotification('warning', err instanceof Error ? err.message : String(err), undefined, { duration: 4000 });
          }
          break;
        case 'copyPath':
          try {
            const ok = await copyTextToClipboard(entry.absolutePath ?? entry.path);
            if (ok) showComposerNotification('success', msg.workspace.pathCopied, undefined, { duration: 2500 });
          } catch {
            showComposerNotification('warning', msg.clipboard.copyFailed, undefined, { duration: 4000 });
          }
          break;
        case 'openDefault':
          if (!entry.absolutePath || !window.electronAPI?.shell?.openPath) return;
          await window.electronAPI.shell.openPath(entry.absolutePath);
          break;
        case 'openWith':
          if (!entry.absolutePath || !window.electronAPI?.shell?.chooseAppAndOpenPath) return;
          await window.electronAPI.shell.chooseAppAndOpenPath(entry.absolutePath);
          break;
        case 'openWithApp':
          if (!entry.absolutePath || !appPath || !window.electronAPI?.shell?.openPathWithApp) return;
          await window.electronAPI.shell.openPathWithApp(entry.absolutePath, appPath);
          break;
        case 'revealInFolder':
          if (!entry.absolutePath || !window.electronAPI?.shell?.showItemInFolder) return;
          await window.electronAPI.shell.showItemInFolder(entry.absolutePath);
          break;
        default:
          break;
      }
    },
    [msg.clipboard.copyFailed, msg.workspace.pathCopied, project?.id],
  );

  const handleProjectFilesResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const grid = handle.closest<HTMLElement>('[data-project-files-grid]');
    if (!grid) return;
    handle.setPointerCapture(event.pointerId);
    setProjectFilesPanelResizing(true);
    const startX = event.clientX;
    const startWidth = projectFilesPanelWidth;
    const pointerId = event.pointerId;
    let rafId = 0;
    let nextWidth = startWidth;
    let committedWidth = startWidth;
    const applyWidth = () => {
      rafId = 0;
      committedWidth = nextWidth;
      grid.style.setProperty('--project-files-panel-width', `${committedWidth}px`);
    };
    const onMove = (moveEvent: PointerEvent) => {
      nextWidth = clampProjectFilesPanelWidth(startWidth + (moveEvent.clientX - startX));
      if (rafId === 0) {
        rafId = window.requestAnimationFrame(applyWidth);
      }
    };
    const onDone = () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
        applyWidth();
      }
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
      setProjectFilesPanelResizing(false);
      setProjectFilesPanelWidth(committedWidth);
      writeProjectFilesPanelWidth(committedWidth);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onDone);
      window.removeEventListener('pointercancel', onDone);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onDone);
    window.addEventListener('pointercancel', onDone);
  }, [projectFilesPanelWidth]);

  useEffect(() => {
    if (tab !== 'files') {
      setPreviewFilePath(null);
    }
  }, [projectId, tab]);

  if (loading) {
    return <main className="w-full flex-1 p-3 text-sm text-fg-muted sm:px-5 sm:py-4 xl:px-6">{pm.loading}</main>;
  }

  if (!project) {
    return (
      <main className="w-full flex-1 p-3 sm:px-5 sm:py-4 xl:px-6">
        <Link to="/projects" className="inline-flex items-center gap-2 text-sm text-accent-fg hover:underline">
          <ArrowLeft className="size-4" aria-hidden />
          {pm.backToProjects}
        </Link>
        <p className="mt-6 rounded-lg bg-surface-panel p-4 shadow-surface text-sm text-fg-muted">
          {error || pm.notFound}
        </p>
      </main>
    );
  }

  const overviewSessions = overview?.recentSessions.length ? overview.recentSessions : project.recentSessions;
  const overviewAttentionItems = overview?.attentionItems ?? [];
  const statusLabel = (status: string) => pm.statuses[status as keyof typeof pm.statuses] ?? status;
  const messageCount = (count: number) => interpolate(pm.common.messages, { count });
  const sessionSearchNeedle = sessionSearchQuery.trim().toLowerCase();
  const visibleSessions = sessionSearchNeedle
    ? sessions.filter((session) => {
      const updatedAt = formatDate(session.updatedAt);
      const agentLabel = session.routing?.agentId || session.agentId || pm.common.agent;
      const title = session.name?.trim() || pm.sessions.fallbackTitle;
      const messagesLabel = messageCount(session.messageCount ?? 0);
      const sourceLabel = projectSessionSource(session);
      return [title, session.key, agentLabel, sourceLabel, updatedAt, messagesLabel]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(sessionSearchNeedle);
    })
    : sessions;
  const sessionsSearchMiss = sessions.length > 0 && visibleSessions.length === 0;
  const selectedAgentLabel = agents.find((agent) => agent.id === draft.defaultAgentId)?.name || draft.defaultAgentId || pm.settings.globalDefaultAgent;
  const selectedDraftAgent = agents.find((agent) => agent.id === draft.defaultAgentId);
  const fixedProjectWorkspace = project.workspaceRoot?.trim() || '';
  const projectIsArchived = project.status === 'archived';
  const projectIsPinned = Boolean(project.pinnedAt);
  const projectFollowsAgentWorkspace = !fixedProjectWorkspace;
  const effectiveDraftWorkspace = fixedProjectWorkspace || selectedDraftAgent?.workspace || project.effectiveWorkspaceRoot || pm.common.defaultWorkspace;
  const workspaceRootLabel = effectiveDraftWorkspace;
  const workspaceMigrationPreview = workspaceMigrationMode === 'fixed'
    ? (workspaceMigrationRoot.trim() || pm.settings.workspacePlaceholder)
    : (selectedDraftAgent?.workspace || project.effectiveWorkspaceRoot || pm.common.defaultWorkspace);
  const workspaceMigrationValue = workspaceMigrationMode === 'fixed' ? workspaceMigrationRoot.trim() : '';
  const workspaceMigrationChanged = workspaceMigrationValue !== fixedProjectWorkspace;
  const workspaceMigrationCanSubmit = workspaceMigrationChanged && (workspaceMigrationMode === 'follow' || Boolean(workspaceMigrationRoot.trim()));
  const primaryTabItems: Array<{ id: Exclude<PrimaryTabId, 'settings'>; icon: LucideIcon; label: string }> = [
    { id: 'overview', icon: LayoutDashboard, label: pm.tabs.overview },
    { id: 'work', icon: ListChecks, label: pm.tabs.work },
    { id: 'files', icon: Folder, label: pm.tabs.files },
    { id: 'notes', icon: File, label: pm.tabs.notes },
    { id: 'sessions', icon: MessageSquarePlus, label: pm.tabs.sessions },
    { id: 'activity', icon: History, label: pm.tabs.activity },
  ];
  const workTabItems: Array<{ id: WorkTabId; icon: LucideIcon; label: string }> = [
    { id: 'work-items', icon: ListChecks, label: pm.tabs.workItems },
    { id: 'goals', icon: Target, label: pm.tabs.goals },
    { id: 'workflows', icon: Play, label: pm.tabs.workflows },
    { id: 'automations', icon: Zap, label: pm.tabs.automations },
  ];
  const activePrimaryTab: PrimaryTabId = isWorkTab(tab) ? 'work' : tab;

  async function copyProjectWorkspacePath() {
    if (!workspaceRootLabel) return;
    const ok = await copyTextToClipboard(workspaceRootLabel);
    showComposerNotification(ok ? 'success' : 'warning', ok ? msg.workspace.pathCopied : msg.clipboard.copyFailed, undefined, { duration: ok ? 2500 : 4000 });
  }

  function returnToWorkspaceMigrationFromMissingWorkspace() {
    setMissingWorkspaceRoot(null);
    setWorkspaceMigrationOpen(true);
  }

  return (
    <main className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden p-3 sm:px-5 sm:py-4 xl:px-6">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <PageTabs
          items={primaryTabItems}
          activeTab={activePrimaryTab}
          onChange={(nextTab) => navigateProjectTab(nextTab === 'work' ? 'work-items' : nextTab)}
          ariaLabel={pm.navAria}
          tabIdPrefix="project-primary-tab"
          className="min-w-0 flex-1"
        />
        <Button
          id="project-primary-tab-settings"
          type="button"
          variant={tab === 'settings' ? 'secondary' : 'ghost'}
          className="h-9 shrink-0 rounded-lg px-3"
          aria-current={tab === 'settings' ? 'page' : undefined}
          onClick={() => navigateProjectTab('settings')}
        >
          <Settings className="size-4" aria-hidden />
          {pm.tabs.settings}
        </Button>
      </div>

      {error ? <p className="mt-3 shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}

      {isWorkTab(tab) ? (
        <div className="mt-3 shrink-0 rounded-xl border border-edge-subtle bg-surface-panel px-2 py-1 shadow-surface">
          <PageTabs
            items={workTabItems}
            activeTab={tab}
            onChange={navigateProjectTab}
            ariaLabel={pm.workNavAria}
            tabIdPrefix="project-work-tab"
            panelIdPrefix="project-panel"
            buttonClassName="h-8 px-2.5 py-1.5 text-xs"
          />
        </div>
      ) : null}

      <div
        className={cn(
          'mt-3 min-h-0 flex-1',
          tab === 'work-items'
            ? '-mx-3 -mb-3 overflow-hidden sm:-mx-5 sm:-mb-4 xl:-mx-6'
            : tab === 'overview'
              ? 'overflow-y-auto pr-1 [scrollbar-gutter:stable] xl:overflow-hidden xl:pr-0'
              : 'overflow-y-auto pr-1 [scrollbar-gutter:stable]',
        )}
      >
      {tab === 'overview' ? (
        <section id="project-panel-overview" role="tabpanel" aria-labelledby="project-primary-tab-overview" className="grid min-h-full gap-4 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_20rem] xl:overflow-hidden">
          <div className="grid min-w-0 content-start gap-4 xl:min-h-0 xl:overflow-y-auto xl:pr-1 xl:[scrollbar-gutter:stable]">
            <div className="min-w-0 rounded-lg bg-surface-panel p-4 shadow-surface">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-fg">{pm.overview.directionTitle}</h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-fg-muted">
                    {overview?.digest?.summary || overview?.recommendedAction || project.description || project.brief || pm.overview.directionFallback}
                  </p>
                  {overview?.digest?.nextAction ? (
                    <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-fg">
                      {interpolate(pm.overview.recommendedNext, { action: overview.digest.nextAction })}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => void saveDigest()} disabled={savingDigest}>
                    <Save className="size-4" aria-hidden />
                    {savingDigest ? pm.overview.savingDigest : pm.overview.saveDigest}
                  </Button>
                </div>
              </div>
            </div>

            <div className="min-w-0 rounded-lg bg-surface-panel shadow-surface">
              <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
                <h2 className="text-sm font-semibold text-fg">{pm.overview.nextActions}</h2>
                <Button type="button" variant="ghost" className="h-8 rounded-lg px-2 py-1 text-xs" onClick={() => setCreateGoalOpen(true)}>
                  <Plus className="size-4" aria-hidden />
                  {pm.overview.goal}
                </Button>
              </div>
              <div className="divide-y divide-edge">
                {overview?.nextActions.length ? overview.nextActions.map((item) => (
                  <Link
                    key={item.goalId}
                    to={projectGoalHref(item.goalId)}
                    onClick={onProjectTabLinkClick('goals')}
                    className="block px-4 py-3 hover:bg-surface-hover"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium text-fg">{item.title}</span>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', statusTone(item.status))}>{statusLabel(item.status)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm leading-5 text-fg-muted">{item.nextAction}</p>
                  </Link>
                )) : (
                  <div className="px-4 py-6 text-sm text-fg-muted">
                    {pm.overview.noNextActions}
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className="grid min-w-0 content-start gap-4 xl:min-h-0 xl:overflow-y-auto xl:pr-1 xl:[scrollbar-gutter:stable]">
            <div className="min-w-0 rounded-lg bg-surface-panel p-4 shadow-surface">
              <h2 className="text-sm font-semibold text-fg">{pm.overview.attention}</h2>
              {overviewAttentionItems.length ? (
                <div className="mt-3 grid gap-3">
                  {overviewAttentionItems.map((item) => {
                    const content = (
                      <>
                        <div className="flex min-w-0 items-center gap-2">
                          <AlertCircle className="size-4 text-amber-600 dark:text-amber-300" aria-hidden />
                          <span className="min-w-0 truncate text-sm font-medium text-fg">{item.title}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">
                          {pm.overview.attentionKinds[item.kind] ?? item.kind}
                          {item.detail ? ` · ${item.detail}` : item.status ? ` · ${statusLabel(item.status)}` : ''}
                        </p>
                      </>
                    );
                    return item.href ? (
                      <Link key={item.id} to={item.href} onClick={onProjectTabLinkClick(projectTabForHref(item.href))} className="min-w-0 rounded-md bg-surface-base p-3 hover:bg-surface-hover">
                        {content}
                      </Link>
                    ) : (
                      <div key={item.id} className="min-w-0 rounded-md bg-surface-base p-3">
                        {content}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-sm text-fg-muted">{pm.overview.noBlockedGoals}</p>
              )}
              <form onSubmit={submitBlocker} className="mt-4 flex gap-2 border-t border-edge pt-4">
                <input
                  className="min-h-9 min-w-0 flex-1 rounded-md border border-edge bg-surface-base px-3 text-sm text-fg outline-none focus:border-accent"
                  value={blockerDraft.title}
                  onChange={(event) => setBlockerDraft((draft) => ({ ...draft, title: event.target.value }))}
                  placeholder={pm.overview.blockerTitlePlaceholder}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  className="shrink-0 rounded-lg px-3"
                  disabled={creatingBlocker || !blockerDraft.title.trim()}
                  aria-label={creatingBlocker ? pm.overview.addingBlocker : pm.overview.addBlocker}
                  title={creatingBlocker ? pm.overview.addingBlocker : pm.overview.addBlocker}
                >
                  <Plus className="size-4" aria-hidden />
                </Button>
              </form>
            </div>

            <div className="min-w-0 rounded-lg bg-surface-panel shadow-surface">
              <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Clock className="size-4 shrink-0 text-fg-muted" aria-hidden />
                  <h2 className="min-w-0 truncate text-sm font-semibold text-fg">{pm.overview.recentSessions}</h2>
                </div>
                <button type="button" className="shrink-0 text-xs font-medium text-accent-fg hover:underline" onClick={() => navigateProjectTab('sessions')}>
                  {pm.common.viewAll}
                </button>
              </div>
              <div className="divide-y divide-edge">
                {overviewSessions.length ? overviewSessions.map((session) => (
                  <Link key={session.key} to={`/chat/${encodeURIComponent(session.key)}`} onClick={onProjectTabLinkClick('sessions')} className="block px-4 py-3 hover:bg-surface-hover">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium text-fg">{session.name || session.key}</span>
                      <span className="shrink-0 text-xs text-fg-subtle">{formatDate(session.updatedAt)}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-fg-muted">{session.agentId || pm.common.agent}</p>
                  </Link>
                )) : (
                  <div className="px-4 py-6 text-sm text-fg-muted">{pm.overview.noSessions}</div>
                )}
              </div>
            </div>
          </aside>
        </section>
      ) : null}

      {tab === 'work-items' ? (
        <section id="project-panel-work-items" className="flex h-full min-h-0 flex-col" role="tabpanel" aria-labelledby="project-work-tab-work-items">
          <div className="min-h-0 flex-1 overflow-hidden">
            <WorkItemsPanel projectId={project.id} createRequestKey={createWorkItemRequestKey} />
          </div>
        </section>
      ) : null}

      {tab === 'workflows' ? (
        <section id="project-panel-workflows" role="tabpanel" aria-labelledby="project-work-tab-workflows" className="grid h-full min-h-[28rem] gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-h-0">
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-surface-panel shadow-surface">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-fg">{pm.workflows.runsTitle}</h2>
                  <p className="text-xs text-fg-muted">{pm.workflows.runsHint}</p>
                </div>
                <Button type="button" variant="secondary" className="h-9 rounded-lg" onClick={() => void refreshProjectWorkflows()} disabled={workflowsLoading}>
                  <RotateCcw className="size-4" aria-hidden />
                  {pm.common.refresh}
                </Button>
              </div>
              <div className="min-h-0 flex-1 divide-y divide-edge overflow-y-auto">
                {workflowsLoading && workflowRuns.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-fg-muted">{pm.workflows.loadingRuns}</div>
                ) : workflowRuns.length ? workflowRuns.map((run) => {
                  const canCancel = run.status === 'queued' || run.status === 'running';
                  const canRetry = run.status === 'failed' || run.status === 'timeout' || run.status === 'cancelled';
                  return (
                    <div key={run.id} className="grid gap-2 px-4 py-3 hover:bg-surface-hover">
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          className="min-w-0 truncate text-left text-sm font-medium text-fg hover:text-accent-fg"
                          onClick={() => navigateFromProjectTab('workflows', workflowBoardHref(run.id, {
                            ownerAgentId: selectedAgentId || run.metadata?.agentId || project.defaultAgentId,
                          }))}
                        >
                          {run.title || run.definitionId}
                        </button>
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', workflowStatusTone(run.status))}>
                          {statusLabel(run.status)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="truncate text-xs text-fg-muted">
                          {interpolate(pm.workflows.runMeta, {
                            definitionId: run.definitionId,
                            done: run.metrics.doneAgentCount,
                            total: run.metrics.agentCount,
                            time: formatDate(run.createdAtMs),
                          })}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 rounded-lg px-2 py-1 text-xs"
                            onClick={() => navigateFromProjectTab('workflows', workflowBoardHref(run.id, {
                              ownerAgentId: selectedAgentId || run.metadata?.agentId || project.defaultAgentId,
                            }))}
                          >
                            {pm.common.open}
                          </Button>
                          {canRetry ? (
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-8 rounded-lg px-2 py-1 text-xs"
                              disabled={workflowActionBusy === `retry:${run.id}`}
                              onClick={() => void retryRun(run)}
                            >
                              <RotateCcw className="size-3.5" aria-hidden />
                              {pm.common.retry}
                            </Button>
                          ) : null}
                          {canCancel ? (
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-8 rounded-lg px-2 py-1 text-xs"
                              disabled={workflowActionBusy === `cancel:${run.id}`}
                              onClick={() => void cancelRun(run)}
                            >
                              <Square className="size-3.5" aria-hidden />
                              {pm.common.cancel}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="px-4 py-6 text-sm text-fg-muted">
                    {pm.workflows.emptyRuns}
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className="min-h-0">
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-surface-panel shadow-surface">
              <div className="shrink-0 border-b border-edge px-4 py-3">
                <h2 className="text-sm font-semibold text-fg">{pm.workflows.startTitle}</h2>
                <p className="mt-1 text-xs text-fg-muted">{pm.workflows.startHint}</p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <div className="grid gap-2">
                {workflowDefinitions.length ? workflowDefinitions.map((definition) => (
                  <button
                    key={definition.id}
                    type="button"
                    className="grid gap-1 rounded-md bg-surface-base p-3 text-left hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-accent/30"
                    onClick={() => navigate(`/workflows/${definition.id}?projectId=${encodeURIComponent(project.id)}${selectedAgentId ? `&agentId=${encodeURIComponent(selectedAgentId)}` : ''}`)}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-fg">
                      <Play className="size-4 text-accent-fg" aria-hidden />
                      <span className="min-w-0 truncate">{definition.title}</span>
                    </span>
                    <span className="line-clamp-2 text-xs leading-5 text-fg-muted">
                      {definition.description || definition.metadata.whenToUse || definition.name}
                    </span>
                  </button>
                )) : (
                  <div className="px-1 py-3 text-sm text-fg-muted">{pm.workflows.emptyDefinitions}</div>
                )}
                </div>
              </div>
            </div>
          </aside>
        </section>
      ) : null}

      {tab === 'automations' ? (
        <section id="project-panel-automations" role="tabpanel" aria-labelledby="project-work-tab-automations" className="grid h-full min-h-[28rem] overflow-hidden gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-surface-panel shadow-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-fg">{pm.automations.title}</h2>
                <p className="text-xs text-fg-muted">{pm.automations.hint}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" className="h-9 rounded-lg" onClick={() => void refreshProjectAutomations()} disabled={automationsLoading}>
                  <RotateCcw className="size-4" aria-hidden />
                  {pm.common.refresh}
                </Button>
                <Button type="button" variant="primary" className="h-9 rounded-lg" onClick={() => navigateFromProjectTab('automations', `/automations?projectId=${encodeURIComponent(project.id)}&action=create`)}>
                  <Plus className="size-4" aria-hidden />
                  {pm.common.new}
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 divide-y divide-edge overflow-y-auto">
              {automationsLoading && automations.length === 0 ? (
                <div className="px-4 py-6 text-sm text-fg-muted">{pm.automations.loading}</div>
              ) : automations.length ? automations.map((automation) => {
                const latestRun = automationRuns.find((run) => run.automationId === automation.id);
                const running = automation.state.runningRunId ? automationRuns.find((run) => run.id === automation.state.runningRunId) : null;
                return (
                  <div key={automation.id} className="grid gap-2 px-4 py-3 hover:bg-surface-hover">
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        className="min-w-0 truncate text-left text-sm font-medium text-fg hover:text-accent-fg"
                        onClick={() => navigateFromProjectTab('automations', `/automations?automation=${encodeURIComponent(automation.id)}`)}
                      >
                        {automation.name}
                      </button>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', automation.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-surface-hover text-fg-muted')}>
                        {automation.enabled ? pm.automations.enabled : pm.automations.paused}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-sm leading-5 text-fg-muted">{automation.description || automation.action.kind}</p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="truncate text-xs text-fg-muted">
                        {interpolate(pm.common.lastRun, {
                          trigger: automation.trigger.kind,
                          action: automation.action.kind,
                          time: latestRun ? formatDate(latestRun.createdAtMs) : pm.common.never,
                        })}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 rounded-lg px-2 py-1 text-xs"
                          disabled={automationActionBusy === `run:${automation.id}` || Boolean(running)}
                          onClick={() => void runAutomation(automation)}
                        >
                          <Play className="size-3.5" aria-hidden />
                          {pm.automations.run}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 rounded-lg px-2 py-1 text-xs"
                          disabled={automationActionBusy === `toggle:${automation.id}`}
                          onClick={() => void toggleAutomation(automation)}
                        >
                          {automation.enabled ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                          {automation.enabled ? pm.automations.pause : pm.automations.resume}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div className="grid gap-3 px-4 py-6 text-sm text-fg-muted">
                  <p>{pm.automations.empty}</p>
                  <div>
                    <Button type="button" variant="secondary" className="rounded-lg" onClick={() => navigateFromProjectTab('automations', `/automations?projectId=${encodeURIComponent(project.id)}&action=create`)}>
                      <Zap className="size-4" aria-hidden />
                      {pm.automations.create}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <aside className="grid min-h-0 min-w-0 content-start gap-4 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
            <div className="rounded-lg bg-surface-panel shadow-surface">
              <div className="border-b border-edge px-4 py-3">
                <h2 className="text-sm font-semibold text-fg">{pm.automations.recentRuns}</h2>
              </div>
              <div className="divide-y divide-edge">
                {automationRuns.length ? automationRuns.slice(0, 8).map((run) => (
                  <div key={run.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium text-fg">{run.automationName}</span>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', workflowStatusTone(run.status))}>{statusLabel(run.status)}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-fg-muted">{formatDate(run.createdAtMs)}</p>
                  </div>
                )) : (
                  <div className="px-4 py-6 text-sm text-fg-muted">{pm.automations.emptyRuns}</div>
                )}
              </div>
            </div>
            <div className="rounded-lg bg-surface-panel p-4 shadow-surface">
              <h2 className="text-sm font-semibold text-fg">{pm.automations.contextTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-fg-muted">{pm.automations.contextHint}</p>
              <p className="mt-3 break-all text-xs text-fg-subtle">{project.workspaceRoot || project.effectiveWorkspaceRoot || pm.common.defaultWorkspace}</p>
            </div>
          </aside>
        </section>
      ) : null}

      {tab === 'notes' ? (
        <section id="project-panel-notes" role="tabpanel" aria-labelledby="project-primary-tab-notes" className="flex h-full min-h-[28rem] overflow-hidden rounded-lg bg-surface-panel shadow-surface">
          <NotesWorkbench
            selectedNoteId={noteId}
            basePath={`/projects/${encodeURIComponent(project.id)}/notes`}
            showLibrary={false}
            allowMediaCapture={false}
            listTag={`project:${project.id}`}
            captureTags={[`project:${project.id}`, project.slug]}
            listTitle={pm.notes.title}
            listDescription={pm.notes.hint}
            emptyText={pm.notes.emptyTitle}
            emptyDescription={pm.notes.emptyDescription}
            listWidthStorageKey={`xopc.projectNotes.listWidth.${project.id}`}
          />
        </section>
      ) : null}

      {tab === 'files' ? (
        <section id="project-panel-files" role="tabpanel" aria-labelledby="project-primary-tab-files" className="flex h-full min-h-[28rem] flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface-panel shadow-surface">
            {project.effectiveWorkspaceRoot ? (
              <div
                data-project-files-grid
                className={cn(
                  'grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[var(--project-files-panel-width)_6px_minmax(0,1fr)]',
                  projectFilesPanelResizing && 'cursor-col-resize select-none',
                )}
                style={{ '--project-files-panel-width': `${projectFilesPanelWidth}px` } as CSSProperties}
              >
                <aside className="flex min-h-0 flex-col border-b border-edge lg:border-b-0 lg:border-r">
                  <div className="flex h-11 items-center gap-1 border-b border-edge bg-surface-muted/50 px-3 text-sm">
                    <WorkspaceOpenLocationMenu workspacePath={workspaceRootLabel} />
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className={cn(
                          'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg',
                          projectFileSearchOpen && 'bg-surface-hover text-fg',
                        )}
                        onClick={() => setProjectFileSearchOpen(true)}
                        aria-label={pm.files.search}
                        title={pm.files.search}
                        aria-pressed={projectFileSearchOpen}
                      >
                        <Search className="size-3.5" aria-hidden />
                      </button>
                      <RefreshButton
                        className="size-7 shrink-0 rounded-md p-0"
                        loading={filesLoading}
                        label={msg.cron.refresh}
                        onClick={() => void refreshProjectFiles()}
                      />
                    </div>
                  </div>

                  {projectFileSearchOpen ? (
                    <div className="shrink-0 border-b border-edge bg-surface-muted/40 px-3 py-2">
                      <div className="flex h-8 items-center gap-2 rounded-md border border-edge bg-surface-panel px-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                        <Search className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                        <input
                          type="text"
                          role="searchbox"
                          value={projectFileSearchQuery}
                          onChange={(event) => setProjectFileSearchQuery(event.target.value)}
                          placeholder={pm.files.searchPlaceholder}
                          aria-label={pm.files.searchPlaceholder}
                          className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
                        />
                        <button
                          type="button"
                          className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
                          aria-label={pm.files.clearSearch}
                          title={pm.files.clearSearch}
                          onClick={() => {
                            setProjectFileSearchQuery('');
                            setProjectFileSearchOpen(false);
                          }}
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {filesError ? (
                    <div className="border-b border-edge bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{filesError}</div>
                  ) : null}

                  {normalizedProjectFileSearchQuery ? (
                    <div className="min-h-0 flex-1 overflow-y-auto py-2">
                      {projectFileSearchLoading ? (
                        <div className="space-y-2 px-3 py-1">
                          <Skeleton className="h-11 w-full" />
                          <Skeleton className="h-11 w-full" />
                          <Skeleton className="h-11 w-full" />
                        </div>
                      ) : projectFileSearchError ? (
                        <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">
                          {msg.workspace.loadError}: {projectFileSearchError}
                        </p>
                      ) : projectFileSearchResults.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-fg-muted">{pm.files.noSearchResults}</p>
                      ) : (
                        projectFileSearchResults.map((entry) => (
                          <button
                            key={entry.path}
                            type="button"
                            className={cn(
                              'flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover',
                              previewFilePath === entry.path && 'bg-accent-soft text-accent-fg',
                            )}
                            onClick={() => setPreviewFilePath(entry.path)}
                            title={entry.path}
                          >
                            <File className="size-4 shrink-0 text-fg-muted" aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-fg">{entry.name}</span>
                              <span className="block truncate text-xs text-fg-subtle">{entry.path}</span>
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : filesLoading && projectFileTree.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-fg-muted">{pm.files.loading}</div>
                  ) : (
                    <FileTree
                      tree={projectFileTree}
                      selectedPath={previewFilePath}
                      onSelectFile={previewProjectFile}
                      onSelectEntry={handleProjectFileEntrySelect}
                      onExpandDir={(dirPath) => void loadProjectFileChildren(dirPath)}
                      onAction={handleProjectFileAction}
                      actionLabels={{
                        preview: msg.workspace.preview,
                        download: msg.workspace.download,
                        copyPath: msg.workspace.copyPath,
                        openDefault: msg.workspace.openSystemApp,
                        openWith: msg.workspace.openWith,
                        revealInFolder: msg.workspace.revealInFolder,
                        recommendedApps: msg.workspace.recommendedApps,
                      }}
                      emptyHint={pm.files.emptyDirectory}
                    />
                  )}
                </aside>

                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={pm.files.resizeHandle}
                  className={cn(
                    'hidden cursor-col-resize touch-none items-stretch justify-center bg-surface-panel transition-colors hover:bg-surface-hover lg:flex',
                    projectFilesPanelResizing && 'bg-surface-hover',
                  )}
                  onPointerDown={handleProjectFilesResizePointerDown}
                >
                  <div className="my-3 w-px rounded-full bg-edge-strong/70" />
                </div>

                <div className="min-h-0 min-w-0 overflow-hidden bg-surface-base">
                  {previewFilePath ? (
                    <WorkspaceFilePreviewPanel
                      filePath={previewFilePath}
                      projectId={project.id}
                      agentId={project.defaultAgentId || selectedAgentId || undefined}
                      onClose={() => setPreviewFilePath(null)}
                    />
                  ) : (
                    <div className="flex h-full min-h-[18rem] items-center justify-center px-6 text-center">
                      <div className="max-w-sm">
                        <Folder className="mx-auto size-8 text-fg-subtle" aria-hidden />
                        <p className="mt-3 text-sm font-medium text-fg">{pm.files.previewEmptyTitle}</p>
                        <p className="mt-1 text-sm leading-6 text-fg-muted">{pm.files.previewEmptyDescription}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid gap-3 px-4 py-8 text-sm text-fg-muted">
                <p>{pm.files.needWorkspace}</p>
                <div>
                  <Button type="button" variant="secondary" className="rounded-lg" onClick={() => navigateProjectTab('settings')}>
                    {pm.files.openSettings}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {tab === 'sessions' ? (
        <section id="project-panel-sessions" role="tabpanel" aria-labelledby="project-primary-tab-sessions" className="grid min-h-full content-start gap-3">
          {sessions.length ? (
            <label className="relative flex min-h-9 w-full max-w-lg cursor-text items-center rounded-lg bg-surface-panel py-1.5 pl-9 pr-9 shadow-surface">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-disabled" aria-hidden />
              <input
                type="search"
                enterKeyHint="search"
                value={sessionSearchQuery}
                onChange={(event) => setSessionSearchQuery(event.currentTarget.value)}
                placeholder={pm.sessions.searchPlaceholder}
                aria-label={pm.sessions.searchPlaceholder}
                className="min-w-0 flex-1 appearance-none border-0 bg-transparent py-0.5 text-sm leading-normal text-fg caret-current placeholder:text-fg-disabled focus:border-0 focus:shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none"
              />
              {sessionSearchQuery ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label={pm.sessions.clearSearch}
                  onClick={() => setSessionSearchQuery('')}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </label>
          ) : null}
          {visibleSessions.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleSessions.map((session) => {
              const updatedAt = formatDate(session.updatedAt);
              const agentLabel = session.routing?.agentId || session.agentId || pm.common.agent;
              const sourceLabel = projectSessionSource(session);
              const title = session.name?.trim() || pm.sessions.fallbackTitle;
              const messagesLabel = messageCount(session.messageCount ?? 0);
              return (
                <Link
                  key={session.key}
                  to={`/chat/${encodeURIComponent(session.key)}`}
                  onClick={onProjectTabLinkClick('sessions')}
                  className="group flex min-h-[8.75rem] min-w-0 flex-col rounded-lg bg-surface-panel p-4 shadow-surface transition-colors hover:bg-surface-hover/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-base text-fg-muted">
                      <MessageSquarePlus className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{title}</h3>
                        {sourceLabel ? (
                          <span className="shrink-0 rounded-md bg-surface-base px-2 py-0.5 text-[11px] font-medium leading-5 text-fg-muted">
                            {sourceLabel}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="mt-auto grid gap-2 pt-4 text-xs text-fg-muted">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="min-w-0 max-w-full truncate rounded-md bg-surface-base px-2 py-1">
                        {pm.sessions.agent}: {agentLabel}
                      </span>
                      <span className="rounded-md bg-surface-base px-2 py-1">{messagesLabel}</span>
                    </div>
                    {updatedAt ? (
                      <span className="truncate rounded-md bg-surface-base px-2 py-1">
                        {pm.sessions.updated}: {updatedAt}
                      </span>
                    ) : null}
                  </div>
                </Link>
              );
              })}
            </div>
          ) : sessionsSearchMiss ? (
              <div className="grid gap-1 rounded-lg bg-surface-panel px-4 py-8 text-center shadow-surface">
                <h3 className="text-sm font-semibold text-fg">{pm.sessions.noMatches}</h3>
              </div>
            ) : (
              <div className="grid gap-1 rounded-lg bg-surface-panel px-4 py-8 text-center shadow-surface">
                <div>
                  <h3 className="text-sm font-semibold text-fg">{pm.sessions.emptyTitle}</h3>
                  <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-fg-muted">{pm.sessions.emptyDescription}</p>
                </div>
              </div>
            )}
        </section>
      ) : null}

      {tab === 'goals' ? (
        <section id="project-panel-goals" role="tabpanel" aria-labelledby="project-work-tab-goals" className="grid min-h-full content-start gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-fg">{pm.goals.title}</h2>
            </div>
            <Button
              type="button"
              variant="primary"
              className="h-9 rounded-lg px-3"
              disabled={creatingGoal}
              onClick={() => setCreateGoalOpen(true)}
            >
              <Plus className="size-4" aria-hidden />
              {pm.goals.new}
            </Button>
          </div>
          <div className="overflow-hidden rounded-lg bg-surface-panel shadow-surface">
            {goals.length ? goals.map((goal) => (
              <Link
                key={goal.id}
                to={projectGoalHref(goal.id)}
                onClick={onProjectTabLinkClick('goals')}
                className="grid gap-1 border-b border-edge px-4 py-3 last:border-b-0 hover:bg-surface-hover"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-fg">{goal.title}</span>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', statusTone(goal.status))}>
                    {statusLabel(goal.status)}
                  </span>
                </div>
                <span className="truncate text-xs text-fg-muted">{goal.nextAction || goal.description || pm.goals.noNextAction}</span>
              </Link>
            )) : <p className="p-4 text-sm text-fg-muted">{pm.goals.empty}</p>}
          </div>
        </section>
      ) : null}

      {tab === 'activity' ? (
        <section id="project-panel-activity" role="tabpanel" aria-labelledby="project-primary-tab-activity" className="grid min-h-full content-start gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-fg">{pm.activity.title}</h2>
              <p className="mt-1 text-sm text-fg-muted">
                {interpolate(pm.activity.count, { count: projectActivityTotal })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-surface-panel px-3 text-sm text-fg-muted shadow-surface">
                <input
                  type="checkbox"
                  checked={projectActivityIncludeRelated}
                  onChange={(event) => setProjectActivityIncludeRelated(event.currentTarget.checked)}
                  className="size-4 rounded border-edge text-accent focus:ring-accent/30"
                />
                {pm.activity.includeRelated}
              </label>
              <Button type="button" variant="secondary" className="h-9 rounded-lg px-3" onClick={() => void refreshProjectActivity()} disabled={projectActivityLoading}>
                <RotateCcw className={cn('size-4', projectActivityLoading && 'animate-spin')} aria-hidden />
                {pm.common.refresh}
              </Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg bg-surface-panel shadow-surface">
            {projectActivityLoading && projectActivity.length === 0 ? (
              <div className="px-4 py-8 text-sm text-fg-muted">{pm.activity.loading}</div>
            ) : projectActivity.length ? (
              <div className="divide-y divide-edge">
                {projectActivity.map((activity) => {
                  const typeLabel = pm.activity.types[activity.type as keyof typeof pm.activity.types] ?? activity.type;
                  const objectKind = pm.activity.objectKinds[activity.primaryObject.kind] ?? activity.primaryObject.kind;
                  const payloadPreview = activityPayloadPreview(activity);
                  const isRelatedOnly = activity.relatedProjects.length > 0
                    && !activity.scopes.some((scope) => scope.scopeKind === 'project' && scope.scopeId === project.id);
                  return (
                    <article key={activity.id} className="grid gap-2 px-4 py-3">
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="min-w-0 truncate text-sm font-medium text-fg">{typeLabel}</span>
                            {isRelatedOnly ? (
                              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-fg-muted">
                                {pm.activity.related}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 min-w-0 truncate text-sm text-fg-muted">
                            {objectKind}: {activityObjectLabel(activity)}
                          </p>
                        </div>
                        <time className="shrink-0 text-xs text-fg-subtle" dateTime={new Date(activity.createdAt).toISOString()}>
                          {formatDate(activity.createdAt)}
                        </time>
                      </div>
                      {payloadPreview ? (
                        <p className="line-clamp-2 text-sm leading-5 text-fg-muted">{payloadPreview}</p>
                      ) : null}
                      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-fg-subtle">
                        <span className="rounded-md bg-surface-base px-2 py-1">
                          {pm.activity.actor}: {activityActorLabel(activity)}
                        </span>
                        <span className="max-w-full truncate rounded-md bg-surface-base px-2 py-1">
                          {pm.activity.source}: {activitySourceLabel(activity)}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-8 text-sm text-fg-muted">{pm.activity.empty}</div>
            )}
          </div>
        </section>
      ) : null}

      {tab === 'settings' ? (
        <form id="project-panel-settings" role="tabpanel" aria-labelledby="project-primary-tab-settings" onSubmit={saveProject} className="grid min-h-full content-start gap-4">
          <section className="grid gap-3 rounded-lg bg-surface-panel p-4 shadow-surface">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-fg">{pm.settings.summaryTitle}</h2>
                <p className="mt-1 text-sm leading-6 text-fg-muted">{pm.settings.summaryHint}</p>
              </div>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', statusTone(draft.status))}>
                {pm.settings.statuses[draft.status]}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <SettingsMetaItem label={pm.settings.workspaceRoot} value={workspaceRootLabel} mono />
              <SettingsMetaItem label={pm.settings.defaultAgent} value={selectedAgentLabel} />
              <SettingsMetaItem label={pm.settings.pinState} value={projectIsPinned ? pm.settings.pinned : pm.settings.notPinned} />
              <SettingsMetaItem label={pm.settings.createdAt} value={formatDate(project.createdAt) || pm.common.never} />
              <SettingsMetaItem label={pm.settings.updatedAt} value={formatDate(project.updatedAt) || pm.common.never} />
            </div>
          </section>

          <section className="grid gap-4 rounded-lg bg-surface-panel p-4 shadow-surface">
            <div>
              <h2 className="text-sm font-semibold text-fg">{pm.settings.detailsTitle}</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={pm.settings.name}>
                <input className={inputClass()} value={draft.name} onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))} />
              </Field>
              <Field label={pm.settings.defaultAgent}>
                <Select className={inputClass()} value={draft.defaultAgentId} onChange={(event) => setDraft((d) => ({ ...d, defaultAgentId: event.target.value }))}>
                  <SelectOption value="">{pm.settings.globalDefaultAgent}</SelectOption>
                  {agents.map((agent) => (
                    <SelectOption key={agent.id} value={agent.id}>
                      {agentListDisplayName(agent, msg.agentsSettings)}
                    </SelectOption>
                  ))}
                </Select>
              </Field>
              <Field label={pm.settings.status}>
                {projectIsArchived ? (
                  <div className="grid min-h-10 content-center rounded-md border border-edge bg-surface-muted px-3 text-sm text-fg-muted">
                    {pm.settings.statuses.archived}
                  </div>
                ) : (
                  <Select className={inputClass()} value={draft.status === 'archived' ? 'active' : draft.status} onChange={(event) => setDraft((d) => ({ ...d, status: event.target.value as ProjectStatus }))}>
                    <SelectOption value="active">{pm.settings.statuses.active}</SelectOption>
                    <SelectOption value="paused">{pm.settings.statuses.paused}</SelectOption>
                  </Select>
                )}
              </Field>
              <Field label={pm.settings.description} hint={pm.settings.descriptionHint}>
                <textarea className={inputClass(true)} value={draft.description} onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))} />
              </Field>
            </div>
          </section>

          <section className="grid gap-4 rounded-lg bg-surface-panel p-4 shadow-surface">
            <div className="grid gap-2 text-sm">
              <span className="font-medium text-fg-muted">{pm.settings.workspaceRoot}</span>
              <div className="grid gap-3 rounded-md border border-edge bg-surface-base p-3">
                <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs font-medium text-fg-muted">
                        {projectFollowsAgentWorkspace ? pm.settings.workspaceModeFollow : pm.settings.workspaceModeFixed}
                      </span>
                    </div>
                    <div className="mt-2 break-all font-mono text-xs leading-5 text-fg" title={workspaceRootLabel}>
                      {workspaceRootLabel}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button type="button" variant="ghost" className="rounded-lg" onClick={() => void copyProjectWorkspacePath()}>
                      <Copy className="size-4" aria-hidden />
                      {pm.settings.copyWorkspacePath}
                    </Button>
                    <WorkspaceOpenLocationMenu workspacePath={workspaceRootLabel} />
                    <Button type="button" variant="ghost" className="rounded-lg" onClick={openWorkspaceMigration}>
                      <FolderPlus className="size-4" aria-hidden />
                      {pm.settings.migrateWorkspace}
                    </Button>
                  </div>
                </div>
                <p className="text-xs leading-5 text-fg-subtle">{pm.settings.workspaceMigrationHint}</p>
              </div>
            </div>
          </section>

          <section className="grid gap-4 rounded-lg bg-surface-panel p-4 shadow-surface">
            <div>
              <h2 className="text-sm font-semibold text-fg">{pm.settings.projectGuidanceTitle}</h2>
              <p className="mt-1 text-sm leading-6 text-fg-muted">{pm.settings.projectGuidanceHint}</p>
            </div>
            <Field label={pm.settings.brief} hint={pm.settings.briefHint}>
              <textarea className={inputClass(true)} value={draft.brief} onChange={(event) => setDraft((d) => ({ ...d, brief: event.target.value }))} />
            </Field>
            <Field label={pm.settings.instructions} hint={pm.settings.instructionsHint}>
              <textarea className={inputClass(true)} value={draft.instructions} onChange={(event) => setDraft((d) => ({ ...d, instructions: event.target.value }))} />
            </Field>
          </section>

          <section className="grid gap-4 rounded-lg bg-surface-panel p-4 shadow-surface">
            <div>
              <h2 className="text-sm font-semibold text-fg">{pm.settings.managementTitle}</h2>
              <p className="mt-1 text-sm leading-6 text-fg-muted">{pm.settings.managementHint}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-3 rounded-md border border-edge bg-surface-base p-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-fg">{projectIsPinned ? pm.settings.pinnedTitle : pm.settings.pinTitle}</h3>
                  <p className="mt-1 text-xs leading-5 text-fg-subtle">{pm.settings.pinHint}</p>
                </div>
                <Button type="button" variant="ghost" className="w-fit rounded-lg" disabled={projectActionBusy === 'pin'} onClick={() => void toggleProjectPin()}>
                  {projectIsPinned ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}
                  {projectIsPinned ? pm.settings.unpinProject : pm.settings.pinProject}
                </Button>
              </div>
              <div className="grid gap-3 rounded-md border border-edge bg-surface-base p-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-fg">{projectIsArchived ? pm.settings.restoreTitle : pm.settings.archiveTitle}</h3>
                  <p className="mt-1 text-xs leading-5 text-fg-subtle">{projectIsArchived ? pm.settings.restoreHint : pm.settings.archiveHint}</p>
                </div>
                <Button
                  type="button"
                  variant={projectIsArchived ? 'primary' : 'ghost'}
                  className="w-fit rounded-lg"
                  disabled={projectActionBusy === 'archive'}
                  onClick={() => void toggleProjectArchive()}
                >
                  {projectIsArchived ? <RotateCcw className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
                  {projectIsArchived ? pm.settings.restoreProject : pm.settings.archiveProject}
                </Button>
              </div>
            </div>
          </section>

          <section className="grid gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
            <div>
              <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">{pm.settings.dangerTitle}</h2>
              <p className="mt-1 text-sm leading-6 text-red-700/80 dark:text-red-200/80">{pm.settings.dangerHint}</p>
            </div>
            <Button type="button" variant="ghost" className="w-fit text-red-600 hover:bg-red-500/10 hover:text-red-700 focus-visible:ring-red-500 dark:text-red-400 dark:hover:text-red-300" onClick={() => setDeleteConfirmOpen(true)}>
              <Trash2 className="size-4" aria-hidden />
              {pm.settings.deleteConfirmAction}
            </Button>
          </section>

          <div className="flex flex-wrap justify-end gap-2 border-t border-edge pt-4">
            <Button type="submit" variant="primary" disabled={saving || !draft.name.trim()}>
              <Save className="size-4" aria-hidden />
              {pm.common.save}
            </Button>
          </div>
        </form>
      ) : null}
      </div>

      <Dialog.Root
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          if (!deletingProject) setDeleteConfirmOpen(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-5 shadow-float focus:outline-none">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
                <AlertCircle className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-fg">
                  {pm.settings.deleteConfirmTitle}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">
                  {project ? interpolate(pm.settings.deleteConfirm, { name: project.name }) : pm.settings.deleteConfirmFallback}
                </Dialog.Description>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="rounded-lg" disabled={deletingProject}>
                  {pm.common.cancel}
                </Button>
              </Dialog.Close>
              <Button
                type="button"
                variant="ghost"
                className="rounded-lg text-red-600 hover:bg-red-500/10 hover:text-red-700 focus-visible:ring-red-500 dark:text-red-400 dark:hover:text-red-300"
                disabled={deletingProject || !project}
                onClick={() => void removeProject()}
              >
                <Trash2 className="size-4" aria-hidden />
                {pm.settings.deleteConfirmAction}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={workspaceMigrationOpen}
        onOpenChange={(open) => {
          if (!saving) setWorkspaceMigrationOpen(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(34rem,calc(100vh-2rem))] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="shrink-0 border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">{pm.settings.workspaceMigrationTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">
                {pm.settings.workspaceMigrationDescription}
              </Dialog.Description>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="grid gap-2 text-sm">
                <span className="font-medium text-fg-muted">{pm.settings.workspaceMode}</span>
                <div className="grid gap-2 md:grid-cols-2">
                  <label className={cn('flex min-h-10 items-start gap-2 rounded-md border px-3 py-2', workspaceMigrationMode === 'fixed' ? 'border-accent bg-accent-soft/40 text-fg' : 'border-edge bg-surface-base text-fg-muted')}>
                    <input
                      type="radio"
                      className="mt-0.5 size-4"
                      checked={workspaceMigrationMode === 'fixed'}
                      onChange={() => setWorkspaceMigrationMode('fixed')}
                      disabled={saving}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{pm.settings.workspaceModeFixed}</span>
                      <span className="block text-xs leading-5 text-fg-subtle">{pm.settings.workspaceMigrationFixedHint}</span>
                    </span>
                  </label>
                  <label className={cn('flex min-h-10 items-start gap-2 rounded-md border px-3 py-2', workspaceMigrationMode === 'follow' ? 'border-accent bg-accent-soft/40 text-fg' : 'border-edge bg-surface-base text-fg-muted')}>
                    <input
                      type="radio"
                      className="mt-0.5 size-4"
                      checked={workspaceMigrationMode === 'follow'}
                      onChange={() => setWorkspaceMigrationMode('follow')}
                      disabled={saving}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{pm.settings.workspaceModeFollow}</span>
                      <span className="block text-xs leading-5 text-fg-subtle">{pm.settings.workspaceHint}</span>
                    </span>
                  </label>
                </div>
              </div>
              {workspaceMigrationMode === 'fixed' ? (
                <DirectoryPickerPathField
                  value={workspaceMigrationRoot}
                  onChange={setWorkspaceMigrationRoot}
                  disabled={saving}
                  wd={wd}
                  placeholder={pm.settings.workspacePlaceholder}
                  inputClassName={inputClass()}
                  autoFocus
                />
              ) : null}
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm leading-6 text-amber-800 dark:text-amber-200">
                {pm.settings.workspaceMigrationImpact}
              </div>
              <div className="rounded-lg bg-surface-muted px-3 py-2 text-xs leading-5 text-fg-subtle">
                {interpolate(pm.settings.workspaceCurrent, { workspace: workspaceMigrationPreview })}
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-4">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="rounded-lg" disabled={saving}>
                  {pm.common.cancel}
                </Button>
              </Dialog.Close>
              <Button type="button" variant="primary" className="rounded-lg" disabled={saving || !workspaceMigrationCanSubmit} onClick={() => void submitWorkspaceMigration()}>
                <FolderPlus className="size-4" aria-hidden />
                {pm.settings.workspaceMigrationConfirm}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(missingWorkspaceRoot)} onOpenChange={(open) => {
        if (!open) setMissingWorkspaceRoot(null);
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">{pm.settings.workspaceMissingTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">
                {missingWorkspaceRoot
                  ? interpolate(pm.settings.workspaceMissingDescription, { workspace: missingWorkspaceRoot })
                  : null}
              </Dialog.Description>
            </div>
            {missingWorkspaceRoot ? (
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg-muted">
                  <Folder className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                  <span className="min-w-0 truncate">{missingWorkspaceRoot}</span>
                </div>
              </div>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-edge px-5 py-4">
              <Button type="button" variant="ghost" className="rounded-lg" onClick={returnToWorkspaceMigrationFromMissingWorkspace} disabled={saving}>
                {pm.settings.workspaceMissingBack}
              </Button>
              <Button type="button" variant="primary" className="rounded-lg" onClick={() => void submitWorkspaceMigration({ createWorkspaceRoot: true })} disabled={saving}>
                <FolderPlus className="size-4" aria-hidden />
                {pm.settings.workspaceMissingCreate}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <GoalCreateDialog
        open={createGoalOpen}
        t={msg.goalsPage}
        chat={msg.chat}
        busy={creatingGoal}
        options={createGoalOptions}
        onClose={() => !creatingGoal && setCreateGoalOpen(false)}
        onCreate={submitGoal}
      />

    </main>
  );
}
