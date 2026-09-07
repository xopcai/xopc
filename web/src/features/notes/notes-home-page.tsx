import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Archive, ArrowLeft, ArrowRight, AudioLines, Bookmark, FileText, Folder, Inbox, Loader2, MoreHorizontal, NotebookText, Plus, Search, Sparkles, Star, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { useDebounce } from 'use-debounce';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { htmlLangAttribute } from '@/lib/locale-default';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

import { createNote, deleteNote, listNoteProjects, listNotes, updateNote, type NoteIndexEntry } from './notes-api';
import { NotesHomeComposer } from './notes-home-composer';
import { noteHomePreview, notesHomeQuery, NOTES_HOME_PAGE_SIZE } from './notes-home-model';
import { formatRelativeTime, type NoteTimeLabels } from './note-time';

const quietButton = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50';

export function NotesHomePage() {
  const language = useLocaleStore((s) => s.language);
  const n = messages(language).notes;
  const h = n.home;
  const token = useGatewayStore((s) => s.token);
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const navigate = useNavigate();
  const { pathname, search: routeSearch } = useLocation();
  const [params, setParams] = useSearchParams();
  const projectId = params.get('projectId') || '';
  const view = params.get('view') || 'all';
  const unassigned = params.get('unassigned') === 'true' || view === 'unassigned';
  const search = params.get('search') || '';
  const [debouncedSearch] = useDebounce(search, 250);
  const [destination, setDestination] = useState(projectId);
  const [projectSearch, setProjectSearch] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [creatingBlank, setCreatingBlank] = useState(false);
  const [pinning, setPinning] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<NoteIndexEntry | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const pinningRef = useRef(new Set<string>());
  const blankRequest = useRef<{ key: string; projectId?: string } | null>(null);
  const blankBusy = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const query = notesHomeQuery(params, debouncedSearch);
  const page = (query.offset ?? 0) / NOTES_HOME_PAGE_SIZE;
  const { data, error, isLoading, mutate } = useSWR(token ? ['notes-home', token, query] : null, () => listNotes(query));
  const { data: projectData, error: projectError, isLoading: projectsLoading, mutate: mutateProjects } = useSWR(
    token ? ['notes-home-projects', token] : null, listNoteProjects,
  );
  const projects = projectData?.items ?? [];
  const selectedProject = projects.find((p) => p.id === projectId);
  const currentProjectLabel = selectedProject?.name ?? h.projectNotes;
  const notes = data?.items ?? [];
  const total = data?.total ?? 0;
  const loading = isLoading || search !== debouncedSearch;
  const timeLabels: NoteTimeLabels = useMemo(() => ({
    justNow: n.justNow, minutesAgo: n.minutesAgo, today: n.today, yesterday: n.yesterday,
    daysAgo: n.daysAgo, locale: htmlLangAttribute(language),
  }), [language, n.justNow, n.minutesAgo, n.today, n.yesterday, n.daysAgo]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { setDestination(projectId); }, [projectId]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(() => {
    void mutate().catch(() => undefined);
    void mutateProjects().catch(() => undefined);
  }, [mutate, mutateProjects]);

  useEffect(() => {
    const events = ['note-updated', 'note-created', 'note-deleted', 'project-updated', 'project-created', 'project-deleted'];
    events.forEach((event) => window.addEventListener(event, refresh));
    return () => events.forEach((event) => window.removeEventListener(event, refresh));
  }, [refresh]);

  const openNote = useCallback((id: string, edit = false) => {
    const returnTo = `${pathname}${routeSearch}`;
    const next = new URLSearchParams({ returnTo });
    if (edit) next.set('edit', '1');
    navigate(`/notes/${encodeURIComponent(id)}?${next}`);
  }, [pathname, routeSearch, navigate]);

  const createBlank = useCallback(async () => {
    if (blankBusy.current || !token) return;
    blankBusy.current = true;
    setCreatingBlank(true); setActionError(null);
    blankRequest.current ??= { key: crypto.randomUUID(), projectId: destination || undefined };
    try {
      const note = await createNote({ markdown: '', kind: 'thought', projectId: blankRequest.current.projectId }, blankRequest.current.key);
      blankRequest.current = null;
      refresh(); openNote(note.id, true);
    } catch (err) {
      setActionError(`${n.createBlankFailed}: ${err instanceof Error ? err.message : n.createBlankFailedHint}`);
    } finally {
      blankBusy.current = false; setCreatingBlank(false);
    }
  }, [destination, n.createBlankFailed, n.createBlankFailedHint, openNote, refresh, token]);

  const setSearch = useCallback((value: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set('search', value); else next.delete('search');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  function chooseScope(id: string, nextView = 'all') {
    const next = new URLSearchParams();
    if (id) next.set('projectId', id);
    if (nextView === 'unassigned') next.set('unassigned', 'true');
    else if (nextView !== 'all') next.set('view', nextView);
    setDestination(id); setParams(next);
  }

  function chooseView(nextView: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (unassigned) next.set('unassigned', 'true');
      if (nextView === 'all') next.delete('view'); else next.set('view', nextView);
      next.delete('page');
      return next;
    });
  }

  async function toggleFavorite(id: string, pinned: boolean) {
    if (pinningRef.current.has(id)) return;
    pinningRef.current.add(id); setPinning(new Set(pinningRef.current)); setActionError(null);
    try { await updateNote(id, { pinned }); refresh(); }
    catch (err) { setActionError(`${n.actionFailed}: ${err instanceof Error ? err.message : n.quickCaptureFailedHint}`); }
    finally { pinningRef.current.delete(id); setPinning(new Set(pinningRef.current)); }
  }

  async function confirmDeleteNote() {
    const target = deleteTarget;
    if (!target || deletingNoteId) return;
    setDeleteTarget(null);
    setDeletingNoteId(target.id);
    setActionError(null);
    try {
      await deleteNote(target.id);
      window.dispatchEvent(new CustomEvent('note-deleted', { detail: { noteId: target.id } }));
      refresh();
    } catch (err) {
      setActionError(`${n.deleteFailed}: ${err instanceof Error ? err.message : n.quickCaptureFailedHint}`);
    } finally {
      setDeletingNoteId(null);
    }
  }

  useLayoutEffect(() => {
    if (!token) { clearPageHeader(); return; }
    setPageHeader({
      startExtra: null,
      main: <h1 className="truncate text-base font-semibold text-fg">{n.title}</h1>,
      end: <div className={cn('flex min-w-0 items-center gap-2', APP_CHROME_NO_DRAG_CLASS)}>
        <label className="flex h-9 w-32 min-w-0 items-center gap-2 rounded-lg border border-edge bg-surface-panel px-2 sm:w-48">
          <Search className="size-4 shrink-0 text-fg-muted" aria-hidden />
          <input ref={searchRef} type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            aria-label={n.searchDialogTitle} placeholder={n.searchPlaceholder} className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted" />
        </label>
        <button type="button" onClick={() => void createBlank()} disabled={creatingBlank} aria-label={h.blankNote}
          className={cn(quietButton, 'border border-edge bg-surface-panel text-fg')}>
          {creatingBlank ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}<span className="hidden sm:inline">{h.blankNote}</span>
        </button>
      </div>,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, createBlank, creatingBlank, h.blankNote, n.searchDialogTitle, n.searchPlaceholder, n.title, search, setPageHeader, setSearch, token]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return;
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); void createBlank(); }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [createBlank]);

  if (!token) return <div className="flex flex-1 items-center justify-center p-8 text-sm text-fg-muted">{n.needToken}</div>;

  const navigation = [
    { id: 'all', label: h.homeNav, Icon: NotebookText },
    { id: 'favorites', label: h.favorites, Icon: Star },
    { id: 'unassigned', label: h.unassigned, Icon: Inbox },
    { id: 'archived', label: n.filterArchived, Icon: Archive },
  ];
  const scopeValue = projectId ? `project:${projectId}` : unassigned ? 'unassigned' : 'all';

  return (
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden bg-surface-panel">
      <aside className="hidden w-44 shrink-0 flex-col gap-1 overflow-y-auto px-3 py-6 xl:flex" aria-label={h.homeNav}>
        {navigation.map(({ id, label, Icon }) => <button key={id} type="button" onClick={() => chooseScope('', id)}
          aria-current={!projectId && (id === 'unassigned' ? unassigned : !unassigned && view === id) ? 'page' : undefined}
          className={cn(quietButton, 'justify-start px-2 text-left text-xs', !projectId && (id === 'unassigned' ? unassigned : !unassigned && view === id) && 'bg-surface-hover font-medium text-fg')}>
          <Icon className="size-4 shrink-0" aria-hidden />{label}
        </button>)}
        <span className="mb-1 mt-7 px-2 text-xs text-fg-muted">{h.projects}</span>
        {projectsLoading ? [0, 1, 2].map((i) => <Skeleton key={i} className="mb-2 h-8 w-full" />) : projects.slice(0, 8).map((project) => (
          <button key={project.id} type="button" onClick={() => chooseScope(project.id)} aria-current={projectId === project.id ? 'page' : undefined}
            className={cn(quietButton, 'justify-start px-2 text-left text-xs', projectId === project.id && 'bg-surface-hover font-medium text-fg')}>
            <Folder className="size-4 shrink-0" aria-hidden /><span className="truncate">{project.name}</span>
          </button>
        ))}
        <button type="button" onClick={() => navigate('/projects')} className={cn(quietButton, 'mt-2 justify-start px-2 text-xs')}>{h.allProjects}<ArrowRight className="ml-auto size-3" aria-hidden /></button>
      </aside>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-8 lg:px-10 lg:py-9">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0"><h2 className="break-words text-2xl font-semibold tracking-tight text-fg">{projectId ? currentProjectLabel : unassigned ? h.unassigned : h.homeTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-fg-muted">{projectId ? h.projectDescription : h.homeDescription}</p>
            </div>
            {projectId ? <button type="button" onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)} className={cn(quietButton, 'text-xs')}>{h.openProject}<ArrowRight className="size-3.5" aria-hidden /></button> : null}
          </div>
          {actionError ? <p className="mb-4 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{actionError}</p> : null}
          <NotesHomeComposer projects={projects} projectId={destination} onProjectChange={setDestination} onCreated={refresh} labels={n}
            projectsLoading={projectsLoading} projectsError={Boolean(projectError)} />
          {projectError ? <div role="alert" className="mt-4 flex items-center gap-3 text-xs text-danger"><span>{h.projectsLoadFailed}</span><button type="button" onClick={() => void mutateProjects().catch(() => undefined)} className="underline">{h.retry}</button></div> : null}
          {!projectId && !unassigned && (projectsLoading || projects.length > 0) ? (
            <section className="mt-8" aria-label={h.continueProjects}>
              <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-fg">{h.continueProjects}</h3><button type="button" onClick={() => navigate('/projects')} className="text-xs text-fg-muted hover:text-fg">{h.allProjects}</button></div>
              <div className="grid gap-3 sm:grid-cols-3">
                {projectsLoading ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />) : projects.slice(0, 3).map((project) => (
                  <button key={project.id} type="button" onClick={() => chooseScope(project.id)} className="min-w-0 rounded-lg border border-edge bg-surface-panel p-3 text-left transition-colors sm:p-4 hover:bg-surface-base focus-visible:ring-2 focus-visible:ring-accent">
                    <span className="flex items-center gap-2 text-sm font-medium text-fg"><Folder className="size-4 shrink-0" aria-hidden /><span className="truncate">{project.name}</span></span>
                    {project.description ? <p className="mt-2 hidden line-clamp-1 text-xs text-fg-muted sm:block">{project.description}</p> : null}
                    <span className="mt-2 flex flex-wrap items-center justify-between gap-1 text-xs text-fg-muted sm:mt-3"><span>{n.noteCount.replace('{{count}}', String(project.noteCount))}</span><span>{project.updatedAt ? formatRelativeTime(project.updatedAt, now, timeLabels) : h.emptyProject}</span></span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <section className="mt-8 pb-6" aria-label={h.recentNotes}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-fg">{projectId ? h.projectNotes : h.recentNotes}</h3>
              <div className="w-48 max-w-full">
                <PopoverSelect value={scopeValue} allowEmpty={false} ariaLabel={h.projects} placeholder={h.allNotes}
                  options={[{ value: 'all', label: h.allNotes }, { value: 'unassigned', label: h.unassigned }, ...projects.filter((p) => p.name.toLowerCase().includes(projectSearch.toLowerCase())).map((p) => ({ value: `project:${p.id}`, label: p.name }))]}
                  selectedLabel={projectId ? currentProjectLabel : unassigned ? h.unassigned : h.allNotes}
                  triggerClassName="h-8 bg-surface-panel text-xs" loading={projectsLoading}
                  searchPlaceholder={h.projectSearch} searchValue={projectSearch} onSearchChange={setProjectSearch}
                  onChange={(value) => chooseScope(value.startsWith('project:') ? value.slice(8) : '', value === 'unassigned' ? value : 'all')} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 border-b border-edge" aria-label={n.libraryTitle}>
              {[{ id: 'all', label: n.filterAll }, { id: 'agent', label: h.agentEdited }, { id: 'favorites', label: h.favorites }, { id: 'archived', label: n.filterArchived }].map(({ id, label }) => (
                <button type="button" key={id} aria-pressed={view === id || (id === 'all' && view === 'unassigned')}
                  onClick={() => chooseView(id)}
                  className={cn('border-b-2 border-transparent py-3 text-xs text-fg-muted hover:text-fg', (view === id || (id === 'all' && view === 'unassigned')) && 'border-fg font-medium text-fg')}>
                  {label}
                </button>
              ))}
              <span className="ml-auto py-3 text-xs text-fg-muted">{h.sortUpdated}</span>
            </div>
            {error ? <div className="py-10 text-center" role="alert"><p className="text-sm text-danger">{h.loadFailed}</p><button type="button" onClick={() => void mutate().catch(() => undefined)} className={cn(quietButton, 'mt-2')}>{h.retry}</button></div> : loading ? (
              <div aria-busy="true" className="divide-y divide-edge">{[0, 1, 2, 3].map((i) => <div key={i} className="flex items-center gap-3 py-4"><Skeleton className="h-10 w-8 shrink-0" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div></div>)}</div>
            ) : notes.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-12 text-center">
                <NotebookText className="mb-4 size-8 text-fg-muted" strokeWidth={1.3} aria-hidden />
                <h4 className="text-sm font-medium text-fg">{search || (view !== 'all' && view !== 'unassigned') ? h.noMatches : projectId ? h.projectEmpty : h.emptyTitle}</h4>
                <p className="mt-2 max-w-md text-sm leading-6 text-fg-muted">{search || (view !== 'all' && view !== 'unassigned') ? h.noMatchesHint : projectId ? h.projectEmptyHint : h.emptyDescription}</p>
              </div>
            ) : (
              <ul className="divide-y divide-edge">
                {notes.map((note) => {
                  const Icon = note.voiceAttachmentId || note.kind === 'voice' ? AudioLines : note.kind === 'bookmark' ? Bookmark : FileText;
                  const preview = noteHomePreview(note) || (note.coverAttachmentId ? n.imageNote : n.noText);
                  return <li key={note.id} className="group flex min-w-0 items-center gap-3 py-4">
                    <button type="button" onClick={() => openNote(note.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:ring-2 focus-visible:ring-accent">
                      <span className="flex h-10 w-8 shrink-0 items-center justify-center rounded-md border border-edge text-fg-muted"><Icon className="size-4" aria-hidden /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-fg group-hover:text-accent-fg">{note.title || n.titlePlaceholder}</span>
                        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
                          {note.lastEditTrigger === 'ai_edit' ? <span className="inline-flex shrink-0 items-center gap-1 text-accent-fg"><Sparkles className="size-3" aria-hidden />{h.agentEditLabel}<span aria-hidden>·</span></span> : null}
                          <span className="truncate">{preview}</span>
                        </span>
                      </span>
                    </button>
                    <span className="hidden max-w-32 truncate text-xs text-fg-muted md:block" title={note.projects?.map((p) => p.name).join(' · ')}>{note.projects?.map((p) => p.name).join(' · ') || h.unassigned}</span>
                    <time dateTime={new Date(note.updatedAt).toISOString()} className="hidden w-24 shrink-0 text-right text-xs text-fg-muted sm:block">{formatRelativeTime(note.updatedAt, now, timeLabels)}</time>
                    <button type="button" onClick={() => void toggleFavorite(note.id, !note.pinned)} disabled={pinning.has(note.id)} aria-label={`${note.pinned ? h.unfavorite : h.favorite}: ${note.title || n.titlePlaceholder}`} aria-pressed={Boolean(note.pinned)}
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent">
                      <Star className={cn('size-4', note.pinned && 'fill-current text-fg')} aria-hidden />
                    </button>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button
                          type="button"
                          disabled={deletingNoteId === note.id}
                          aria-label={`${n.noteActions}: ${note.title || n.titlePlaceholder}`}
                          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {deletingNoteId === note.id
                            ? <Loader2 className="size-4 animate-spin" aria-hidden />
                            : <MoreHorizontal className="size-4" aria-hidden />}
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-36 rounded-lg border border-edge bg-surface-panel p-1 shadow-popover">
                          <DropdownMenu.Item
                            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-danger outline-none hover:bg-danger-soft focus:bg-danger-soft"
                            onSelect={() => setDeleteTarget(note)}
                          >
                            <Trash2 className="size-4" aria-hidden />
                            {n.delete}
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </li>;
                })}
              </ul>
            )}
            {!loading && !error && total > 0 ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-fg-muted" aria-live="polite">
              <span>{n.noteCount.replace('{{count}}', String(total))}</span>
              {total > NOTES_HOME_PAGE_SIZE || page > 0 ? <div className="flex items-center gap-2">
                <button type="button" aria-label={h.previousPage} disabled={page === 0} className={quietButton} onClick={() => setParams((current) => { const next = new URLSearchParams(current); next.set('page', String(page - 1)); return next; })}><ArrowLeft className="size-4" aria-hidden /></button>
                <span>{page + 1} / {Math.max(1, Math.ceil(total / NOTES_HOME_PAGE_SIZE))}</span>
                <button type="button" aria-label={h.nextPage} disabled={(page + 1) * NOTES_HOME_PAGE_SIZE >= total} className={quietButton} onClick={() => setParams((current) => { const next = new URLSearchParams(current); next.set('page', String(page + 1)); return next; })}><ArrowRight className="size-4" aria-hidden /></button>
              </div> : null}
            </div> : null}
          </section>
        </div>
      </div>
      <ConfirmDialog
        open={deleteTarget !== null}
        title={n.deleteConfirmTitle}
        description={n.deleteConfirmDescription.replace(
          '{{title}}',
          deleteTarget?.title || n.titlePlaceholder,
        )}
        confirmLabel={n.deleteConfirmLabel}
        cancelLabel={n.deleteCancelLabel}
        destructive
        onConfirm={() => void confirmDeleteNote()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
