import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, FolderKanban, FolderPlus, Plus, Search } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { DirectoryPickerPathField } from '@/features/fs/directory-picker-path-field';
import {
  createProject,
  fetchProjects,
  inferProjectDefaults,
  type Project,
  type ProjectKindSelection,
  type ProjectStatus,
} from '@/features/projects/api';
import { fetchGatewayAgents, type GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

const STATUSES: Array<ProjectStatus | 'all'> = ['all', 'active', 'paused', 'archived'];
const AUTO_AGENT_CHOICE = '__auto__';
const GLOBAL_AGENT_CHOICE = '__global__';
type AgentChoice = typeof AUTO_AGENT_CHOICE | typeof GLOBAL_AGENT_CHOICE | string;
type WorkspaceMode = 'follow' | 'fixed';

function statusTone(status: ProjectStatus): string {
  if (status === 'active') return 'bg-accent-soft text-accent-fg';
  if (status === 'paused') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'bg-surface-muted text-fg-subtle';
}

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''));
}

function directoryName(value: string): string {
  return value.trim().replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() ?? '';
}

function getWorkspaceConflictProject(err: unknown): Project | null {
  const body = (err as { body?: { code?: string; project?: Project } } | null)?.body;
  return body?.code === 'workspace_already_bound' && body.project ? body.project : null;
}

function getMissingWorkspaceRoot(err: unknown): string | null {
  const body = (err as { body?: { code?: string; workspaceRoot?: string } } | null)?.body;
  return body?.code === 'workspace_root_missing' && body.workspaceRoot ? body.workspaceRoot : null;
}

function formatDate(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function ProjectCard({ project, t }: { project: Project; t: ReturnType<typeof messages>['projectsPage'] }) {
  const statusLabel = t.statuses[project.status];
  return (
    <Link
      to={`/projects/${encodeURIComponent(project.id)}`}
      className="group flex min-h-36 flex-col rounded-lg bg-surface-panel p-4 shadow-surface transition-colors hover:bg-surface-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-fg">{project.name}</h2>
          <p className="mt-1 truncate text-xs text-fg-subtle">{project.slug}</p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', statusTone(project.status))}>
          {statusLabel}
        </span>
      </div>
      <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-fg-muted">
        {project.description || project.brief || t.noDescription}
      </p>
      <div className="mt-auto grid gap-1 pt-4 text-xs text-fg-subtle">
        <div className="truncate">{interpolate(t.workspaceLabel, { workspace: project.workspaceRoot || project.effectiveWorkspaceRoot || t.agentDefault })}</div>
        <div>{interpolate(t.lastActive, { time: formatDate(project.lastActiveAt ?? project.updatedAt, t.never) })}</div>
      </div>
    </Link>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const msg = messages(language);
  const wd = msg.chat.workingDirectory;
  const t = msg.projectsPage;
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<ProjectStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('fixed');
  const [projectKind, setProjectKind] = useState<ProjectKindSelection>('auto');
  const [agentChoice, setAgentChoice] = useState<AgentChoice>(AUTO_AGENT_CHOICE);
  const [agents, setAgents] = useState<GatewayAgentRow[]>([]);
  const [gatewayDefaultAgentId, setGatewayDefaultAgentId] = useState<string | undefined>();
  const [inferredDefaultAgentId, setInferredDefaultAgentId] = useState<string | undefined>();
  const [inferredKind, setInferredKind] = useState<'coding' | 'general' | 'unknown'>('unknown');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [workspaceConflict, setWorkspaceConflict] = useState<Project | null>(null);
  const [missingWorkspaceRoot, setMissingWorkspaceRoot] = useState<string | null>(null);

  const updateProjectName = useCallback((value: string) => {
    setName(value);
    setNameEdited(Boolean(value.trim()));
  }, []);

  const updateWorkspaceRoot = useCallback((value: string) => {
    setWorkspaceRoot(value);
    if (!nameEdited) setName(directoryName(value));
  }, [nameEdited]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchProjects({
      ...(status !== 'all' ? { status } : {}),
      ...(search.trim() ? { search } : {}),
      limit: 100,
    })
      .then((res) => {
        if (!cancelled) setProjects(res.items);
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
  }, [search, status]);

  useEffect(() => {
    if (!createOpen) return;
    let cancelled = false;
    void fetchGatewayAgents()
      .then((payload) => {
        if (!cancelled) {
          setAgents(payload.agents);
          setGatewayDefaultAgentId(payload.defaultId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAgents([]);
          setGatewayDefaultAgentId(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [createOpen]);

  useEffect(() => {
    if (!createOpen) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void inferProjectDefaults({
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(workspaceMode === 'fixed' && workspaceRoot.trim() ? { workspaceRoot: workspaceRoot.trim() } : {}),
        projectKind,
      })
        .then((result) => {
          if (cancelled) return;
          setInferredDefaultAgentId(result.defaultAgentId);
          setInferredKind(result.inference.kind);
        })
        .catch(() => {
          if (cancelled) return;
          setInferredDefaultAgentId(undefined);
          setInferredKind('unknown');
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [createOpen, name, projectKind, workspaceMode, workspaceRoot]);

  const grouped = useMemo(() => {
    const active = projects.filter((p) => p.status === 'active');
    const paused = projects.filter((p) => p.status === 'paused');
    const archived = projects.filter((p) => p.status === 'archived');
    return { active, paused, archived };
  }, [projects]);

  const submitProjectCreate = useCallback(async (options: { createWorkspaceRoot?: boolean } = {}) => {
    const trimmedName = name.trim();
    const trimmedWorkspace = workspaceMode === 'fixed' ? workspaceRoot.trim() : '';
    if (!trimmedName && !trimmedWorkspace) return;
    setCreating(true);
    setError(null);
    setMissingWorkspaceRoot(null);
    try {
      const project = await createProject({
        ...(trimmedName ? { name: trimmedName } : {}),
        ...(trimmedWorkspace ? { workspaceRoot: trimmedWorkspace } : {}),
        projectKind,
        ...(agentChoice === AUTO_AGENT_CHOICE ? {} : { defaultAgentId: agentChoice === GLOBAL_AGENT_CHOICE ? '' : agentChoice }),
        ...(options.createWorkspaceRoot ? { createWorkspaceRoot: true } : {}),
      });
      setProjects((items) => [project, ...items]);
      setName('');
      setNameEdited(false);
      setWorkspaceRoot('');
      setWorkspaceMode('fixed');
      setProjectKind('auto');
      setAgentChoice(AUTO_AGENT_CHOICE);
      setCreateOpen(false);
    } catch (err) {
      const conflictProject = getWorkspaceConflictProject(err);
      if (conflictProject) {
        setProjects((items) => [conflictProject, ...items.filter((item) => item.id !== conflictProject.id)]);
        setWorkspaceConflict(conflictProject);
        setCreateOpen(false);
      } else {
        const missingRoot = getMissingWorkspaceRoot(err);
        if (missingRoot) {
          setMissingWorkspaceRoot(missingRoot);
          setCreateOpen(false);
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      setCreating(false);
    }
  }, [agentChoice, name, projectKind, workspaceMode, workspaceRoot]);

  const onCreate = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitProjectCreate();
  }, [submitProjectCreate]);

  const openConflictProject = useCallback(() => {
    if (!workspaceConflict) return;
    const projectId = workspaceConflict.id;
    setWorkspaceConflict(null);
    navigate(`/projects/${encodeURIComponent(projectId)}`);
  }, [navigate, workspaceConflict]);

  const returnToCreateFromConflict = useCallback(() => {
    setWorkspaceConflict(null);
    setCreateOpen(true);
  }, []);

  const createMissingWorkspaceAndProject = useCallback(() => {
    void submitProjectCreate({ createWorkspaceRoot: true });
  }, [submitProjectCreate]);

  const returnToCreateFromMissingWorkspace = useCallback(() => {
    setMissingWorkspaceRoot(null);
    setCreateOpen(true);
  }, []);

  const inferredAgentName = useMemo(() => {
    const agent = agents.find((item) => item.id === inferredDefaultAgentId);
    return agent?.name || inferredDefaultAgentId || '';
  }, [agents, inferredDefaultAgentId]);

  const selectedWorkspaceAgentId = useMemo(() => {
    if (agentChoice === GLOBAL_AGENT_CHOICE) return gatewayDefaultAgentId;
    if (agentChoice !== AUTO_AGENT_CHOICE) return agentChoice;
    return inferredDefaultAgentId || gatewayDefaultAgentId;
  }, [agentChoice, gatewayDefaultAgentId, inferredDefaultAgentId]);

  const selectedWorkspaceAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedWorkspaceAgentId),
    [agents, selectedWorkspaceAgentId],
  );

  const workspaceCurrentLabel = workspaceMode === 'fixed'
    ? (workspaceRoot.trim() || t.workspacePlaceholder)
    : (selectedWorkspaceAgent?.workspace || t.workspacePlaceholder);

  const createAgentHint = useMemo(() => {
    if (agentChoice === GLOBAL_AGENT_CHOICE) return t.agentHintGlobal;
    if (agentChoice !== AUTO_AGENT_CHOICE) {
      const agent = agents.find((item) => item.id === agentChoice);
      return interpolate(t.agentHintSelected, { agent: agent?.name || agentChoice });
    }
    if (inferredDefaultAgentId) return interpolate(t.agentHintCoding, { agent: inferredAgentName });
    if (inferredKind === 'coding') return t.agentHintCoderUnavailable;
    if (projectKind === 'general' || inferredKind === 'general') return t.agentHintGeneral;
    return t.agentHintAuto;
  }, [agentChoice, agents, inferredAgentName, inferredDefaultAgentId, inferredKind, projectKind, t]);

  const headerEnd = useMemo(
    () => (
      <>
        <label className="relative block min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <input
            className="h-9 w-40 rounded-lg border border-edge bg-surface-muted pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent sm:w-56 lg:w-72"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
          />
        </label>
        <Button type="button" variant="primary" className="h-9 rounded-lg" onClick={() => setCreateOpen((open) => !open)}>
          <Plus className="size-4" aria-hidden />
          {t.create}
        </Button>
      </>
    ),
    [search, t.create, t.searchPlaceholder],
  );

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{t.title}</h1>
          <p className="truncate text-xs text-fg-muted">
            {interpolate(t.summary, { count: projects.length })}
          </p>
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, projects.length, setPageHeader, t.summary, t.title]);

  const visibleGroups: Array<[string, Project[]]> =
    status === 'all'
      ? [[t.statuses.active, grouped.active], [t.statuses.paused, grouped.paused], [t.statuses.archived, grouped.archived]]
      : [[t.statuses[status], projects]];

  return (
    <main className="flex w-full flex-1 flex-col gap-6 px-3 py-6 sm:px-5 xl:px-6">
      <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(32rem,calc(100vh-2rem))] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="shrink-0 border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">{t.createTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">{t.createDescription}</Dialog.Description>
            </div>
            <form onSubmit={onCreate} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div className="grid gap-1.5 text-sm">
                  <span className="font-medium text-fg-muted">{t.workspaceRoot}</span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className={cn('flex min-h-10 items-start gap-2 rounded-md border px-3 py-2 text-sm', workspaceMode === 'fixed' ? 'border-accent bg-accent-soft/40 text-fg' : 'border-edge bg-surface-base text-fg-muted')}>
                      <input
                        type="radio"
                        className="mt-0.5 size-4"
                        checked={workspaceMode === 'fixed'}
                        onChange={() => setWorkspaceMode('fixed')}
                        disabled={creating}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{t.workspaceModeFixed}</span>
                        <span className="block text-xs leading-5 text-fg-subtle">{t.workspaceFixedHint}</span>
                      </span>
                    </label>
                    <label className={cn('flex min-h-10 items-start gap-2 rounded-md border px-3 py-2 text-sm', workspaceMode === 'follow' ? 'border-accent bg-accent-soft/40 text-fg' : 'border-edge bg-surface-base text-fg-muted')}>
                      <input
                        type="radio"
                        className="mt-0.5 size-4"
                        checked={workspaceMode === 'follow'}
                        onChange={() => setWorkspaceMode('follow')}
                        disabled={creating}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{t.workspaceModeFollow}</span>
                        <span className="block text-xs leading-5 text-fg-subtle">{t.workspaceFollowHint}</span>
                      </span>
                    </label>
                  </div>
                  {workspaceMode === 'fixed' ? (
                    <DirectoryPickerPathField
                      value={workspaceRoot}
                      onChange={updateWorkspaceRoot}
                      disabled={creating}
                      wd={wd}
                      placeholder={t.workspacePlaceholder}
                      inputClassName="min-h-10 rounded-md border border-edge bg-surface-base px-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent"
                      autoFocus
                    />
                  ) : null}
                  <p className="text-xs text-fg-subtle">
                    {interpolate(t.workspaceCurrent, { workspace: workspaceCurrentLabel })}
                  </p>
                </div>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-fg-muted">{t.projectName}</span>
                  <input
                    className="min-h-10 rounded-md border border-edge bg-surface-base px-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent"
                    value={name}
                    onChange={(event) => updateProjectName(event.target.value)}
                    placeholder={workspaceRoot.trim() ? directoryName(workspaceRoot) || 'xopc' : 'xopc'}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-fg-muted">{t.projectType}</span>
                  <Select
                    className="min-h-10 rounded-md border border-edge bg-surface-base px-3 text-sm text-fg outline-none focus:border-accent"
                    value={projectKind}
                    onChange={(event) => setProjectKind(event.target.value as ProjectKindSelection)}
                    disabled={creating}
                  >
                    <SelectOption value="auto">{t.projectTypes.auto}</SelectOption>
                    <SelectOption value="coding">{t.projectTypes.coding}</SelectOption>
                    <SelectOption value="general">{t.projectTypes.general}</SelectOption>
                  </Select>
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-fg-muted">{t.defaultAgent}</span>
                  <Select
                    className="min-h-10 rounded-md border border-edge bg-surface-base px-3 text-sm text-fg outline-none focus:border-accent"
                    value={agentChoice}
                    onChange={(event) => setAgentChoice(event.target.value)}
                    disabled={creating}
                  >
                    <SelectOption value={AUTO_AGENT_CHOICE}>{t.agentAuto}</SelectOption>
                    <SelectOption value={GLOBAL_AGENT_CHOICE}>{t.agentGlobalDefault}</SelectOption>
                    {agents.map((agent) => (
                      <SelectOption key={agent.id} value={agent.id}>
                        {agentListDisplayName(agent, msg.agentsSettings)}
                      </SelectOption>
                    ))}
                  </Select>
                  <p className="text-xs text-fg-subtle">{createAgentHint}</p>
                </label>
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-4">
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" className="rounded-lg">
                    {t.cancel}
                  </Button>
                </Dialog.Close>
                <Button type="submit" variant="primary" className="rounded-lg" disabled={creating || (!name.trim() && (workspaceMode !== 'fixed' || !workspaceRoot.trim()))}>
                  <Plus className="size-4" aria-hidden />
                  {t.create}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(workspaceConflict)} onOpenChange={(open) => {
        if (!open) setWorkspaceConflict(null);
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[110] flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">{t.workspaceConflictTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">
                {workspaceConflict
                  ? interpolate(t.workspaceConflictDescription, { projectName: workspaceConflict.name })
                  : null}
              </Dialog.Description>
            </div>
            {workspaceConflict ? (
              <div className="space-y-3 px-5 py-4">
                <div className="flex items-center gap-2 rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg-muted">
                  <FolderKanban className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                  <span className="min-w-0 truncate">
                    {interpolate(t.workspaceConflictPath, { workspace: workspaceConflict.workspaceRoot || t.agentDefault })}
                  </span>
                </div>
              </div>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-edge px-5 py-4">
              <Button type="button" variant="ghost" className="rounded-lg" onClick={returnToCreateFromConflict}>
                {t.workspaceConflictBack}
              </Button>
              <Button type="button" variant="primary" className="rounded-lg" onClick={openConflictProject}>
                <ArrowRight className="size-4" aria-hidden />
                {t.workspaceConflictOpen}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(missingWorkspaceRoot)} onOpenChange={(open) => {
        if (!open) setMissingWorkspaceRoot(null);
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[110] flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">{t.workspaceMissingTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">
                {missingWorkspaceRoot
                  ? interpolate(t.workspaceMissingDescription, { workspace: missingWorkspaceRoot })
                  : null}
              </Dialog.Description>
            </div>
            {missingWorkspaceRoot ? (
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg-muted">
                  <FolderKanban className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                  <span className="min-w-0 truncate">{missingWorkspaceRoot}</span>
                </div>
              </div>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-edge px-5 py-4">
              <Button type="button" variant="ghost" className="rounded-lg" onClick={returnToCreateFromMissingWorkspace} disabled={creating}>
                {t.workspaceMissingBack}
              </Button>
              <Button type="button" variant="primary" className="rounded-lg" onClick={createMissingWorkspaceAndProject} disabled={creating}>
                <FolderPlus className="size-4" aria-hidden />
                {t.workspaceMissingCreate}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1 rounded-lg bg-surface-panel p-1 shadow-surface">
          {STATUSES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setStatus(item)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                status === item ? 'bg-accent text-white' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              {item === 'all' ? t.all : t.statuses[item]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <FolderKanban className="size-4" aria-hidden />
          {t.optionalContext}
        </div>
      </section>

      {error ? <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      {loading ? <p className="text-sm text-fg-muted">{t.loading}</p> : null}
      {!loading && projects.length === 0 ? (
        <div className="rounded-lg bg-surface-panel p-8 text-center shadow-surface">
          <p className="text-sm font-medium text-fg">{t.emptyTitle}</p>
          <p className="mt-1 text-sm text-fg-muted">{t.emptyHint}</p>
        </div>
      ) : null}

      {visibleGroups.map(([label, items]) =>
        items.length ? (
          <section key={label} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">{label}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((project) => <ProjectCard key={project.id} project={project} t={t} />)}
            </div>
          </section>
        ) : null,
      )}
    </main>
  );
}
