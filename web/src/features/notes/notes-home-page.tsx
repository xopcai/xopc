import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Bookmark,
  ChevronDown,
  FileText,
  Folder,
  Hash,
  Inbox,
  Loader2,
  Mic,
  MoreHorizontal,
  NotebookText,
  PanelLeft,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { useDebounce } from 'use-debounce';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { SlidingTabList } from '@/components/ui/sliding-tab-list';
import { listDiscussionDrafts } from '@/features/discussions/discussion-draft-store';
import { openDiscussionCapture } from '@/features/discussions/discussion-events';
import { MeetingImportButton } from '@/features/discussions/meeting-import-button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { htmlLangAttribute } from '@/lib/locale-default';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

import { NoteCoverThumbnail } from './note-cover-thumbnail';
import { NoteDetailPanel } from './note-detail-panel';
import { dateGroupKey, formatDateGroup, formatRelativeTime, type NoteTimeLabels } from './note-time';
import {
  createNote,
  deleteNote,
  listNoteProjects,
  listNotes,
  listNoteTags,
  updateNote,
  type NoteIndexEntry,
} from './notes-api';
import { NotesHomeComposer } from './notes-home-composer';
import { noteHomePreview, noteHomeTitle, notesHomeQuery, NOTES_HOME_PAGE_SIZE } from './notes-home-model';
import { VoiceMiniPlayer } from './voice-mini-player';

const quietButton =
  'touch-target inline-flex min-h-8 items-center justify-center gap-2 rounded-lg px-2.5 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50';

const STREAM_WIDTH_KEY = 'xopc.notes.homeStreamWidth';
const RAIL_OPEN_KEY = 'xopc.notes.homeRailOpen';
const STREAM_MIN_W = 272;
const STREAM_DEFAULT_W = 336;
const STREAM_MAX_W = 480;

function readStreamWidth(): number {
  if (typeof globalThis.localStorage === 'undefined') return STREAM_DEFAULT_W;
  try {
    const parsed = Number(globalThis.localStorage.getItem(STREAM_WIDTH_KEY));
    return Number.isFinite(parsed) && parsed >= STREAM_MIN_W && parsed <= STREAM_MAX_W
      ? parsed
      : STREAM_DEFAULT_W;
  } catch {
    return STREAM_DEFAULT_W;
  }
}

function readRailOpen(): boolean {
  if (typeof globalThis.localStorage === 'undefined') return true;
  try {
    return globalThis.localStorage.getItem(RAIL_OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

export interface NotesHomePageProps {
  selectedNoteId?: string;
}

export function NotesHomePage({ selectedNoteId }: NotesHomePageProps = {}) {
  const language = useLocaleStore((s) => s.language);
  const zh = language === 'zh';
  const n = messages(language).notes;
  const h = n.home;
  const token = useGatewayStore((s) => s.conversationId);
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const navigate = useNavigate();
  const { search: routeSearch } = useLocation();
  const [params, setParams] = useSearchParams();

  const projectId = params.get('projectId') || '';
  const activeTag = params.get('tag')?.trim() || '';
  const view = params.get('view') || 'all';
  const unassigned = params.get('unassigned') === 'true' || view === 'unassigned';
  const search = params.get('search') || '';
  const autoFocusEditor = params.get('edit') === '1';
  const [debouncedSearch] = useDebounce(search, 220);

  const [railOpen, setRailOpen] = useState(readRailOpen);
  const [streamWidth, setStreamWidth] = useState(readStreamWidth);
  const [destination, setDestination] = useState(projectId);
  const [projectSearch, setProjectSearch] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [creatingBlank, setCreatingBlank] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [pinning, setPinning] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<NoteIndexEntry | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  const pinningRef = useRef(new Set<string>());
  const blankRequest = useRef<{ key: string; projectId?: string } | null>(null);
  const blankBusy = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const query = notesHomeQuery(params, debouncedSearch);
  const page = (query.offset ?? 0) / NOTES_HOME_PAGE_SIZE;

  const { data, error, isLoading, mutate } = useSWR(
    token ? ['notes-home', token, query] : null,
    () => listNotes(query),
  );
  const {
    data: projectData,
    error: projectError,
    isLoading: projectsLoading,
    mutate: mutateProjects,
  } = useSWR(token ? ['notes-home-projects', token] : null, listNoteProjects);
  const { data: tagData, mutate: mutateTags } = useSWR(
    token ? ['notes-home-tags', token] : null,
    () => listNoteTags().catch(() => ({ items: [] })),
  );
  const { data: rawRecoverableDrafts = [], mutate: mutateRecoveries } = useSWR(
    token ? ['notes-home-recoveries', token] : null,
    () => listDiscussionDrafts().catch(() => []),
  );
  const recoverableDrafts = useMemo(
    () =>
      rawRecoverableDrafts.filter(
        (draft) =>
          draft.chunkCount > 0 &&
          (draft.state !== 'recording' || Date.now() - draft.updatedAt > 20_000),
      ),
    [rawRecoverableDrafts],
  );

  const projects = projectData?.items ?? [];
  const tags = tagData?.items ?? [];
  const activeProjects = projects.filter((project) => project.noteCount > 0).slice(0, 4);
  const selectedProject = projects.find((p) => p.id === projectId);
  const currentProjectLabel = selectedProject?.name ?? h.projectNotes;
  const notes = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;
  const loading = isLoading || search !== debouncedSearch;

  const timeLabels: NoteTimeLabels = useMemo(
    () => ({
      justNow: n.justNow,
      minutesAgo: n.minutesAgo,
      today: n.today,
      yesterday: n.yesterday,
      daysAgo: n.daysAgo,
      locale: htmlLangAttribute(language),
    }),
    [language, n.justNow, n.minutesAgo, n.today, n.yesterday, n.daysAgo],
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setDestination(projectId);
  }, [projectId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const toggleRail = useCallback(() => {
    setRailOpen((prev) => {
      const next = !prev;
      try {
        globalThis.localStorage?.setItem(RAIL_OPEN_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    void mutate().catch(() => undefined);
    void mutateProjects().catch(() => undefined);
    void mutateTags().catch(() => undefined);
    void mutateRecoveries().catch(() => undefined);
  }, [mutate, mutateProjects, mutateTags, mutateRecoveries]);

  useEffect(() => {
    const events = [
      'note-updated',
      'note-created',
      'note-deleted',
      'project-updated',
      'project-created',
      'project-deleted',
      'discussion-drafts-changed',
    ];
    events.forEach((event) => window.addEventListener(event, refresh));
    return () => events.forEach((event) => window.removeEventListener(event, refresh));
  }, [refresh]);

  const buildFilterSearchString = useCallback(
    (extra?: { edit?: boolean }) => {
      const next = new URLSearchParams(routeSearch);
      next.delete('returnTo');
      if (extra?.edit) next.set('edit', '1');
      else next.delete('edit');
      const qs = next.toString();
      return qs ? `?${qs}` : '';
    },
    [routeSearch],
  );

  const openNote = useCallback(
    (id: string, edit = false) => {
      navigate(`/notes/${encodeURIComponent(id)}${buildFilterSearchString({ edit })}`);
    },
    [buildFilterSearchString, navigate],
  );

  const closeSelectedNote = useCallback(() => {
    navigate(`/notes${buildFilterSearchString()}`);
  }, [buildFilterSearchString, navigate]);

  const consumeAutoFocus = useCallback(() => {
    if (!autoFocusEditor) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('edit');
        return next;
      },
      { replace: true },
    );
  }, [autoFocusEditor, setParams]);

  const createBlank = useCallback(async () => {
    if (blankBusy.current || !token) return;
    blankBusy.current = true;
    setCreatingBlank(true);
    setActionError(null);
    blankRequest.current ??= { key: crypto.randomUUID(), projectId: projectId || undefined };
    try {
      const note = await createNote(
        {
          markdown: '',
          kind: 'thought',
          projectId: blankRequest.current.projectId,
          ...(activeTag ? { tags: [activeTag] } : {}),
        },
        blankRequest.current.key,
      );
      blankRequest.current = null;
      refresh();
      openNote(note.id, true);
    } catch (err) {
      setActionError(
        `${n.createBlankFailed}: ${err instanceof Error ? err.message : n.createBlankFailedHint}`,
      );
    } finally {
      blankBusy.current = false;
      setCreatingBlank(false);
    }
  }, [activeTag, n.createBlankFailed, n.createBlankFailedHint, openNote, projectId, refresh, token]);

  const setSearch = useCallback(
    (value: string) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value) next.set('search', value);
          else next.delete('search');
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  function chooseScope(id: string, nextView = 'all') {
    const next = new URLSearchParams();
    if (id) next.set('projectId', id);
    if (nextView === 'unassigned') next.set('unassigned', 'true');
    else if (nextView !== 'all') next.set('view', nextView);
    setDestination(id);
    setParams(next);
  }

  function chooseTag(tag: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (next.get('tag') === tag) next.delete('tag');
      else next.set('tag', tag);
      next.delete('page');
      return next;
    });
  }

  function chooseView(nextView: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (unassigned) next.set('unassigned', 'true');
      if (nextView === 'all') next.delete('view');
      else next.set('view', nextView);
      next.delete('page');
      return next;
    });
  }

  async function toggleFavorite(id: string, pinned: boolean) {
    if (pinningRef.current.has(id)) return;
    pinningRef.current.add(id);
    setPinning(new Set(pinningRef.current));
    setActionError(null);
    try {
      await updateNote(id, { pinned });
      refresh();
    } catch (err) {
      setActionError(
        `${n.actionFailed}: ${err instanceof Error ? err.message : n.quickCaptureFailedHint}`,
      );
    } finally {
      pinningRef.current.delete(id);
      setPinning(new Set(pinningRef.current));
    }
  }

  async function updateNoteStatus(id: string, status: 'inbox' | 'archived' | 'trashed') {
    if (deletingNoteId) return;
    setDeletingNoteId(id);
    setActionError(null);
    try {
      await updateNote(id, { status });
      window.dispatchEvent(new CustomEvent('note-updated', { detail: { noteId: id } }));
      if (selectedNoteId === id && status === 'trashed' && view !== 'trashed') {
        closeSelectedNote();
      }
      refresh();
    } catch (err) {
      setActionError(
        `${n.actionFailed}: ${err instanceof Error ? err.message : n.quickCaptureFailedHint}`,
      );
    } finally {
      setDeletingNoteId(null);
    }
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
      if (selectedNoteId === target.id) {
        closeSelectedNote();
      }
      refresh();
    } catch (err) {
      setActionError(
        `${n.deleteFailed}: ${err instanceof Error ? err.message : n.quickCaptureFailedHint}`,
      );
    } finally {
      setDeletingNoteId(null);
    }
  }

  useLayoutEffect(() => {
    if (!token) {
      clearPageHeader();
      return;
    }
    if (selectedNoteId) {
      // When a note is open in the right canvas, NoteDetailPanel owns the page header.
      return;
    }
    setPageHeader({
      startExtra: null,
      main: <h1 className="truncate text-base font-semibold text-fg">{n.title}</h1>,
      end: (
        <div className={cn('flex min-w-0 items-center gap-2', APP_CHROME_NO_DRAG_CLASS)}>
          <button
            type="button"
            onClick={() => void createBlank()}
            disabled={creatingBlank}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {creatingBlank ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Plus className="size-3.5" aria-hidden />
            )}
            <span className="hidden sm:inline">{h.blankNote}</span>
          </button>
        </div>
      ),
    });
    return () => {
      if (!selectedNoteId) clearPageHeader();
    };
  }, [
    clearPageHeader,
    createBlank,
    creatingBlank,
    h.blankNote,
    n.title,
    selectedNoteId,
    setPageHeader,
    token,
  ]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return;
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void createBlank();
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [createBlank]);

  const handleStreamResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      const pointerId = event.pointerId;
      target.setPointerCapture(pointerId);
      const startX = event.clientX;
      const startW = streamWidth;
      let latestW = startW;

      const onMove = (ev: PointerEvent) => {
        latestW = Math.max(STREAM_MIN_W, Math.min(STREAM_MAX_W, Math.round(startW + (ev.clientX - startX))));
        setStreamWidth(latestW);
      };
      const onEnd = () => {
        try {
          target.releasePointerCapture(pointerId);
        } catch {
          /* ignore */
        }
        try {
          globalThis.localStorage?.setItem(STREAM_WIDTH_KEY, String(latestW));
        } catch {
          /* ignore */
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    },
    [streamWidth],
  );

  const handleListKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (notes.length === 0) return;
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [role="menuitem"]')) return;
      event.preventDefault();
      const currentIdx = selectedNoteId ? notes.findIndex((item) => item.id === selectedNoteId) : -1;
      const nextIdx =
        event.key === 'ArrowDown'
          ? Math.min(notes.length - 1, currentIdx + 1)
          : Math.max(0, currentIdx <= 0 ? 0 : currentIdx - 1);
      const candidate = notes[nextIdx];
      if (candidate) openNote(candidate.id);
    },
    [notes, openNote, selectedNoteId],
  );

  const groupedNotes = useMemo(() => {
    const pinnedItems: NoteIndexEntry[] = [];
    const dateGroups: Array<{ key: string; label: string; items: NoteIndexEntry[] }> = [];
    const byDate = new Map<string, { key: string; label: string; items: NoteIndexEntry[] }>();

    for (const item of notes) {
      if (item.pinned && view !== 'favorites') {
        pinnedItems.push(item);
        continue;
      }
      const key = dateGroupKey(item.updatedAt);
      let group = byDate.get(key);
      if (!group) {
        group = { key, label: formatDateGroup(item.updatedAt, now, timeLabels), items: [] };
        byDate.set(key, group);
        dateGroups.push(group);
      }
      group.items.push(item);
    }

    const sections: Array<{ key: string; label: string; items: NoteIndexEntry[] }> = [];
    if (pinnedItems.length > 0) {
      sections.push({ key: 'pinned', label: zh ? '已置顶' : 'Pinned', items: pinnedItems });
    }
    sections.push(...dateGroups);
    return sections;
  }, [notes, now, timeLabels, view, zh]);

  if (!token) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-fg-muted">
        {n.needToken}
      </div>
    );
  }

  const primaryViews = [
    { id: 'all', label: h.homeNav, Icon: NotebookText },
    { id: 'favorites', label: h.favorites, Icon: Pin },
    { id: 'voice', label: zh ? '录音' : 'Recordings', Icon: AudioLines },
  ];
  const lifecycleViews = [
    { id: 'archived', label: n.filterArchived, Icon: Archive },
    { id: 'trashed', label: zh ? '回收站' : 'Trash', Icon: Trash2 },
  ];

  const scopeValue = projectId ? `project:${projectId}` : unassigned ? 'unassigned' : 'all';
  const streamHeading = activeTag
    ? `#${activeTag}`
    : view === 'favorites' || view === 'pinned'
      ? h.favorites
      : view === 'voice'
        ? zh
          ? '录音'
          : 'Recordings'
        : view === 'agent'
          ? h.agentEdited
          : view === 'archived'
            ? n.filterArchived
            : view === 'trashed'
              ? zh
                ? '回收站'
                : 'Trash'
              : projectId
                ? currentProjectLabel
                : unassigned
                  ? h.unassigned
                  : h.allNotes;

  return (
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden bg-surface-panel">
      {/* Column 1: Collapsible 3-Group Navigation Rail (Views -> Projects/Tags -> Lifecycle) */}
      {railOpen ? (
        <aside
          aria-label={h.homeNav}
          className="hidden w-52 shrink-0 flex-col border-r border-edge-subtle bg-surface-base/60 px-2.5 py-3 lg:flex"
        >
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              {zh ? '视图' : 'Views'}
            </span>
            <button
              type="button"
              onClick={toggleRail}
              title={zh ? '收起分类侧栏' : 'Collapse navigation rail'}
              aria-label={zh ? '收起分类侧栏' : 'Collapse navigation rail'}
              aria-expanded={true}
              className="inline-flex size-6 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <PanelLeft className="size-3.5" aria-hidden />
            </button>
          </div>

          <div className="flex flex-col gap-0.5">
            {primaryViews.map(({ id, label, Icon }) => {
              const isCurrent =
                !projectId &&
                !activeTag &&
                !unassigned &&
                (id === 'favorites' ? view === 'favorites' || view === 'pinned' : view === id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => chooseScope('', id)}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={cn(
                    quietButton,
                    'min-h-8 justify-start px-2.5 text-left text-xs',
                    isCurrent && 'bg-surface-hover font-medium text-fg',
                  )}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pt-4">
            <div className="mb-1 flex items-center justify-between px-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                {h.projects}
              </span>
              <button
                type="button"
                onClick={() => navigate('/projects')}
                className="text-[11px] text-fg-subtle hover:text-fg"
              >
                {zh ? '全部' : 'All'}
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => chooseScope('', 'unassigned')}
                aria-current={!projectId && !activeTag && unassigned ? 'page' : undefined}
                className={cn(
                  quietButton,
                  'min-h-7 justify-start px-2.5 text-left text-xs',
                  !projectId && !activeTag && unassigned && 'bg-surface-hover font-medium text-fg',
                )}
              >
                <Inbox className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{h.unassigned}</span>
              </button>
              {projectsLoading
                ? [0, 1, 2].map((i) => <Skeleton key={i} className="mb-1.5 h-7 w-full rounded-md" />)
                : projects.slice(0, 10).map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => chooseScope(project.id)}
                      aria-current={projectId === project.id ? 'page' : undefined}
                      className={cn(
                        quietButton,
                        'min-h-7 justify-start px-2.5 text-left text-xs',
                        projectId === project.id && 'bg-surface-hover font-medium text-fg',
                      )}
                    >
                      <Folder className="size-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                      {project.noteCount > 0 ? (
                        <span className="text-[11px] tabular-nums text-fg-subtle">{project.noteCount}</span>
                      ) : null}
                    </button>
                  ))}
            </div>

            {tags.length > 0 ? (
              <div className="mt-5">
                <div className="mb-1 flex items-center justify-between px-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                    {zh ? '标签' : 'Tags'}
                  </span>
                  {activeTag ? (
                    <button
                      type="button"
                      onClick={() => chooseTag(activeTag)}
                      className="text-[11px] text-accent-fg hover:underline"
                    >
                      {zh ? '清除' : 'Clear'}
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-col gap-0.5">
                  {tags.slice(0, 16).map((item) => (
                    <button
                      key={item.tag}
                      type="button"
                      onClick={() => chooseTag(item.tag)}
                      aria-pressed={activeTag === item.tag}
                      className={cn(
                        quietButton,
                        'min-h-7 justify-start px-2.5 text-left text-xs',
                        activeTag === item.tag && 'bg-accent-soft font-medium text-accent-fg',
                      )}
                    >
                      <Hash className="size-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{item.tag}</span>
                      <span className="text-[11px] tabular-nums text-fg-subtle">{item.noteCount}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-2 flex flex-col gap-0.5 border-t border-edge-subtle pt-2.5">
            {lifecycleViews.map(({ id, label, Icon }) => {
              const isCurrent = !projectId && !activeTag && !unassigned && view === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => chooseScope('', id)}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={cn(
                    quietButton,
                    'min-h-7 justify-start px-2.5 text-left text-xs text-fg-subtle',
                    isCurrent && 'bg-surface-hover font-medium text-fg',
                  )}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
            {recoverableDrafts.length > 0 ? (
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('open-recording-recoveries'))}
                className="mt-1 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-2.5 py-2 text-left text-xs font-medium text-accent-fg hover:bg-accent-soft/80"
              >
                <AudioLines className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {zh ? `${recoverableDrafts.length} 条待恢复录音` : `${recoverableDrafts.length} unsynced audio`}
                </span>
              </button>
            ) : null}
          </div>
        </aside>
      ) : null}

      {/* Column 2: Resizable Pinned + Date-Grouped Note Stream */}
      <div
        onKeyDown={handleListKeyDown}
        style={{ '--notes-stream-w': `${streamWidth}px` } as React.CSSProperties}
        className={cn(
          'flex h-full min-h-0 flex-col border-edge-subtle bg-surface-panel lg:w-[var(--notes-stream-w)] lg:shrink-0 lg:border-r',
          selectedNoteId ? 'hidden lg:flex' : 'w-full flex-1 lg:flex-none',
        )}
      >
        {/* Stream Header: Search + Quick Capture Actions */}
        <div className="shrink-0 space-y-2.5 border-b border-edge-subtle px-3 py-3">
          <div className="flex items-center gap-1.5">
            {!railOpen ? (
              <button
                type="button"
                onClick={toggleRail}
                title={zh ? '展开分类侧栏' : 'Expand navigation rail'}
                aria-label={zh ? '展开分类侧栏' : 'Expand navigation rail'}
                aria-expanded={false}
                className="hidden size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:inline-flex"
              >
                <PanelLeft className="size-4" aria-hidden />
              </button>
            ) : null}
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-edge bg-surface-inset px-2.5 focus-within:border-accent">
              <Search className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label={n.searchDialogTitle}
                placeholder={n.searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label={zh ? '清空搜索' : 'Clear search'}
                  className="text-fg-subtle hover:text-fg"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </label>
            <button
              type="button"
              onClick={() => void createBlank()}
              disabled={creatingBlank}
              title={h.blankNote}
              aria-label={h.blankNote}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              {creatingBlank ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Plus className="size-4" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={() => openDiscussionCapture(projectId || undefined)}
              title={h.recordAction}
              aria-label={h.recordAction}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface-panel text-accent-fg hover:bg-surface-hover"
            >
              <Mic className="size-3.5" aria-hidden />
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="truncate text-xs font-semibold text-fg">{streamHeading}</h2>
              {!loading && total > 0 ? (
                <span className="rounded-full bg-surface-inset px-1.5 py-0.5 text-[10px] tabular-nums text-fg-muted">
                  {total}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              {activeTag ? (
                <button
                  type="button"
                  onClick={() => chooseTag(activeTag)}
                  className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent-fg"
                >
                  <span>#{activeTag}</span>
                  <X className="size-2.5" aria-hidden />
                </button>
              ) : null}
              {projectId ? (
                <button
                  type="button"
                  onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-fg-muted hover:bg-surface-hover hover:text-fg"
                >
                  <span>{h.openProject}</span>
                  <ArrowRight className="size-3" aria-hidden />
                </button>
              ) : null}
            </div>
          </div>

          {/* Mobile/Tablet compact scope + view controls */}
          <div className="space-y-2 lg:hidden">
            <PopoverSelect
              value={scopeValue}
              allowEmpty={false}
              ariaLabel={h.projects}
              placeholder={h.allNotes}
              options={[
                { value: 'all', label: h.allNotes },
                { value: 'unassigned', label: h.unassigned },
                ...projects
                  .filter((p) => p.name.toLowerCase().includes(projectSearch.toLowerCase()))
                  .map((p) => ({ value: `project:${p.id}`, label: p.name })),
              ]}
              selectedLabel={projectId ? currentProjectLabel : unassigned ? h.unassigned : h.allNotes}
              triggerClassName="h-8 bg-surface-panel text-xs"
              loading={projectsLoading}
              searchPlaceholder={h.projectSearch}
              searchValue={projectSearch}
              onSearchChange={setProjectSearch}
              onChange={(value) =>
                chooseScope(
                  value.startsWith('project:') ? value.slice(8) : '',
                  value === 'unassigned' ? value : 'all',
                )
              }
            />
            <SlidingTabList
              className="flex flex-wrap items-center gap-x-4 border-b border-edge-subtle"
              aria-label={n.libraryTitle}
              role="group"
            >
              {[
                { id: 'all', label: n.filterAll },
                { id: 'favorites', label: h.favorites },
                { id: 'voice', label: zh ? '录音' : 'Recordings' },
                { id: 'archived', label: n.filterArchived },
                { id: 'trashed', label: zh ? '回收站' : 'Trash' },
              ].map(({ id, label }) => (
                <button
                  type="button"
                  key={id}
                  aria-pressed={view === id || (id === 'all' && view === 'unassigned')}
                  onClick={() => chooseView(id)}
                  className={cn(
                    'touch-target border-b-2 border-transparent py-2 text-xs text-fg-muted hover:text-fg',
                    (view === id || (id === 'all' && view === 'unassigned')) &&
                      'border-fg font-medium text-fg',
                  )}
                >
                  {label}
                </button>
              ))}
            </SlidingTabList>
          </div>
        </div>

        {/* Stream Body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {actionError ? (
            <p
              className="mb-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-xs text-danger"
              role="alert"
            >
              {actionError}
            </p>
          ) : null}

          {recoverableDrafts.length > 0 ? (
            <div className="mb-2.5 flex items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-fg">
              <div className="flex min-w-0 items-center gap-2">
                <AudioLines className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
                <span className="truncate">
                  {zh
                    ? `${recoverableDrafts.length} 条本地录音待恢复或同步`
                    : `${recoverableDrafts.length} local recording(s) need recovery`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('open-recording-recoveries'))}
                className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-on-accent hover:bg-accent-hover"
              >
                {n.discussionCapture.recoveredTitle}
              </button>
            </div>
          ) : null}

          {projectError ? (
            <div role="alert" className="mb-2 flex items-center gap-2 px-2 text-xs text-danger">
              <span>{h.projectsLoadFailed}</span>
              <button
                type="button"
                onClick={() => void mutateProjects().catch(() => undefined)}
                className="underline"
              >
                {h.retry}
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="py-10 text-center" role="alert">
              <p className="text-xs text-danger">{h.loadFailed}</p>
              <button
                type="button"
                onClick={() => void mutate().catch(() => undefined)}
                className={cn(quietButton, 'mt-2')}
              >
                {h.retry}
              </button>
            </div>
          ) : loading ? (
            <div aria-busy="true" className="space-y-2 p-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-xl border border-edge-subtle p-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="mt-2 h-3 w-5/6" />
                  <Skeleton className="mt-2 h-3 w-1/3" />
                </div>
              ))}
            </div>
          ) : notes.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-12 text-center">
              <NotebookText className="mb-3 size-8 text-fg-muted" strokeWidth={1.3} aria-hidden />
              <h4 className="text-sm font-medium text-fg">
                {search || activeTag || (view !== 'all' && view !== 'unassigned')
                  ? h.noMatches
                  : projectId
                    ? h.projectEmpty
                    : h.emptyTitle}
              </h4>
              <p className="mt-1.5 max-w-xs text-xs leading-5 text-fg-muted">
                {search || activeTag || (view !== 'all' && view !== 'unassigned')
                  ? h.noMatchesHint
                  : projectId
                    ? h.projectEmptyHint
                    : h.emptyDescription}
              </p>
              {!search && view !== 'trashed' && view !== 'archived' ? (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => void createBlank()}
                    disabled={creatingBlank}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hover"
                  >
                    <Plus className="size-3.5" aria-hidden />
                    {h.blankNote}
                  </button>
                  <button
                    type="button"
                    onClick={() => openDiscussionCapture(projectId || undefined)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover"
                  >
                    <Mic className="size-3.5 text-accent-fg" aria-hidden />
                    {h.recordAction}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              {groupedNotes.map((section) => (
                <section key={section.key} aria-label={section.label}>
                  <div className="sticky top-0 z-10 bg-surface-panel/95 px-2 py-1 text-[11px] font-semibold text-fg-subtle backdrop-blur-xs">
                    {section.label}
                  </div>
                  <ul className="space-y-1">
                    {section.items.map((note) => {
                      const isSelected = note.id === selectedNoteId;
                      const Icon =
                        note.voiceAttachmentId || note.kind === 'voice'
                          ? AudioLines
                          : note.kind === 'bookmark'
                            ? Bookmark
                            : FileText;
                      const displayTitle = noteHomeTitle(note, n.titlePlaceholder, h.voiceNote);
                      const isVoiceEntry = note.kind === 'voice' || Boolean(note.voiceAttachmentId);
                      const preview =
                        noteHomePreview(note) ||
                        (note.coverAttachmentId
                          ? n.imageNote
                          : isVoiceEntry
                            ? zh
                              ? '音频记录'
                              : 'Audio recording'
                            : n.noText);
                      const durationLabel =
                        note.voiceDurationSec && note.voiceDurationSec > 0
                          ? `${Math.floor(note.voiceDurationSec / 60)}:${String(
                              Math.floor(note.voiceDurationSec % 60),
                            ).padStart(2, '0')}`
                          : null;

                      return (
                        <li
                          key={note.id}
                          className={cn(
                            'group relative rounded-xl border transition-colors',
                            isSelected
                              ? 'border-accent/40 bg-accent-soft/55'
                              : 'border-transparent hover:bg-surface-hover/75',
                          )}
                        >
                          <div className="flex items-start gap-2.5 p-2.5">
                            <button
                              type="button"
                              onClick={() => openNote(note.id)}
                              className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                              <div className="flex items-center gap-1.5">
                                <Icon
                                  className={cn(
                                    'size-3.5 shrink-0',
                                    note.kind === 'voice' || note.voiceAttachmentId
                                      ? 'text-accent-fg'
                                      : 'text-fg-muted',
                                  )}
                                  aria-hidden
                                />
                                <span
                                  className={cn(
                                    'min-w-0 flex-1 truncate text-sm font-medium',
                                    isSelected ? 'text-fg' : 'text-fg group-hover:text-accent-fg',
                                  )}
                                >
                                  {displayTitle}
                                </span>
                                {durationLabel && !note.voiceAttachmentId ? (
                                  <span className="shrink-0 rounded bg-surface-inset px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-fg-muted">
                                    {durationLabel}
                                  </span>
                                ) : null}
                              </div>

                              <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">
                                {note.lastEditTrigger === 'ai_edit' ? (
                                  <span className="mr-1.5 inline-flex items-center gap-0.5 text-accent-fg">
                                    <Sparkles className="size-3" aria-hidden />
                                    {h.agentEditLabel}
                                  </span>
                                ) : null}
                                {preview}
                              </p>

                              {note.voiceAttachmentId ? (
                                <VoiceMiniPlayer
                                  noteId={note.id}
                                  attachmentId={note.voiceAttachmentId}
                                  durationSec={note.voiceDurationSec}
                                  className="mt-2"
                                />
                              ) : null}

                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
                                <time dateTime={new Date(note.updatedAt).toISOString()}>
                                  {formatRelativeTime(note.updatedAt, now, timeLabels)}
                                </time>
                                {note.projects && note.projects.length > 0 ? (
                                  <>
                                    <span aria-hidden>·</span>
                                    <span className="max-w-28 truncate">
                                      {note.projects.map((p) => p.name).join(' · ')}
                                    </span>
                                  </>
                                ) : null}
                                {note.tags?.slice(0, 2).map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded bg-surface-inset px-1.5 py-0.5 text-[10px] text-fg-muted"
                                  >
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            </button>

                            {note.coverAttachmentId ? (
                              <NoteCoverThumbnail
                                noteId={note.id}
                                attachmentId={note.coverAttachmentId}
                                className="size-11 rounded-lg"
                              />
                            ) : null}

                            <div className="flex shrink-0 items-center gap-0.5 opacity-80 group-hover:opacity-100">
                              <button
                                type="button"
                                onClick={() => void toggleFavorite(note.id, !note.pinned)}
                                disabled={pinning.has(note.id)}
                                aria-label={`${note.pinned ? h.unfavorite : h.favorite}: ${displayTitle}`}
                                aria-pressed={Boolean(note.pinned)}
                                className={cn(
                                  'inline-flex size-7 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg disabled:opacity-50',
                                  note.pinned && 'text-fg opacity-100',
                                )}
                              >
                                <Pin
                                  className={cn('size-3.5', note.pinned && 'fill-current text-fg')}
                                  aria-hidden
                                />
                              </button>

                              <DropdownMenu.Root>
                                <DropdownMenu.Trigger asChild>
                                  <button
                                    type="button"
                                    disabled={deletingNoteId === note.id}
                                    aria-label={`${n.noteActions}: ${displayTitle}`}
                                    className="inline-flex size-7 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                                  >
                                    {deletingNoteId === note.id ? (
                                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                                    ) : (
                                      <MoreHorizontal className="size-3.5" aria-hidden />
                                    )}
                                  </button>
                                </DropdownMenu.Trigger>
                                <DropdownMenu.Portal>
                                  <DropdownMenu.Content
                                    align="end"
                                    sideOffset={4}
                                    className="z-50 min-w-40 rounded-lg border border-edge bg-surface-overlay p-1 shadow-popover"
                                  >
                                    {note.status === 'trashed' ? (
                                      <>
                                        <DropdownMenu.Item
                                          className="touch-target flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover"
                                          onSelect={() => void updateNoteStatus(note.id, 'inbox')}
                                        >
                                          <RotateCcw className="size-4 text-fg-muted" aria-hidden />
                                          {zh ? '恢复笔记' : 'Restore'}
                                        </DropdownMenu.Item>
                                        <DropdownMenu.Separator className="my-1 h-px bg-edge-subtle" />
                                        <DropdownMenu.Item
                                          className="touch-target flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-danger outline-none hover:bg-danger-soft focus:bg-danger-soft"
                                          onSelect={() => setDeleteTarget(note)}
                                        >
                                          <Trash2 className="size-4" aria-hidden />
                                          {zh ? '彻底删除' : 'Delete permanently'}
                                        </DropdownMenu.Item>
                                      </>
                                    ) : (
                                      <>
                                        <DropdownMenu.Item
                                          className="touch-target flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover"
                                          onSelect={() =>
                                            void updateNoteStatus(
                                              note.id,
                                              note.status === 'archived' ? 'inbox' : 'archived',
                                            )
                                          }
                                        >
                                          {note.status === 'archived' ? (
                                            <ArchiveRestore className="size-4 text-fg-muted" aria-hidden />
                                          ) : (
                                            <Archive className="size-4 text-fg-muted" aria-hidden />
                                          )}
                                          {note.status === 'archived'
                                            ? zh
                                              ? '取消归档'
                                              : 'Unarchive'
                                            : zh
                                              ? '归档'
                                              : 'Archive'}
                                        </DropdownMenu.Item>
                                        <DropdownMenu.Separator className="my-1 h-px bg-edge-subtle" />
                                        <DropdownMenu.Item
                                          className="touch-target flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-danger outline-none hover:bg-danger-soft focus:bg-danger-soft"
                                          onSelect={() => void updateNoteStatus(note.id, 'trashed')}
                                        >
                                          <Trash2 className="size-4" aria-hidden />
                                          {zh ? '移至回收站' : 'Move to Trash'}
                                        </DropdownMenu.Item>
                                      </>
                                    )}
                                  </DropdownMenu.Content>
                                </DropdownMenu.Portal>
                              </DropdownMenu.Root>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Stream Footer: Pagination */}
        {!loading && !error && total > 0 ? (
          <div
            className="flex shrink-0 items-center justify-between gap-2 border-t border-edge-subtle px-3 py-2 text-xs text-fg-muted"
            aria-live="polite"
          >
            <span>{n.noteCount.replace('{{count}}', String(total))}</span>
            {total > NOTES_HOME_PAGE_SIZE || page > 0 ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={h.previousPage}
                  disabled={page === 0}
                  className={cn(quietButton, 'min-h-7 px-1.5')}
                  onClick={() =>
                    setParams((current) => {
                      const next = new URLSearchParams(current);
                      next.set('page', String(page - 1));
                      return next;
                    })
                  }
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                </button>
                <span className="tabular-nums">
                  {page + 1} / {Math.max(1, Math.ceil(total / NOTES_HOME_PAGE_SIZE))}
                </span>
                <button
                  type="button"
                  aria-label={h.nextPage}
                  disabled={(page + 1) * NOTES_HOME_PAGE_SIZE >= total}
                  className={cn(quietButton, 'min-h-7 px-1.5')}
                  onClick={() =>
                    setParams((current) => {
                      const next = new URLSearchParams(current);
                      next.set('page', String(page + 1));
                      return next;
                    })
                  }
                >
                  <ArrowRight className="size-3.5" aria-hidden />
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Resizable Divider between Stream and Canvas (Desktop) */}
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={handleStreamResizeStart}
        className="hidden w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent/35 active:bg-accent/60 lg:block"
      />

      {/* Column 3: Instant Note Detail / Recording Canvas or Quick-Launch Workspace */}
      <main
        className={cn(
          'min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-panel',
          selectedNoteId ? 'flex' : 'hidden lg:flex',
        )}
      >
        {selectedNoteId ? (
          <NoteDetailPanel
            key={selectedNoteId}
            noteId={selectedNoteId}
            onBack={closeSelectedNote}
            onSaved={refresh}
            showBackButton
            backButtonClassName="lg:hidden"
            clearHeaderOnCleanup
            onOpenSearch={() => searchRef.current?.focus()}
            autoFocus={autoFocusEditor}
            onAutoFocusConsumed={consumeAutoFocus}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto px-6 py-8 xl:px-12">
            <div className="mx-auto w-full max-w-3xl">
              <div className="mb-6">
                <h2 className="text-2xl font-semibold tracking-tight text-fg">
                  {projectId ? currentProjectLabel : h.continueTitle}
                </h2>
                <p className="mt-1 text-sm text-fg-muted">
                  {projectId ? h.projectDescription : h.continueDescription}
                </p>
              </div>

              <section aria-label={h.startAction}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => void createBlank()}
                    disabled={creatingBlank}
                    className="touch-target flex min-h-22 items-center gap-3 rounded-xl border border-edge bg-surface-panel p-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                  >
                    {creatingBlank ? (
                      <Loader2 className="size-5 shrink-0 animate-spin text-fg-muted" aria-hidden />
                    ) : (
                      <Plus className="size-5 shrink-0 text-fg-muted" aria-hidden />
                    )}
                    <span>
                      <span className="block text-sm font-semibold text-fg">{h.blankNote}</span>
                      <span className="mt-1 block text-xs leading-5 text-fg-muted">
                        {h.blankActionHint}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={h.recordAction}
                    onClick={() => openDiscussionCapture(projectId || undefined)}
                    className="touch-target flex min-h-22 items-center gap-3 rounded-xl border border-edge bg-surface-panel p-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Mic className="size-5 shrink-0 text-accent-fg" aria-hidden />
                    <span>
                      <span className="block text-sm font-semibold text-fg">{h.recordAction}</span>
                      <span className="mt-1 block text-xs leading-5 text-fg-muted">
                        {h.recordActionHint}
                      </span>
                    </span>
                  </button>
                  <MeetingImportButton projectId={projectId || undefined} />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setComposerOpen((open) => !open);
                    if (!composerOpen) {
                      window.requestAnimationFrame(() =>
                        document.getElementById('notes-home-prompt')?.focus(),
                      );
                    }
                  }}
                  aria-expanded={composerOpen}
                  aria-controls="notes-home-agent-composer"
                  title={h.agentActionHint}
                  className="touch-target mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Sparkles className="size-4 text-accent-fg" aria-hidden />
                  {h.agentAction}
                  <ChevronDown
                    className={cn('size-4 transition-transform', composerOpen && 'rotate-180')}
                    aria-hidden
                  />
                </button>
                <div
                  id="notes-home-agent-composer"
                  hidden={!composerOpen}
                  className={cn('mt-3', !composerOpen && 'hidden')}
                >
                  <NotesHomeComposer
                    projects={projects}
                    projectId={destination}
                    onProjectChange={setDestination}
                    onCreated={refresh}
                    labels={n}
                    projectsLoading={projectsLoading}
                    projectsError={Boolean(projectError)}
                  />
                </div>
              </section>

              {!projectId && !unassigned && (projectsLoading || activeProjects.length > 0) ? (
                <section className="mt-8" aria-label={h.continueProjects}>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-fg">{h.continueProjects}</h3>
                    <button
                      type="button"
                      onClick={() => navigate('/projects')}
                      className="text-xs text-fg-muted hover:text-fg"
                    >
                      {h.allProjects}
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {projectsLoading
                      ? [0, 1].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
                      : activeProjects.map((project) => (
                          <button
                            key={project.id}
                            type="button"
                            onClick={() => chooseScope(project.id)}
                            className="min-w-0 rounded-xl border border-edge bg-surface-panel p-4 text-left transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <span className="flex items-center gap-2 text-sm font-medium text-fg">
                              <Folder className="size-4 shrink-0 text-fg-muted" aria-hidden />
                              <span className="truncate">{project.name}</span>
                            </span>
                            {project.description ? (
                              <p className="mt-1.5 line-clamp-1 text-xs text-fg-muted">
                                {project.description}
                              </p>
                            ) : null}
                            <span className="mt-3 flex items-center justify-between gap-2 text-xs text-fg-subtle">
                              <span>{n.noteCount.replace('{{count}}', String(project.noteCount))}</span>
                              <span>
                                {project.updatedAt
                                  ? formatRelativeTime(project.updatedAt, now, timeLabels)
                                  : h.emptyProject}
                              </span>
                            </span>
                          </button>
                        ))}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        )}
      </main>

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
