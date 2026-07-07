import * as Dialog from '@radix-ui/react-dialog';
import { FolderKanban, Plus, Search } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { DirectoryPickerPathField } from '@/features/fs/directory-picker-path-field';
import {
  createProject,
  fetchProjects,
  type Project,
  type ProjectStatus,
} from '@/features/projects/api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

const STATUSES: Array<ProjectStatus | 'all'> = ['all', 'active', 'paused', 'archived'];

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
      className="group flex min-h-36 flex-col rounded-lg border border-edge bg-surface-panel p-4 transition-colors hover:border-accent/50 hover:bg-surface-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
        <div className="truncate">{interpolate(t.workspaceLabel, { workspace: project.workspaceRoot || t.agentDefault })}</div>
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
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);

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

  const grouped = useMemo(() => {
    const active = projects.filter((p) => p.status === 'active');
    const paused = projects.filter((p) => p.status === 'paused');
    const archived = projects.filter((p) => p.status === 'archived');
    return { active, paused, archived };
  }, [projects]);

  const onCreate = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedWorkspace = workspaceRoot.trim();
    if (!trimmedName && !trimmedWorkspace) return;
    setCreating(true);
    setError(null);
    try {
      const project = await createProject({
        ...(trimmedName ? { name: trimmedName } : {}),
        ...(trimmedWorkspace ? { workspaceRoot: trimmedWorkspace } : {}),
      });
      setProjects((items) => [project, ...items]);
      setName('');
      setWorkspaceRoot('');
      setCreateOpen(false);
    } catch (err) {
      const conflictProject = getWorkspaceConflictProject(err);
      if (conflictProject) {
        setProjects((items) => [conflictProject, ...items.filter((item) => item.id !== conflictProject.id)]);
        setError(`Workspace is already bound to project “${conflictProject.name}”. Open that project to continue.`);
        setCreateOpen(false);
        navigate(`/projects/${encodeURIComponent(conflictProject.id)}`);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setCreating(false);
    }
  }, [name, navigate, workspaceRoot]);

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
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-fg-muted">{t.projectName}</span>
                  <input
                    className="min-h-10 rounded-md border border-edge bg-surface-base px-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={workspaceRoot.trim() ? directoryName(workspaceRoot) || 'xopc' : 'xopc'}
                    autoFocus
                  />
                </label>
                <div className="grid gap-1.5 text-sm">
                  <span className="font-medium text-fg-muted">{t.workspaceRoot}</span>
                  <DirectoryPickerPathField
                    value={workspaceRoot}
                    onChange={setWorkspaceRoot}
                    disabled={creating}
                    wd={wd}
                    placeholder={t.workspacePlaceholder}
                    inputClassName="min-h-10 rounded-md border border-edge bg-surface-base px-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent"
                  />
                  <p className="text-xs text-fg-subtle">
                    {t.workspaceHint}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-4">
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" className="rounded-lg">
                    {t.cancel}
                  </Button>
                </Dialog.Close>
                <Button type="submit" variant="primary" className="rounded-lg" disabled={creating || !(name.trim() || workspaceRoot.trim())}>
                  <Plus className="size-4" aria-hidden />
                  {t.create}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1 rounded-lg border border-edge bg-surface-panel p-1">
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
        <div className="rounded-lg border border-dashed border-edge bg-surface-panel p-8 text-center">
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
