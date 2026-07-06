import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { Activity, AlertCircle, ArrowLeft, Check, CheckCircle2, ChevronDown, ChevronRight, Clock, File, Folder, LayoutDashboard, MessageSquarePlus, Pause, Play, Plus, RotateCcw, Save, Search, Settings, Square, Target, Trash2, Zap, type LucideIcon } from 'lucide-react';
import { type FormEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { PageTabs } from '@/components/ui/page-tabs';
import { automationApi, type Automation, type AutomationRun } from '@/features/automations/automation-api';
import { fetchConfiguredModelsCached } from '@/features/chat/api/registry-api';
import { DirectoryPickerPathField } from '@/features/fs/directory-picker-path-field';
import { fetchGatewayConfigSwrResponse } from '@/features/gateway/gateway-config-swr';
import { GoalCreateDialog, normalizeChecklist, type CreateGoalDraft, type GoalCreateOptions } from '@/features/goals/goal-create-dialog';
import { NotesWorkbench } from '@/features/notes/notes-workbench';
import {
  addProjectGoalChecklistItem,
  createProjectBlocker,
  createProjectSession,
  createProjectGoal,
  createProject,
  deleteProject,
  fetchProjectFiles,
  fetchProjectGoals,
  fetchProjectOverview,
  fetchProjects,
  fetchProjectSessions,
  saveProjectDigest,
  updateProject,
  type Project,
  type ProjectFileEntry,
  type ProjectGoal,
  type ProjectOverview,
  type ProjectSession,
  type ProjectStatus,
  type ProjectWithDetails,
} from '@/features/projects/api';
import { fetchGatewayAgents, type GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { normalizeGoalsConfigFromConfig } from '@/features/settings/goals-config-api';
import {
  cancelWorkflowRun,
  listWorkflowDefinitions,
  listWorkflowRuns,
  retryWorkflowRun,
  startWorkflowRun,
  type WorkflowDefinition,
  type WorkflowRunSummary,
} from '@/features/workflows/workflow-api';
import { WorkflowStartDialog } from '@/features/workflows/workflow-start-dialog';
import { workflowBoardHref } from '@/features/workflows/workflow-page.utils';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

type TabId = 'overview' | 'workflows' | 'automations' | 'notes' | 'files' | 'sessions' | 'goals' | 'settings';

const TABS: Array<{ id: TabId; icon: LucideIcon }> = [
  { id: 'overview', icon: LayoutDashboard },
  { id: 'sessions', icon: MessageSquarePlus },
  { id: 'goals', icon: Target },
  { id: 'workflows', icon: Play },
  { id: 'files', icon: Folder },
  { id: 'automations', icon: Zap },
  { id: 'notes', icon: File },
  { id: 'settings', icon: Settings },
];

const DEFAULT_PROJECT_TAB_ORDER = TABS.map((tab) => tab.id);
const PROJECT_TAB_IDS = new Set<TabId>(TABS.map((tab) => tab.id));
const PROJECT_TAB_STORAGE_PREFIX = 'xopc.projectTabs.';

function isProjectTabId(value: string | undefined): value is TabId {
  return Boolean(value && PROJECT_TAB_IDS.has(value as TabId));
}

function projectTabStorageKey(projectId: string): string {
  return `${PROJECT_TAB_STORAGE_PREFIX}${projectId}`;
}

function normalizeProjectTabOrder(value: unknown): TabId[] {
  const input = Array.isArray(value) ? value : [];
  const seen = new Set<TabId>();
  const order: TabId[] = [];
  for (const item of input) {
    if (!isProjectTabId(item) || seen.has(item)) continue;
    seen.add(item);
    order.push(item);
  }
  for (const item of DEFAULT_PROJECT_TAB_ORDER) {
    if (!seen.has(item)) order.push(item);
  }
  return order;
}

function loadProjectTabOrder(projectId: string): TabId[] {
  if (!projectId) return DEFAULT_PROJECT_TAB_ORDER;
  try {
    const stored = window.localStorage.getItem(projectTabStorageKey(projectId));
    return normalizeProjectTabOrder(stored ? JSON.parse(stored) : null);
  } catch {
    return DEFAULT_PROJECT_TAB_ORDER;
  }
}

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''));
}

function formatDate(value?: string | number, fallback = ''): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatBytes(value?: number): string {
  if (value === undefined) return '';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function inputClass(multiline = false): string {
  return cn(
    'w-full rounded-md border border-edge bg-surface-base px-3 text-sm text-fg outline-none focus:border-accent',
    multiline ? 'min-h-24 py-2 leading-5' : 'min-h-10',
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
    project.workspaceRoot || project.description || project.brief || pm.common.defaultWorkspace;

  const openCreateDialog = (mode: 'new' | 'directory') => {
    setCreateMode(mode);
    setName('');
    setWorkspaceRoot('');
    setCreateError(null);
    setCreateOpen(true);
    setOpen(false);
  };

  const onCreate = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedWorkspace = workspaceRoot.trim();
    const trimmedName = name.trim() || (createMode === 'directory' ? directoryName(trimmedWorkspace) : '');
    if (!trimmedName) return;
    setCreating(true);
    setCreateError(null);
    try {
      const project = await createProject({
        name: trimmedName,
        ...(trimmedWorkspace ? { workspaceRoot: trimmedWorkspace } : {}),
      });
      setCreateOpen(false);
      setName('');
      setWorkspaceRoot('');
      setProjects((items) => [project, ...items.filter((item) => item.id !== project.id)]);
      navigate(`/projects/${encodeURIComponent(project.id)}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [createMode, name, navigate, workspaceRoot]);

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
        'grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
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
            className="group -ml-2 flex max-w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
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
                <div className="px-2 py-2 text-xs text-red-600 dark:text-red-400">{loadError}</div>
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
                    autoFocus
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
  const [goals, setGoals] = useState<ProjectGoal[]>([]);
  const [workflowDefinitions, setWorkflowDefinitions] = useState<WorkflowDefinition[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunSummary[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [automationRuns, setAutomationRuns] = useState<AutomationRun[]>([]);
  const [automationsLoading, setAutomationsLoading] = useState(false);
  const [automationActionBusy, setAutomationActionBusy] = useState<string | null>(null);
  const [savingDigest, setSavingDigest] = useState(false);
  const [filePath, setFilePath] = useState('');
  const [fileEntries, setFileEntries] = useState<ProjectFileEntry[]>([]);
  const [fileParentPath, setFileParentPath] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [agents, setAgents] = useState<GatewayAgentRow[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [startingWorkflow, setStartingWorkflow] = useState(false);
  const [workflowActionBusy, setWorkflowActionBusy] = useState<string | null>(null);
  const [workflowStartDefinition, setWorkflowStartDefinition] = useState<WorkflowDefinition | null>(null);
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
  const [tabOrder, setTabOrder] = useState<TabId[]>(() => loadProjectTabOrder(projectId));
  const [draft, setDraft] = useState({
    name: '',
    description: '',
    status: 'active' as ProjectStatus,
    defaultAgentId: '',
    workspaceRoot: '',
    brief: '',
    instructions: '',
  });
  const defaultTab = tabOrder[0] ?? DEFAULT_PROJECT_TAB_ORDER[0];
  const tab = noteId ? 'notes' : isProjectTabId(tabId) ? tabId : defaultTab;

  const navigateProjectTab = useCallback((nextTab: TabId) => {
    if (!projectId) return;
    navigate(`/projects/${encodeURIComponent(projectId)}/${nextTab}`);
  }, [navigate, projectId]);

  useEffect(() => {
    if (!projectId || !tabId || isProjectTabId(tabId)) return;
    navigate(`/projects/${encodeURIComponent(projectId)}/${defaultTab}`, { replace: true });
  }, [defaultTab, navigate, projectId, tabId]);

  useEffect(() => {
    setTabOrder(loadProjectTabOrder(projectId));
  }, [projectId]);

  const reorderProjectTabs = useCallback((draggedId: TabId, targetId: TabId, position: 'before' | 'after' = 'before') => {
    if (draggedId === targetId) return;
    setTabOrder((current) => {
      const next = normalizeProjectTabOrder(current);
      const from = next.indexOf(draggedId);
      const to = next.indexOf(targetId);
      if (from < 0 || to < 0) return next;
      const [moved] = next.splice(from, 1);
      const targetIndex = next.indexOf(targetId);
      if (targetIndex < 0) return normalizeProjectTabOrder(current);
      next.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, moved);
      if (projectId) {
        window.localStorage.setItem(projectTabStorageKey(projectId), JSON.stringify(next));
      }
      return next;
    });
  }, [projectId]);

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
    if (!project?.workspaceRoot?.trim()) {
      setFileEntries([]);
      setFileParentPath(null);
      setFilesError(null);
      return;
    }
    setFilesLoading(true);
    setFilesError(null);
    try {
      const result = await fetchProjectFiles(project.id, filePath);
      setFileEntries(result.entries);
      setFilePath(result.path);
      setFileParentPath(result.parentPath);
    } catch (err) {
      setFileEntries([]);
      setFileParentPath(null);
      setFilesError(err instanceof Error ? err.message : String(err));
    } finally {
      setFilesLoading(false);
    }
  }, [filePath, project]);

  useEffect(() => {
    if (tab !== 'files') return;
    void refreshProjectFiles();
  }, [refreshProjectFiles, tab]);

  const startChat = useCallback(async () => {
    if (!project) return;
    setStartingChat(true);
    setError(null);
    try {
      const session = await createProjectSession(project.id, selectedAgentId || undefined);
      navigate(`/chat/${encodeURIComponent(session.key)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStartingChat(false);
    }
  }, [navigate, project, selectedAgentId]);

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
      const goal = await createProjectGoal(project.id, {
        title: goalDraft.title.trim(),
        description: goalDraft.description.trim() || undefined,
        attachments: goalDraft.attachments.length ? goalDraft.attachments : undefined,
        priority: goalDraft.priority,
        deadlineAt: Number.isFinite(deadlineAt) ? deadlineAt : undefined,
        maxTurns: Number.isFinite(maxTurns) ? maxTurns : undefined,
        agentId: goalDraft.agentId.trim() || undefined,
        judgeModelRef: goalDraft.judgeModelRef.trim() || undefined,
      });
      for (const item of normalizeChecklist(goalDraft.checklist)) {
        await addProjectGoalChecklistItem(goal.id, item);
      }
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

  const submitWorkflowStart = useCallback(async (payload: { goal: string; input?: unknown; concurrency?: number; maxSubagents?: number }) => {
    if (!project || !workflowStartDefinition) return;
    setStartingWorkflow(true);
    setError(null);
    try {
      const result = await startWorkflowRun({
        definitionId: workflowStartDefinition.id,
        projectId: project.id,
        agentId: selectedAgentId || undefined,
        goal: payload.goal,
        input: payload.input,
        concurrency: payload.concurrency,
        maxSubagents: payload.maxSubagents,
      });
      setWorkflowStartDefinition(null);
      await refreshProjectWorkflows();
      navigate(workflowBoardHref(result.runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStartingWorkflow(false);
    }
  }, [navigate, project, refreshProjectWorkflows, selectedAgentId, workflowStartDefinition]);

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
      navigate(workflowBoardHref(result.runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkflowActionBusy(null);
    }
  }, [navigate, project, refreshProjectWorkflows, selectedAgentId]);

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
        <select
          className="h-9 rounded-lg border border-edge bg-surface-muted px-3 text-sm text-fg outline-none focus:border-accent"
          value={selectedAgentId}
          onChange={(event) => setSelectedAgentId(event.target.value)}
          aria-label={pm.common.agent}
        >
          <option value="">{pm.common.defaultAgent}</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name || agent.id}
            </option>
          ))}
        </select>
        <Button variant="primary" className="h-9 rounded-lg" onClick={() => void startChat()} disabled={startingChat}>
          <MessageSquarePlus className="size-4" aria-hidden />
          {pm.common.newChat}
        </Button>
      </>
    ) : null,
    [agents, pm.common.agent, pm.common.defaultAgent, pm.common.newChat, project, selectedAgentId, startChat, startingChat],
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

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project || !draft.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProject(project.id, {
        name: draft.name.trim(),
        status: draft.status,
        description: draft.description,
        defaultAgentId: draft.defaultAgentId,
        workspaceRoot: draft.workspaceRoot,
        brief: draft.brief,
        instructions: draft.instructions,
      });
      setProject((current) => current ? { ...current, ...updated } : null);
      setOverview((current) => current ? { ...current, project: { ...current.project, ...updated } } : null);
      setSelectedAgentId(updated.defaultAgentId ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeProject() {
    if (!project) return;
    const ok = window.confirm(interpolate(pm.settings.deleteConfirm, { name: project.name }));
    if (!ok) return;
    setError(null);
    try {
      await deleteProject(project.id);
      navigate('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

  if (loading) {
    return <main className="w-full flex-1 px-3 py-3 text-sm text-fg-muted sm:px-5 sm:py-4 xl:px-6">{pm.loading}</main>;
  }

  if (!project) {
    return (
      <main className="w-full flex-1 px-3 py-3 sm:px-5 sm:py-4 xl:px-6">
        <Link to="/projects" className="inline-flex items-center gap-2 text-sm text-accent-fg hover:underline">
          <ArrowLeft className="size-4" aria-hidden />
          {pm.backToProjects}
        </Link>
        <p className="mt-6 rounded-lg border border-edge bg-surface-panel p-4 text-sm text-fg-muted">
          {error || pm.notFound}
        </p>
      </main>
    );
  }

  const overviewSessions = overview?.recentSessions.length ? overview.recentSessions : project.recentSessions;
  const overviewWorkflowRuns = overview?.recentWorkflowRuns.length ? overview.recentWorkflowRuns : project.recentWorkflowRuns;
  const overviewAttentionItems = overview?.attentionItems ?? [];
  const overviewTimeline = overview?.timeline ?? [];
  const fileCrumbs = filePath ? filePath.split('/').filter(Boolean) : [];
  const statusLabel = (status: string) => pm.statuses[status as keyof typeof pm.statuses] ?? status;
  const messageCount = (count: number) => interpolate(pm.common.messages, { count });
  const tabItems = tabOrder.map((id) => {
    const item = TABS.find((candidate) => candidate.id === id)!;
    return { ...item, label: pm.tabs[item.id] };
  });

  return (
    <main className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden px-3 py-3 sm:px-5 sm:py-4 xl:px-6">
      <PageTabs
        items={tabItems}
        activeTab={tab}
        onChange={navigateProjectTab}
        onReorder={reorderProjectTabs}
        ariaLabel={pm.navAria}
        tabIdPrefix="project-tab"
        panelIdPrefix="project-panel"
        className="shrink-0"
      />

      {error ? <p className="mt-3 shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}

      <div
        className={cn(
          'mt-3 min-h-0 flex-1',
          tab === 'overview' ? 'overflow-hidden' : 'overflow-y-auto pr-1 [scrollbar-gutter:stable]',
        )}
      >
      {tab === 'overview' ? (
        <section id="project-panel-overview" role="tabpanel" aria-labelledby="project-tab-overview" className="grid h-full min-h-0 overflow-hidden gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="grid min-h-0 min-w-0 content-start gap-4 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
            <div className="min-w-0 rounded-lg border border-edge bg-surface-panel p-4">
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
              <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <div className="min-w-0 rounded-md border border-edge bg-surface-base px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
                    <MessageSquarePlus className="size-3.5" aria-hidden />
                    <span className="min-w-0 truncate">{pm.overview.sessions}</span>
                  </div>
                  <p className="mt-1 text-xl font-semibold text-fg">{overview?.stats.sessionCount ?? project.sessionCount}</p>
                </div>
                <div className="min-w-0 rounded-md border border-edge bg-surface-base px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
                    <Target className="size-3.5" aria-hidden />
                    <span className="min-w-0 truncate">{pm.overview.activeGoals}</span>
                  </div>
                  <p className="mt-1 text-xl font-semibold text-fg">{overview?.stats.activeGoalCount ?? project.activeGoalCount}</p>
                </div>
                <div className="min-w-0 rounded-md border border-edge bg-surface-base px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
                    <AlertCircle className="size-3.5" aria-hidden />
                    <span className="min-w-0 truncate">{pm.overview.attention}</span>
                  </div>
                  <p className="mt-1 text-xl font-semibold text-fg">{overview?.stats.attentionCount ?? overviewAttentionItems.length}</p>
                </div>
                <div className="min-w-0 rounded-md border border-edge bg-surface-base px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
                    <Clock className="size-3.5" aria-hidden />
                    <span className="min-w-0 truncate">{pm.overview.staleGoals}</span>
                  </div>
                  <p className="mt-1 text-xl font-semibold text-fg">{overview?.stats.staleGoalCount ?? overview?.staleGoals?.length ?? 0}</p>
                </div>
                <div className="min-w-0 rounded-md border border-edge bg-surface-base px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
                    <Activity className="size-3.5" aria-hidden />
                    <span className="min-w-0 truncate">{pm.overview.recentWorkflowRuns}</span>
                  </div>
                  <p className="mt-1 text-xl font-semibold text-fg">{overview?.stats.recentWorkflowRunCount ?? project.recentWorkflowRuns.length}</p>
                </div>
              </div>
            </div>

            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0 rounded-lg border border-edge bg-surface-panel">
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
                      to={`/goals/${encodeURIComponent(item.goalId)}`}
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

              <div className="min-w-0 rounded-lg border border-edge bg-surface-panel">
                <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
                  <h2 className="text-sm font-semibold text-fg">{pm.overview.activeGoals}</h2>
                  <button type="button" className="text-xs font-medium text-accent-fg hover:underline" onClick={() => navigateProjectTab('goals')}>
                    {pm.common.viewAll}
                  </button>
                </div>
                <div className="divide-y divide-edge">
                  {overview?.activeGoals.length ? overview.activeGoals.map((goal) => (
                    <Link key={goal.id} to={`/goals/${encodeURIComponent(goal.id)}`} className="block px-4 py-3 hover:bg-surface-hover">
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium text-fg">{goal.title}</span>
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', statusTone(goal.status))}>{statusLabel(goal.status)}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-fg-muted">{goal.nextAction || goal.description || pm.overview.noNextAction}</p>
                    </Link>
                  )) : (
                    <div className="px-4 py-6 text-sm text-fg-muted">{pm.overview.noActiveGoals}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0 rounded-lg border border-edge bg-surface-panel">
                <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
                  <Clock className="size-4 text-fg-muted" aria-hidden />
                  <h2 className="text-sm font-semibold text-fg">{pm.overview.recentSessions}</h2>
                </div>
                <div className="divide-y divide-edge">
                  {overviewSessions.length ? overviewSessions.map((session) => (
                    <Link key={session.key} to={`/chat/${encodeURIComponent(session.key)}`} className="block px-4 py-3 hover:bg-surface-hover">
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

              <div className="min-w-0 rounded-lg border border-edge bg-surface-panel">
                <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
                  <CheckCircle2 className="size-4 text-fg-muted" aria-hidden />
                  <h2 className="text-sm font-semibold text-fg">{pm.overview.workflowRuns}</h2>
                </div>
                <div className="divide-y divide-edge">
                  {overviewWorkflowRuns.length ? overviewWorkflowRuns.map((run) => (
                    <div key={run.runId} className="px-4 py-3">
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium text-fg">{run.definitionId}</span>
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', workflowStatusTone(run.status))}>{statusLabel(run.status)}</span>
                      </div>
                      <p className="mt-1 text-xs text-fg-muted">{formatDate(run.createdAt)}</p>
                    </div>
                  )) : (
                    <div className="px-4 py-6 text-sm text-fg-muted">{pm.overview.noWorkflowRuns}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="min-w-0 rounded-lg border border-edge bg-surface-panel">
              <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
                <Activity className="size-4 text-fg-muted" aria-hidden />
                <h2 className="text-sm font-semibold text-fg">{pm.overview.timeline}</h2>
              </div>
              <div className="divide-y divide-edge">
                {overviewTimeline.length ? overviewTimeline.map((item) => {
                  const content = (
                    <>
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium text-fg">{item.title}</span>
                        <span className="shrink-0 text-xs text-fg-subtle">{formatDate(item.timestamp)}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-fg-muted">
                        {pm.overview.timelineKinds[item.kind] ?? item.kind}
                        {item.detail ? ` · ${item.detail}` : ''}
                      </p>
                    </>
                  );
                  return item.href ? (
                    <Link key={item.id} to={item.href} className="block px-4 py-3 hover:bg-surface-hover">
                      {content}
                    </Link>
                  ) : (
                    <div key={item.id} className="px-4 py-3">{content}</div>
                  );
                }) : (
                  <div className="px-4 py-6 text-sm text-fg-muted">{pm.overview.noTimeline}</div>
                )}
              </div>
            </div>
          </div>

          <aside className="grid min-h-0 min-w-0 content-start gap-4 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
            <div className="min-w-0 rounded-lg border border-edge bg-surface-panel p-4">
              <h2 className="text-sm font-semibold text-fg">{pm.overview.workspace}</h2>
              <p className="mt-2 break-all text-sm leading-5 text-fg-muted">{project.workspaceRoot || pm.common.defaultWorkspace}</p>
              <p className="mt-3 text-xs text-fg-subtle">{interpolate(pm.common.updated, { time: formatDate(project.updatedAt) })}</p>
            </div>
            <div className="min-w-0 rounded-lg border border-edge bg-surface-panel p-4">
              <h2 className="text-sm font-semibold text-fg">{pm.overview.brief}</h2>
              <p className="mt-2 break-words whitespace-pre-wrap text-sm leading-6 text-fg-muted">{project.brief || pm.overview.noBrief}</p>
            </div>
            <div className="min-w-0 rounded-lg border border-edge bg-surface-panel p-4">
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
                      <Link key={item.id} to={item.href} className="min-w-0 rounded-md border border-edge bg-surface-base p-3 hover:bg-surface-hover">
                        {content}
                      </Link>
                    ) : (
                      <div key={item.id} className="min-w-0 rounded-md border border-edge bg-surface-base p-3">
                        {content}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-sm text-fg-muted">{pm.overview.noBlockedGoals}</p>
              )}
              <form onSubmit={submitBlocker} className="mt-4 grid gap-2 border-t border-edge pt-4">
                <input
                  className="min-h-9 rounded-md border border-edge bg-surface-base px-3 text-sm text-fg outline-none focus:border-accent"
                  value={blockerDraft.title}
                  onChange={(event) => setBlockerDraft((draft) => ({ ...draft, title: event.target.value }))}
                  placeholder={pm.overview.blockerTitlePlaceholder}
                />
                <textarea
                  className="min-h-20 rounded-md border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                  value={blockerDraft.reason}
                  onChange={(event) => setBlockerDraft((draft) => ({ ...draft, reason: event.target.value }))}
                  placeholder={pm.overview.blockerReasonPlaceholder}
                />
                <Button type="submit" variant="secondary" className="justify-self-start rounded-lg" disabled={creatingBlocker || !blockerDraft.title.trim()}>
                  <Plus className="size-4" aria-hidden />
                  {creatingBlocker ? pm.overview.addingBlocker : pm.overview.addBlocker}
                </Button>
              </form>
            </div>
          </aside>
        </section>
      ) : null}

      {tab === 'workflows' ? (
        <section id="project-panel-workflows" role="tabpanel" aria-labelledby="project-tab-workflows" className="grid h-full min-h-[28rem] gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-h-0">
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-edge bg-surface-panel">
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
                          onClick={() => navigate(workflowBoardHref(run.id))}
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
                            onClick={() => navigate(workflowBoardHref(run.id))}
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
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-edge bg-surface-panel">
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
                    className="grid gap-1 rounded-md border border-edge bg-surface-base p-3 text-left hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-accent/30"
                    onClick={() => setWorkflowStartDefinition(definition)}
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
        <section id="project-panel-automations" role="tabpanel" aria-labelledby="project-tab-automations" className="grid h-full min-h-[28rem] overflow-hidden gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-edge bg-surface-panel">
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
                <Button type="button" variant="primary" className="h-9 rounded-lg" onClick={() => navigate(`/automations?projectId=${encodeURIComponent(project.id)}&action=create`)}>
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
                        onClick={() => navigate(`/automations?automation=${encodeURIComponent(automation.id)}`)}
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
                    <Button type="button" variant="secondary" className="rounded-lg" onClick={() => navigate(`/automations?projectId=${encodeURIComponent(project.id)}&action=create`)}>
                      <Zap className="size-4" aria-hidden />
                      {pm.automations.create}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <aside className="grid min-h-0 min-w-0 content-start gap-4 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
            <div className="rounded-lg border border-edge bg-surface-panel">
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
            <div className="rounded-lg border border-edge bg-surface-panel p-4">
              <h2 className="text-sm font-semibold text-fg">{pm.automations.contextTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-fg-muted">{pm.automations.contextHint}</p>
              <p className="mt-3 break-all text-xs text-fg-subtle">{project.workspaceRoot || pm.common.defaultWorkspace}</p>
            </div>
          </aside>
        </section>
      ) : null}

      {tab === 'notes' ? (
        <section id="project-panel-notes" role="tabpanel" aria-labelledby="project-tab-notes" className="flex h-full min-h-[28rem] overflow-hidden rounded-lg border border-edge bg-surface-panel">
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
        <section id="project-panel-files" role="tabpanel" aria-labelledby="project-tab-files" className="h-full min-h-[28rem]">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-edge bg-surface-panel">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-fg">{pm.files.title}</h2>
                <p className="truncate text-xs text-fg-muted">{project.workspaceRoot || pm.files.noWorkspace}</p>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-fg-subtle">{pm.files.boundaryHint}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 rounded-lg"
                  onClick={() => void refreshProjectFiles()}
                  disabled={filesLoading || !project.workspaceRoot}
                >
                  <RotateCcw className="size-4" aria-hidden />
                  {pm.common.refresh}
                </Button>
                <Button type="button" variant="primary" className="h-9 rounded-lg" onClick={() => navigateProjectTab('workflows')}>
                  <Play className="size-4" aria-hidden />
                  {pm.tabs.workflows}
                </Button>
              </div>
            </div>

            {project.workspaceRoot ? (
              <>
                <div className="flex min-h-10 flex-wrap items-center gap-1 border-b border-edge bg-surface-muted/50 px-3 py-1.5 text-sm">
                  <button
                    type="button"
                    className={cn('rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg', !filePath && 'bg-surface-hover text-fg')}
                    onClick={() => setFilePath('')}
                  >
                    {pm.common.root}
                  </button>
                  {fileCrumbs.map((crumb, index) => {
                    const crumbPath = fileCrumbs.slice(0, index + 1).join('/');
                    return (
                      <span key={crumbPath} className="inline-flex items-center gap-1">
                        <ChevronRight className="size-3.5 text-fg-subtle" aria-hidden />
                        <button
                          type="button"
                          className={cn('max-w-40 truncate rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg', index === fileCrumbs.length - 1 && 'bg-surface-hover text-fg')}
                          onClick={() => setFilePath(crumbPath)}
                        >
                          {crumb}
                        </button>
                      </span>
                    );
                  })}
                </div>

                {filesError ? (
                  <div className="border-b border-edge bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{filesError}</div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto py-1">
                  {fileParentPath !== null ? (
                    <button
                      type="button"
                      className="grid h-8 w-full grid-cols-[minmax(0,1fr)_5rem] items-center gap-3 px-3 text-left text-sm hover:bg-surface-hover sm:grid-cols-[minmax(0,1fr)_8rem_10rem]"
                      onClick={() => setFilePath(fileParentPath)}
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-fg">
                        <ChevronRight className="size-3.5 shrink-0 rotate-180 text-fg-subtle" aria-hidden />
                        <Folder className="size-4 shrink-0 text-accent-fg" aria-hidden />
                        <span className="truncate font-medium">..</span>
                      </span>
                      <span className="text-xs text-fg-subtle">{pm.common.folder}</span>
                      <span className="hidden sm:block" />
                    </button>
                  ) : null}
                  {filesLoading && fileEntries.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-fg-muted">{pm.files.loading}</div>
                  ) : fileEntries.length ? fileEntries.map((entry) => {
                    const isDirectory = entry.type === 'directory';
                    const Icon = isDirectory ? Folder : File;
                    return (
                      <button
                        key={entry.path}
                        type="button"
                        className={cn(
                          'grid h-8 w-full grid-cols-[minmax(0,1fr)_5rem] items-center gap-3 px-3 text-left text-sm sm:grid-cols-[minmax(0,1fr)_8rem_10rem]',
                          isDirectory ? 'hover:bg-surface-hover' : 'cursor-default',
                        )}
                        onClick={() => {
                          if (isDirectory) setFilePath(entry.path);
                        }}
                      >
                        <span className="flex min-w-0 items-center gap-1.5 text-fg">
                          <ChevronRight className={cn('size-3.5 shrink-0 text-fg-subtle', !isDirectory && 'opacity-0')} aria-hidden />
                          <Icon className={cn('size-4 shrink-0', isDirectory ? 'text-accent-fg' : 'text-fg-muted')} aria-hidden />
                          <span className={cn('truncate', isDirectory && 'font-medium')}>{entry.name}</span>
                        </span>
                        <span className="text-xs text-fg-subtle">{isDirectory ? pm.common.folder : formatBytes(entry.size)}</span>
                        <span className="hidden truncate text-right text-xs text-fg-subtle sm:block">{formatDate(entry.updatedAt)}</span>
                      </button>
                    );
                  }) : (
                    <div className="px-4 py-6 text-sm text-fg-muted">{pm.files.emptyDirectory}</div>
                  )}
                </div>
              </>
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
        <section id="project-panel-sessions" role="tabpanel" aria-labelledby="project-tab-sessions" className="grid min-h-full content-start">
          <div className="overflow-hidden rounded-lg border border-edge bg-surface-panel">
            {sessions.length ? sessions.map((session) => {
              const updatedAt = formatDate(session.updatedAt);
              const agentLabel = session.routing?.agentId || session.agentId || pm.common.agent;
              const metaText = updatedAt
                ? interpolate(pm.sessions.metaWithTime, {
                  agent: agentLabel,
                  messages: messageCount(session.messageCount ?? 0),
                  time: updatedAt,
                })
                : interpolate(pm.sessions.meta, {
                  agent: agentLabel,
                  messages: messageCount(session.messageCount ?? 0),
                });
              return (
                <article
                  key={session.key}
                  className="grid gap-3 border-b border-edge px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-hover/50 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <Link
                    to={`/chat/${encodeURIComponent(session.key)}`}
                    className="min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:col-span-2"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium text-fg">{session.name || session.key}</span>
                      {updatedAt ? <span className="hidden shrink-0 text-xs text-fg-subtle md:block">{updatedAt}</span> : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-fg-muted">{metaText}</p>
                  </Link>
                </article>
              );
            }) : (
              <div className="grid gap-1 px-4 py-8 text-center">
                <div>
                  <h3 className="text-sm font-semibold text-fg">{pm.sessions.emptyTitle}</h3>
                  <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-fg-muted">{pm.sessions.emptyDescription}</p>
                </div>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {tab === 'goals' ? (
        <section id="project-panel-goals" role="tabpanel" aria-labelledby="project-tab-goals" className="grid min-h-full content-start gap-3">
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
          <div className="overflow-hidden rounded-lg border border-edge bg-surface-panel">
            {goals.length ? goals.map((goal) => (
              <Link
                key={goal.id}
                to={`/goals/${encodeURIComponent(goal.id)}`}
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

      {tab === 'settings' ? (
        <form id="project-panel-settings" role="tabpanel" aria-labelledby="project-tab-settings" onSubmit={saveProject} className="grid min-h-full content-start gap-4 rounded-lg border border-edge bg-surface-panel p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={pm.settings.name}>
              <input className={inputClass()} value={draft.name} onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))} />
            </Field>
            <Field label={pm.settings.status}>
              <select className={inputClass()} value={draft.status} onChange={(event) => setDraft((d) => ({ ...d, status: event.target.value as ProjectStatus }))}>
                <option value="active">{pm.settings.statuses.active}</option>
                <option value="paused">{pm.settings.statuses.paused}</option>
                <option value="archived">{pm.settings.statuses.archived}</option>
              </select>
            </Field>
            <Field label={pm.settings.defaultAgent}>
              <select className={inputClass()} value={draft.defaultAgentId} onChange={(event) => setDraft((d) => ({ ...d, defaultAgentId: event.target.value }))}>
                <option value="">{pm.settings.globalDefaultAgent}</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name || agent.id}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={pm.settings.description}>
            <input className={inputClass()} value={draft.description} onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))} />
          </Field>
          <Field label={pm.settings.workspaceRoot}>
            <DirectoryPickerPathField
              value={draft.workspaceRoot}
              onChange={(workspaceRoot) => setDraft((d) => ({ ...d, workspaceRoot }))}
              disabled={saving}
              wd={wd}
              placeholder={pm.settings.workspacePlaceholder}
              inputClassName={inputClass()}
            />
          </Field>
          <Field label={pm.settings.brief}>
            <textarea className={inputClass(true)} value={draft.brief} onChange={(event) => setDraft((d) => ({ ...d, brief: event.target.value }))} />
          </Field>
          <Field label={pm.settings.instructions}>
            <textarea className={inputClass(true)} value={draft.instructions} onChange={(event) => setDraft((d) => ({ ...d, instructions: event.target.value }))} />
          </Field>
          <div className="flex flex-wrap justify-between gap-2 border-t border-edge pt-4">
            <Button type="button" variant="ghost" onClick={() => void removeProject()}>
              <Trash2 className="size-4" aria-hidden />
              {pm.common.delete}
            </Button>
            <Button type="submit" variant="primary" disabled={saving || !draft.name.trim()}>
              <Save className="size-4" aria-hidden />
              {pm.common.save}
            </Button>
          </div>
        </form>
      ) : null}
      </div>

      <GoalCreateDialog
        open={createGoalOpen}
        t={msg.goalsPage}
        chat={msg.chat}
        busy={creatingGoal}
        options={createGoalOptions}
        onClose={() => !creatingGoal && setCreateGoalOpen(false)}
        onCreate={submitGoal}
      />

      <WorkflowStartDialog
        open={Boolean(workflowStartDefinition)}
        definition={workflowStartDefinition}
        language={language}
        starting={startingWorkflow}
        onClose={() => !startingWorkflow && setWorkflowStartDefinition(null)}
        onStart={(payload) => void submitWorkflowStart(payload)}
      />
    </main>
  );
}
