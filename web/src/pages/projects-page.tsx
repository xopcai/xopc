import * as Dialog from '@radix-ui/react-dialog';
import {
  Archive,
  ArrowRight,
  FolderKanban,
  FolderOpen,
  Loader2,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDirectoryPicker } from '@/features/fs/use-directory-picker';
import { WorkingDirectoryPickerModal } from '@/features/fs/working-directory-picker-modal';
import {
  archiveProject,
  createProject,
  fetchProjects,
  pinProject,
  restoreProject,
  unpinProject,
  type Project,
  type ProjectStatus,
} from '@/features/projects/api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { formatMediumDate } from '@/lib/date-formatters';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

type ProjectFilter = 'all' | ProjectStatus;

function projectTime(value: string | number | undefined, fallback: string): string {
  if (value == null) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return formatMediumDate(date);
}

function sortLoadedProjects(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    const pinned = Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt));
    if (pinned !== 0) return pinned;
    return new Date(b.lastActiveAt ?? b.updatedAt).getTime() - new Date(a.lastActiveAt ?? a.updatedAt).getTime();
  });
}

function ProjectsSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy>
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-40 rounded-xl" />
      ))}
    </div>
  );
}

function ProjectCard({
  project,
  busy,
  onTogglePin,
  onToggleArchive,
}: {
  project: Project;
  busy: boolean;
  onTogglePin: () => void;
  onToggleArchive: () => void;
}) {
  const language = useLocaleStore((state) => state.language);
  const t = messages(language).projectsPage;
  const management = t.management;

  return (
    <article className="flex h-full flex-col rounded-xl border border-edge-subtle bg-surface-base p-4">
      <Link
        to={`/projects/${encodeURIComponent(project.id)}`}
        className="group flex min-w-0 flex-1 flex-col rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <FolderKanban className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-fg">{project.name}</h2>
              <p className="mt-0.5 text-xs text-fg-subtle">{t.statuses[project.status]}</p>
            </div>
          </div>
          <ArrowRight className="mt-2 size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
        </div>
        <p className="mt-3 line-clamp-2 min-h-10 text-xs leading-5 text-fg-muted">
          {project.description || project.brief || t.noDescription}
        </p>
      </Link>

      <div className="mt-3 flex shrink-0 items-end justify-between gap-3 border-t border-edge-subtle pt-3">
        <div className="min-w-0 text-[11px] text-fg-subtle">
          <p className="truncate">{project.workspaceRoot || t.agentDefault}</p>
          <p className="mt-1">{projectTime(project.lastActiveAt ?? project.updatedAt, t.never)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="ghost"
            className="size-8 p-0"
            disabled={busy}
            onClick={onTogglePin}
            aria-label={project.pinnedAt ? management.unpin : management.pin}
            title={project.pinnedAt ? management.unpin : management.pin}
          >
            {project.pinnedAt ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="size-8 p-0"
            disabled={busy}
            onClick={onToggleArchive}
            aria-label={project.status === 'archived' ? management.restore : management.archive}
            title={project.status === 'archived' ? management.restore : management.archive}
          >
            {project.status === 'archived'
              ? <RotateCcw className="size-4" aria-hidden />
              : <Archive className="size-4" aria-hidden />}
          </Button>
        </div>
      </div>
    </article>
  );
}

export function ProjectsPage() {
  const language = useLocaleStore((state) => state.language);
  const msg = messages(language);
  const t = msg.projectsPage;
  const management = t.management;
  const wd = msg.chat.workingDirectory;
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState<ProjectFilter>('active');
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const workspacePicker = useDirectoryPicker({
    initialPath: workspaceRoot,
    onPicked: setWorkspaceRoot,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchProjects({ limit: 100, sortBy: 'updatedAt', sortOrder: 'desc' });
      setProjects(sortLoadedProjects(result.items));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return projects
      .filter((project) => filter === 'all' || project.status === filter)
      .filter((project) => !query || [project.name, project.description, project.brief, project.workspaceRoot]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query)));
  }, [filter, projects, search]);

  const headerEnd = useMemo(() => (
    <Button type="button" variant="primary" className="h-9 rounded-lg" onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" aria-hidden />
      {t.create}
    </Button>
  ), [t.create]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{management.title}</h1>
          <p className="truncate text-xs text-fg-muted">{management.subtitle}</p>
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, management.subtitle, management.title, setPageHeader]);

  const submitCreate = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedWorkspaceRoot = workspaceRoot.trim();
    if (!trimmedName || !trimmedWorkspaceRoot || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const project = await createProject({
        name: trimmedName,
        ...(description.trim() ? { description: description.trim() } : {}),
        workspaceRoot: trimmedWorkspaceRoot,
      });
      setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
      setName('');
      setDescription('');
      setWorkspaceRoot('');
      setCreateOpen(false);
      window.dispatchEvent(new CustomEvent('project-updated', { detail: { id: project.id } }));
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  }, [creating, description, name, workspaceRoot]);

  const mutateProject = useCallback(async (project: Project, action: 'pin' | 'archive') => {
    setBusyProjectId(project.id);
    setError(null);
    try {
      let updatedProject: Project;
      if (action === 'pin') {
        updatedProject = project.pinnedAt
          ? await unpinProject(project.id)
          : await pinProject(project.id);
      } else if (project.status === 'archived') {
        updatedProject = await restoreProject(project.id);
      } else {
        updatedProject = await archiveProject(project.id);
      }
      setProjects((current) => current.map((item) => (
        item.id === updatedProject.id ? updatedProject : item
      )));
      window.dispatchEvent(new CustomEvent('project-updated', { detail: { id: project.id } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyProjectId(null);
    }
  }, []);

  const filters: Array<{ id: ProjectFilter; label: string }> = [
    { id: 'active', label: t.statuses.active },
    { id: 'paused', label: t.statuses.paused },
    { id: 'archived', label: t.statuses.archived },
    { id: 'all', label: t.all },
  ];
  const selectedFilterLabel = filters.find((item) => item.id === filter)?.label ?? t.all;
  const resultCountLabel = management.resultCount
    .replace('{{status}}', selectedFilterLabel)
    .replace('{{count}}', String(visibleProjects.length));

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-3 py-6 sm:px-5 xl:px-6">
      <Dialog.Root
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setCreateError(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(34rem,calc(100vh-2rem))] w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="shrink-0 border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">{t.createTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">{t.createDescription}</Dialog.Description>
            </div>
            <form onSubmit={submitCreate} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <label className="grid gap-1.5 text-sm font-medium text-fg">
                  {t.projectName}
                  <input className="h-10 rounded-lg border border-edge bg-surface-base px-3 font-normal outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} />
                </label>
                <label className="grid gap-1.5 text-sm font-medium text-fg">
                  {management.descriptionLabel}
                  <textarea className="min-h-28 resize-none rounded-lg border border-edge bg-surface-base px-3 py-2 font-normal leading-6 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2_000} placeholder={management.descriptionPlaceholder} />
                </label>
                <div className="grid gap-1.5 text-sm">
                  <span className="font-medium text-fg">{t.workspaceRoot}</span>
                  <button
                    type="button"
                    className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-edge bg-surface-base px-3 py-2 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={workspacePicker.pick}
                    disabled={creating || workspacePicker.picking}
                  >
                    {workspacePicker.picking
                      ? <Loader2 className="size-5 shrink-0 animate-spin text-accent" aria-hidden />
                      : <FolderOpen className="size-5 shrink-0 text-accent" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-fg">
                        {workspaceRoot ? wd.chooseFolder : wd.selectWorkingDirectory}
                      </span>
                      <span
                        className={cn(
                          'mt-0.5 block truncate font-mono text-xs font-normal',
                          workspaceRoot ? 'text-fg-muted' : 'text-fg-subtle',
                        )}
                        title={workspaceRoot || undefined}
                      >
                        {workspaceRoot || t.workspaceSelectionPlaceholder}
                      </span>
                    </span>
                  </button>
                  <p className="text-xs font-normal text-fg-subtle">{t.workspaceSelectionHint}</p>
                </div>
                {createError ? (
                  <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">{createError}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-4">
                <Dialog.Close asChild><Button type="button" variant="ghost">{t.cancel}</Button></Dialog.Close>
                <Button type="submit" variant="primary" disabled={creating || !name.trim() || !workspaceRoot.trim()}>
                  {creating ? t.home.creating : t.create}
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
          initialAbsolutePath={workspaceRoot || undefined}
          onConfirm={workspacePicker.confirmPick}
          wd={wd}
        />
      ) : null}

      <section className="flex min-h-10 flex-wrap items-center justify-between gap-3" aria-label={management.filterLabel}>
        <p className="text-sm font-medium text-fg-muted" aria-live="polite">{resultCountLabel}</p>
        <div className={cn('ml-auto flex min-w-0 items-center justify-end gap-2', searchOpen && 'w-full sm:w-auto')}>
          {searchOpen ? (
            <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
              <input
                autoFocus
                className="h-9 w-full rounded-lg border border-edge bg-surface-panel pl-9 pr-9 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t.searchPlaceholder}
                aria-label={t.searchPlaceholder}
              />
              <button
                type="button"
                className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
                onClick={() => {
                  setSearch('');
                  setSearchOpen(false);
                }}
                aria-label={management.clearSearch}
                title={management.clearSearch}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="size-9 shrink-0 p-0"
              onClick={() => setSearchOpen(true)}
              aria-label={t.searchPlaceholder}
              title={t.searchPlaceholder}
            >
              <Search className="size-4" aria-hidden />
            </Button>
          )}
          <Select
            className="w-28 sm:w-32"
            triggerClassName="h-9 border-edge bg-surface-panel px-2.5 text-xs font-medium"
            contentClassName="min-w-36"
            align="end"
            value={filter}
            aria-label={management.filterLabel}
            onChange={(event) => setFilter(event.target.value as ProjectFilter)}
          >
            {filters.map((item) => (
              <SelectOption key={item.id} value={item.id}>{item.label}</SelectOption>
            ))}
          </Select>
        </div>
      </section>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
          <span>{error}</span>
          <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => void load()}>{t.home.retry}</Button>
        </div>
      ) : null}

      {loading ? <ProjectsSkeleton /> : visibleProjects.length ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              busy={busyProjectId === project.id}
              onTogglePin={() => void mutateProject(project, 'pin')}
              onToggleArchive={() => void mutateProject(project, 'archive')}
            />
          ))}
        </section>
      ) : (
        <section className="rounded-xl border border-dashed border-edge p-10 text-center">
          <FolderKanban className="mx-auto size-7 text-fg-subtle" aria-hidden />
          <h2 className="mt-3 text-sm font-semibold text-fg">{management.emptyTitle}</h2>
          <p className="mt-1 text-sm text-fg-muted">{management.emptyHint}</p>
        </section>
      )}
    </main>
  );
}
