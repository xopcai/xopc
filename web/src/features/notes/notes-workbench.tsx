import * as Dialog from '@radix-ui/react-dialog';
import {
  Archive,
  Bookmark,
  CheckSquare,
  Clock3,
  Image,
  Inbox,
  Layers3,
  Mic,
  PanelLeft,
  Pin,
  Plus,
  Search,
  StickyNote,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import useSWR from 'swr';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { openDiscussionCapture } from '@/features/discussions/discussion-events';
import { uiPatchReducer } from '@/lib/settings-form-draft';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

import { NoteCard } from './note-card';
import { NoteDetailPanel } from './note-detail-panel';
import { QuickCaptureBar } from './quick-capture-bar';
import { dateGroupKey, formatDateGroup, formatRelativeTime, type NoteTimeLabels } from './note-time';
import {
  deleteNote,
  createNote,
  listNotes,
  quickCapture,
  quickCaptureImage,
  quickCaptureVoice,
  updateNote,
  type NoteIndexEntry,
  type NoteKind,
  type NoteStatus,
} from './notes-api';
import { showToast } from '@/lib/toast';

type StatusFilter = 'all' | NoteStatus;
type KindFilter = 'all' | NoteKind;

type NotesUi = {
  statusFilter: StatusFilter;
  kindFilter: KindFilter;
  pinnedOnly: boolean;
};

const initialUi: NotesUi = {
  statusFilter: 'all',
  kindFilter: 'all',
  pinnedOnly: false,
};

const NOTES_LIST_MIN_WIDTH = 240;
const NOTES_LIST_DEFAULT_WIDTH = 320;
const NOTES_LIST_MAX_WIDTH = 520;
const NOTES_EDITOR_MIN_WIDTH = 560;

function readStoredNotesListWidth(storageKey: string): number {
  if (typeof globalThis.localStorage === 'undefined') return NOTES_LIST_DEFAULT_WIDTH;
  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (!raw) return NOTES_LIST_DEFAULT_WIDTH;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : NOTES_LIST_DEFAULT_WIDTH;
  } catch {
    return NOTES_LIST_DEFAULT_WIDTH;
  }
}

function writeStoredNotesListWidth(storageKey: string, width: number): void {
  if (typeof globalThis.localStorage === 'undefined') return;
  try {
    globalThis.localStorage.setItem(storageKey, String(Math.round(width)));
  } catch {
    // Ignore storage failures; the drag interaction should still work.
  }
}

type LibraryView = {
  id: string;
  label: string;
  description: string;
  icon: typeof StickyNote;
  patch: Pick<NotesUi, 'statusFilter' | 'kindFilter' | 'pinnedOnly'>;
};

const SEARCH_KIND_ICON: Record<NoteKind, typeof StickyNote> = {
  thought: StickyNote,
  todo: CheckSquare,
  voice: Mic,
  media: Image,
  bookmark: Bookmark,
  mixed: StickyNote,
  task: CheckSquare,
};

function noteResultPreview(note: NoteIndexEntry, labels: { imageNote: string; noText: string }): string {
  if (note.snippet?.trim()) return note.snippet;
  if (note.coverAttachmentId) return labels.imageNote;
  return labels.noText;
}

function sameView(ui: NotesUi, view: LibraryView) {
  return (
    ui.statusFilter === view.patch.statusFilter
    && ui.kindFilter === view.patch.kindFilter
    && ui.pinnedOnly === view.patch.pinnedOnly
  );
}

export interface NotesWorkbenchProps {
  selectedNoteId?: string;
  basePath: string;
  managePageHeader?: boolean;
  showLibrary?: boolean;
  allowMediaCapture?: boolean;
  projectId?: string;
  listTitle?: string;
  listDescription?: string;
  emptyText?: string;
  emptyDescription?: string;
  listWidthStorageKey?: string;
}

function notePath(basePath: string, noteId: string): string {
  return `${basePath.replace(/\/$/, '')}/${encodeURIComponent(noteId)}`;
}

export function NotesWorkbench({
  selectedNoteId,
  basePath,
  managePageHeader = false,
  showLibrary = true,
  allowMediaCapture = true,
  projectId,
  listTitle,
  listDescription,
  emptyText,
  emptyDescription,
  listWidthStorageKey = 'xopc.notes.listWidth',
}: NotesWorkbenchProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const n = m.notes;
  const token = useGatewayStore((s) => s.token);
  const hasToken = Boolean(token);

  const [ui, dispatch] = useReducer(uiPatchReducer<NotesUi>, initialUi);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [notesListWidth, setNotesListWidth] = useState(() => readStoredNotesListWidth(listWidthStorageKey));
  const [resizingList, setResizingList] = useState(false);
  const [notesListCollapsed, setNotesListCollapsed] = useState(false);
  const [creatingBlankNote, setCreatingBlankNote] = useState(false);
  const [autoFocusNoteId, setAutoFocusNoteId] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const notesListRef = useRef<HTMLElement>(null);
  const [nowMs] = useState(() => Date.now());
  const navigate = useNavigate();

  const clampNotesListWidth = useCallback((width: number) => {
    const workspaceWidth = workspaceRef.current?.clientWidth ?? window.innerWidth;
    const availableMax = Math.max(NOTES_LIST_MIN_WIDTH, workspaceWidth - NOTES_EDITOR_MIN_WIDTH);
    const maxWidth = Math.min(NOTES_LIST_MAX_WIDTH, availableMax);
    return Math.max(NOTES_LIST_MIN_WIDTH, Math.min(maxWidth, width));
  }, []);

  const commitNotesListWidth = useCallback((width: number) => {
    const nextWidth = clampNotesListWidth(width);
    setNotesListWidth(nextWidth);
    writeStoredNotesListWidth(listWidthStorageKey, nextWidth);
  }, [clampNotesListWidth, listWidthStorageKey]);

  useLayoutEffect(() => {
    setNotesListWidth((width) => clampNotesListWidth(width));
  }, [clampNotesListWidth]);

  const swrKey = useMemo(
    () =>
      hasToken
        ? ['notes-list', projectId, ui.statusFilter, ui.kindFilter, ui.pinnedOnly]
        : null,
    [hasToken, projectId, ui.statusFilter, ui.kindFilter, ui.pinnedOnly],
  );

  const { data, mutate, isLoading } = useSWR(swrKey, () =>
    listNotes({
      status: ui.statusFilter === 'all' ? undefined : ui.statusFilter,
      kind: ui.kindFilter === 'all' ? undefined : ui.kindFilter,
      projectId,
      pinned: ui.pinnedOnly ? true : undefined,
      limit: 100,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    }),
    { keepPreviousData: true },
  );

  // Only show skeleton on true first load (no data at all yet).
  // When switching tabs, previous data is retained so we skip the skeleton.
  const showSkeleton = isLoading && !data;
  const notes = data?.items ?? [];
  const total = data?.total ?? 0;
  const trimmedSearchQuery = searchQuery.trim();
  const { data: searchData, isLoading: searchLoading } = useSWR(
    hasToken && searchOpen && trimmedSearchQuery
      ? ['notes-search', projectId, trimmedSearchQuery]
      : null,
    () =>
      listNotes({
        search: trimmedSearchQuery,
        projectId,
        limit: 30,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      }),
  );
  const searchResults = searchData?.items ?? [];
  const selectedNoteInCurrentList = selectedNoteId ? notes.some((note) => note.id === selectedNoteId) : true;

  useEffect(() => {
    setActiveSearchIndex(0);
  }, [trimmedSearchQuery]);

  useEffect(() => {
    if (activeSearchIndex >= searchResults.length) {
      setActiveSearchIndex(Math.max(0, searchResults.length - 1));
    }
  }, [activeSearchIndex, searchResults.length]);

  useEffect(() => {
    const onNoteUpdated = () => {
      void mutate();
    };
    window.addEventListener('note-updated', onNoteUpdated);
    return () => window.removeEventListener('note-updated', onNoteUpdated);
  }, [mutate]);

  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const noteCountLabel = total > 0 ? n.noteCount.replace('{{count}}', String(total)) : null;
  const searchDialogTitle = n.searchDialogTitle;
  const closeSearchLabel = n.searchClose;
  const clearSearchLabel = n.searchClear;

  const headerEnd = useMemo(
    () => (
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-lg border border-edge bg-surface-base px-3 text-sm font-medium text-fg',
          'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          APP_CHROME_NO_DRAG_CLASS,
        )}
        aria-label={searchDialogTitle}
      >
        <Search className="size-4" aria-hidden />
        <span className="hidden sm:inline">{searchDialogTitle}</span>
      </button>
    ),
    [searchDialogTitle],
  );

  useLayoutEffect(() => {
    if (!managePageHeader) return undefined;
    if (!hasToken) {
      clearPageHeader();
      return () => clearPageHeader();
    }
    setPageHeader({
      startExtra: null,
      main: (
        <div
          className={cn(
            'flex min-w-0 items-center gap-2',
            APP_CHROME_NO_DRAG_CLASS,
          )}
        >
          <h1 className="min-w-0 truncate text-base font-semibold tracking-tight text-fg">{listTitle ?? n.title}</h1>
          {noteCountLabel ? (
            <span className="shrink-0 text-xs text-fg-muted">{noteCountLabel}</span>
          ) : null}
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, hasToken, headerEnd, listTitle, managePageHeader, n.title, noteCountLabel, selectedNoteId, setPageHeader]);

  const timeLabels: NoteTimeLabels = useMemo(() => ({
    justNow: n.justNow,
    minutesAgo: n.minutesAgo,
    today: n.today,
    yesterday: n.yesterday,
    daysAgo: n.daysAgo,
  }), [n.justNow, n.minutesAgo, n.today, n.yesterday, n.daysAgo]);

  const libraryViews = useMemo<LibraryView[]>(() => [
    {
      id: 'recent',
      label: n.viewRecent,
      description: n.viewRecentDescription,
      icon: Clock3,
      patch: { statusFilter: 'all', kindFilter: 'all', pinnedOnly: false },
    },
    {
      id: 'inbox',
      label: n.filterInbox,
      description: n.viewInboxDescription,
      icon: Inbox,
      patch: { statusFilter: 'inbox', kindFilter: 'all', pinnedOnly: false },
    },
    {
      id: 'pinned',
      label: n.pinned,
      description: n.viewPinnedDescription,
      icon: Pin,
      patch: { statusFilter: 'all', kindFilter: 'all', pinnedOnly: true },
    },
    {
      id: 'tasks',
      label: n.viewTasks,
      description: n.viewTasksDescription,
      icon: CheckSquare,
      patch: { statusFilter: 'all', kindFilter: 'todo', pinnedOnly: false },
    },
    {
      id: 'voice',
      label: n.kindVoice,
      description: n.viewVoiceDescription,
      icon: Mic,
      patch: { statusFilter: 'all', kindFilter: 'voice', pinnedOnly: false },
    },
    {
      id: 'media',
      label: n.kindMedia,
      description: n.viewMediaDescription,
      icon: Image,
      patch: { statusFilter: 'all', kindFilter: 'media', pinnedOnly: false },
    },
    {
      id: 'bookmarks',
      label: n.kindBookmark,
      description: n.viewBookmarksDescription,
      icon: Bookmark,
      patch: { statusFilter: 'all', kindFilter: 'bookmark', pinnedOnly: false },
    },
    {
      id: 'processed',
      label: n.filterProcessed,
      description: n.viewProcessedDescription,
      icon: Layers3,
      patch: { statusFilter: 'processed', kindFilter: 'all', pinnedOnly: false },
    },
    {
      id: 'archive',
      label: n.filterArchived,
      description: n.viewArchiveDescription,
      icon: Archive,
      patch: { statusFilter: 'archived', kindFilter: 'all', pinnedOnly: false },
    },
  ], [
    n.filterArchived,
    n.filterInbox,
    n.filterProcessed,
    n.kindBookmark,
    n.kindMedia,
    n.kindVoice,
    n.pinned,
    n.viewArchiveDescription,
    n.viewBookmarksDescription,
    n.viewInboxDescription,
    n.viewMediaDescription,
    n.viewPinnedDescription,
    n.viewProcessedDescription,
    n.viewRecent,
    n.viewRecentDescription,
    n.viewTasks,
    n.viewTasksDescription,
    n.viewVoiceDescription,
  ]);

  const activeLibraryView = libraryViews.find((view) => sameView(ui, view)) ?? libraryViews[0];
  const effectiveListTitle = listTitle ?? activeLibraryView.label;
  const effectiveListDescription = listDescription ?? activeLibraryView.description;

  const handleCapture = useCallback(
    async (text: string, opts?: { navigate?: boolean }) => {
      const note = projectId
        ? await createNote({ markdown: text, kind: 'thought', projectId, channel: 'web' })
        : await quickCapture(text, 'web');
      await mutate();
      if (opts?.navigate !== false) {
        navigate(notePath(basePath, note.id));
      }
    },
    [basePath, mutate, navigate, projectId],
  );

  const handleCreateBlankNote = useCallback(async () => {
    if (creatingBlankNote) return;
    setCreatingBlankNote(true);
    try {
      const note = await createNote({
        markdown: '',
        kind: 'thought',
        projectId,
        channel: 'web',
      });
      dispatch({ type: 'patch', patch: initialUi });
      await mutate();
      setAutoFocusNoteId(note.id);
      navigate(notePath(basePath, note.id));
    } catch (err) {
      showToast({
        type: 'error',
        title: n.createBlankFailed,
        message: err instanceof Error ? err.message : n.createBlankFailedHint,
      });
    } finally {
      setCreatingBlankNote(false);
    }
  }, [basePath, creatingBlankNote, mutate, n.createBlankFailed, n.createBlankFailedHint, navigate, projectId]);

  const handleImagePick = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await quickCaptureImage(file, 'web');
        await mutate();
      } catch (err) {
        showToast({
          type: 'error',
          title: n.imageUploadFailed,
          message: err instanceof Error ? err.message : n.imageUploadFailedHint,
        });
      }
    };
    input.click();
  }, [mutate, n.imageUploadFailed, n.imageUploadFailedHint]);

  const handleVoiceCapture = useCallback(
    async (file: File, durationSec: number) => {
      try {
        await quickCaptureVoice(file, durationSec, 'web');
        await mutate();
      } catch (err) {
        showToast({
          type: 'error',
          title: n.voiceUploadFailed,
          message: err instanceof Error ? err.message : n.voiceUploadFailedHint,
        });
      }
    },
    [mutate, n.voiceUploadFailed, n.voiceUploadFailedHint],
  );

  const handlePin = useCallback(
    async (id: string, pinned: boolean) => {
      await updateNote(id, { pinned });
      await mutate();
    },
    [mutate],
  );

  const handleArchive = useCallback(
    async (id: string) => {
      await updateNote(id, { status: 'archived' });
      await mutate();
    },
    [mutate],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteNote(id);
      await mutate();
    },
    [mutate],
  );

  const handleNoteClick = useCallback((id: string) => {
    navigate(notePath(basePath, id));
  }, [basePath, navigate]);

  const openSearchResult = useCallback((noteId: string) => {
    navigate(notePath(basePath, noteId));
    setSearchOpen(false);
  }, [basePath, navigate]);

  const handleSearchKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (!searchResults.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveSearchIndex((index) => Math.min(searchResults.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveSearchIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const result = searchResults[activeSearchIndex] ?? searchResults[0];
      if (result) openSearchResult(result.id);
    }
  }, [activeSearchIndex, openSearchResult, searchResults]);

  const handleListResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const el = event.currentTarget;
    const listEl = notesListRef.current;
    el.setPointerCapture(event.pointerId);
    setResizingList(true);

    const workspaceWidth = workspaceRef.current?.clientWidth ?? window.innerWidth;
    const availableMax = Math.max(NOTES_LIST_MIN_WIDTH, workspaceWidth - NOTES_EDITOR_MIN_WIDTH);
    const maxWidth = Math.min(NOTES_LIST_MAX_WIDTH, availableMax);
    const clampWidth = (width: number) => Math.max(NOTES_LIST_MIN_WIDTH, Math.min(maxWidth, width));
    const startX = event.clientX;
    const startWidth = clampWidth(notesListWidth);
    const pointerId = event.pointerId;
    let rafId = 0;
    let nextWidth = startWidth;
    let committedWidth = startWidth;

    if (listEl) {
      listEl.style.transition = 'none';
      listEl.style.width = `${startWidth}px`;
    }

    const applyWidth = () => {
      rafId = 0;
      committedWidth = nextWidth;
      if (listEl) {
        listEl.style.width = `${committedWidth}px`;
      }
    };

    const onMove = (moveEvent: PointerEvent) => {
      nextWidth = clampWidth(startWidth + moveEvent.clientX - startX);
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
        el.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
      setResizingList(false);
      workspaceRef.current?.style.setProperty('--notes-list-width', `${committedWidth}px`);
      if (listEl) {
        listEl.style.removeProperty('transition');
        listEl.style.removeProperty('width');
      }
      setNotesListWidth(committedWidth);
      writeStoredNotesListWidth(listWidthStorageKey, committedWidth);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onDone);
      window.removeEventListener('pointercancel', onDone);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onDone);
    window.addEventListener('pointercancel', onDone);
  }, [listWidthStorageKey, notesListWidth]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.key.toLowerCase() !== 'n' || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) {
        return;
      }
      event.preventDefault();
      void handleCreateBlankNote();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleCreateBlankNote]);

  const handleListResizeKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      commitNotesListWidth(notesListWidth - 16);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      commitNotesListWidth(notesListWidth + 16);
    } else if (event.key === 'Home') {
      event.preventDefault();
      commitNotesListWidth(NOTES_LIST_MIN_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      commitNotesListWidth(NOTES_LIST_MAX_WIDTH);
    }
  }, [commitNotesListWidth, notesListWidth]);

  if (!hasToken) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <StickyNote className="size-10 text-fg-muted" />
        <p className="text-sm text-fg-muted">{n.needToken}</p>
      </div>
    );
  }

  return (
    <div
      ref={workspaceRef}
      className="flex h-full min-h-0 w-full flex-1 overflow-hidden bg-surface-base"
      style={{ '--notes-list-width': `${notesListWidth}px` } as CSSProperties}
    >
      <section
        ref={notesListRef}
        className={cn(
          'relative flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-r border-edge bg-surface-rail',
          !resizingList && 'lg:transition-[width] lg:duration-[280ms] lg:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:lg:transition-none',
          notesListCollapsed ? 'lg:w-0 lg:min-w-0 lg:max-w-0 lg:pointer-events-none' : 'lg:w-[var(--notes-list-width)]',
          selectedNoteId && 'hidden lg:flex',
        )}
        aria-hidden={notesListCollapsed ? true : undefined}
      >
        <div className="shrink-0 border-b border-edge-subtle p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              {showLibrary ? (
                <Select
                  value={activeLibraryView.id}
                  onChange={(event) => {
                    const next = libraryViews.find((view) => view.id === event.target.value);
                    if (next) dispatch({ type: 'patch', patch: next.patch });
                  }}
                  className="-ml-1 block max-w-44 truncate rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-fg transition-colors hover:border-edge hover:bg-surface-base focus:border-accent focus:bg-surface-base focus:outline-none focus:ring-1 focus:ring-accent"
                  aria-label={n.libraryTitle}
                >
                  {libraryViews.map((view) => (
                    <SelectOption key={view.id} value={view.id}>{view.label}</SelectOption>
                  ))}
                </Select>
              ) : (
                <h2 className="truncate text-sm font-semibold text-fg">{effectiveListTitle}</h2>
              )}
              <p className="truncate text-xs text-fg-muted">
                {noteCountLabel ?? effectiveListDescription}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setNotesListCollapsed(true)}
                className="hidden size-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:inline-flex"
                aria-label={n.collapseNotesList}
                title={n.collapseNotesList}
              >
                <PanelLeft className="size-4" strokeWidth={1.5} aria-hidden />
              </button>
              <button
                type="button"
                onClick={handleCreateBlankNote}
                disabled={creatingBlankNote}
                className="inline-flex size-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={n.createBlankNote}
                title={n.createBlankShortcut}
              >
                <Plus className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="inline-flex size-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={n.searchDialogTitle}
              >
                <Search className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3 [scrollbar-gutter:stable]">
          {showSkeleton ? (
            <div className="flex flex-col gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-surface-hover" />
              ))}
            </div>
          ) : notes.length === 0 ? (
            <div className="flex min-h-[min(40vh,20rem)] flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <StickyNote className="size-8 text-fg-muted" />
              <p className="text-sm font-medium text-fg-muted">
                {selectedNoteId && !selectedNoteInCurrentList ? n.noteOutsideCurrentView : (emptyText ?? n.noNotes)}
              </p>
              {selectedNoteId && !selectedNoteInCurrentList ? null : (
                <p className="text-xs leading-5 text-fg-muted">{emptyDescription ?? n.noNotesDescription}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {selectedNoteId && !selectedNoteInCurrentList ? (
                <div className="mb-2 rounded-lg border border-edge-subtle bg-surface-base px-3 py-2 text-xs leading-5 text-fg-muted">
                  {n.noteOutsideCurrentView}
                </div>
              ) : null}
              {notes.map((note, idx) => {
                const prevKey = idx > 0 ? dateGroupKey(notes[idx - 1].createdAt) : null;
                const currentKey = dateGroupKey(note.createdAt);
                const showDateHeader = currentKey !== prevKey;

                return (
                  <div key={note.id}>
                    {showDateHeader && (
                      <div className={cn('px-3 pb-1.5 pt-2 text-xs font-medium text-fg-muted', idx === 0 && 'pt-0')}>
                        {formatDateGroup(note.createdAt, nowMs, timeLabels)}
                      </div>
                    )}
                    <NoteCard
                      note={note}
                      selected={note.id === selectedNoteId}
                      onPress={handleNoteClick}
                      onPin={handlePin}
                      onArchive={handleArchive}
                      onDelete={handleDelete}
                      timeLabels={timeLabels}
                      labels={{
                        pin: n.pin,
                        unpin: n.unpin,
                        archive: n.archive,
                        delete: n.delete,
                        imageNote: n.imageNote,
                        noText: n.noText,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-edge-subtle p-3">
          <QuickCaptureBar
            placeholder={n.quickCapturePlaceholder}
            sendLabel={n.send}
            onCapture={handleCapture}
            onImagePick={allowMediaCapture ? handleImagePick : undefined}
            onVoiceCapture={allowMediaCapture ? handleVoiceCapture : undefined}
            recordingLabel={n.recording}
            discussionCaptureLabel={n.discussionCapture.title}
            onDiscussionCapture={() => openDiscussionCapture(projectId)}
          />
        </div>
      </section>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={n.resizeNotesList}
        aria-valuemin={NOTES_LIST_MIN_WIDTH}
        aria-valuemax={NOTES_LIST_MAX_WIDTH}
        aria-valuenow={Math.round(notesListWidth)}
        tabIndex={0}
        onPointerDown={handleListResizePointerDown}
        onDoubleClick={() => commitNotesListWidth(NOTES_LIST_DEFAULT_WIDTH)}
        onKeyDown={handleListResizeKeyDown}
        title={n.resizeNotesList}
        className={cn(
          'group relative z-10 hidden shrink-0 cursor-col-resize touch-none select-none items-center justify-center bg-surface-base lg:flex',
          'lg:transition-[width,opacity] lg:duration-[280ms] lg:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:lg:transition-none',
          notesListCollapsed ? 'lg:w-0 lg:opacity-0 lg:pointer-events-none' : 'lg:w-2 lg:opacity-100',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-0',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'h-full w-px bg-edge transition-[background-color,transform] duration-150',
            'group-hover:bg-accent/70 group-focus-visible:bg-accent',
            resizingList && 'bg-accent scale-x-[2]',
          )}
        />
      </div>

      <section
        className={cn(
          'relative min-w-0 flex-1 bg-surface-base',
          !selectedNoteId && 'hidden lg:flex',
        )}
      >
        {notesListCollapsed ? (
          <button
            type="button"
            onClick={() => setNotesListCollapsed(false)}
            className="absolute left-3 top-3 z-10 hidden size-8 items-center justify-center rounded-lg border border-edge bg-surface-base text-fg-muted shadow-surface transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:inline-flex"
            aria-label={n.expandNotesList}
            title={n.expandNotesList}
          >
            <PanelLeft className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
        ) : null}
        {selectedNoteId ? (
          <NoteDetailPanel
            noteId={selectedNoteId}
            onBack={() => navigate(basePath)}
            onSaved={() => void mutate()}
            backButtonClassName="lg:hidden"
            clearHeaderOnCleanup={false}
            onOpenSearch={() => setSearchOpen(true)}
            autoFocus={selectedNoteId === autoFocusNoteId}
            onAutoFocusConsumed={() => setAutoFocusNoteId(null)}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-1 items-center justify-center px-8 text-center">
            <div className="max-w-sm">
              <StickyNote className="mx-auto size-9 text-fg-muted" aria-hidden />
              <h2 className="mt-4 text-base font-semibold text-fg">{n.emptyEditorTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-fg-muted">{n.emptyEditorDescription}</p>
              <button
                type="button"
                onClick={handleCreateBlankNote}
                disabled={creatingBlankNote}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="size-4" aria-hidden />
                {creatingBlankNote ? n.creatingBlankNote : n.createBlankNote}
              </button>
            </div>
          </div>
        )}
      </section>
      <Dialog.Root open={searchOpen} onOpenChange={setSearchOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-24 z-[90] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
              <Dialog.Title className="text-sm font-semibold text-fg">{searchDialogTitle}</Dialog.Title>
              <Dialog.Description className="sr-only">{n.searchPlaceholder}</Dialog.Description>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="inline-flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={closeSearchLabel}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </Dialog.Close>
            </div>
            <div className="p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={n.searchPlaceholder}
                  className="w-full rounded-lg border border-edge bg-surface-base py-2 pl-9 pr-10 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
                    aria-label={clearSearchLabel}
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
              <div className="mt-4 max-h-[min(28rem,calc(100vh-14rem))] overflow-y-auto [scrollbar-gutter:stable]">
                {!trimmedSearchQuery ? (
                  <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-6 text-center">
                    <Search className="size-7 text-fg-muted" aria-hidden />
                    <p className="text-sm font-medium text-fg">{n.searchEmptyTitle}</p>
                    <p className="text-xs leading-5 text-fg-muted">{n.searchEmptyDescription}</p>
                  </div>
                ) : searchLoading && !searchData ? (
                  <div className="flex flex-col gap-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-hover" />
                    ))}
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-6 text-center">
                    <StickyNote className="size-7 text-fg-muted" aria-hidden />
                    <p className="text-sm font-medium text-fg">{n.searchNoResults}</p>
                    <p className="text-xs leading-5 text-fg-muted">{n.searchNoResultsDescription}</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <p className="px-2 pb-1 text-xs text-fg-muted">
                      {n.searchResultsCount.replace('{{count}}', String(searchData?.total ?? searchResults.length))}
                    </p>
                    {searchResults.map((note, index) => {
                      const Icon = SEARCH_KIND_ICON[note.kind] || StickyNote;
                      const preview = noteResultPreview(note, { imageNote: n.imageNote, noText: n.noText });
                      const active = index === activeSearchIndex;
                      return (
                        <button
                          key={note.id}
                          type="button"
                          onClick={() => openSearchResult(note.id)}
                          onMouseEnter={() => setActiveSearchIndex(index)}
                          className={cn(
                            'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                            active ? 'bg-surface-active' : 'hover:bg-surface-hover',
                          )}
                        >
                          <Icon className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-medium text-fg">
                                {note.title || preview}
                              </span>
                              <span className="shrink-0 text-xs text-fg-muted">
                                {formatRelativeTime(note.updatedAt, nowMs, timeLabels)}
                              </span>
                            </span>
                            {note.title ? (
                              <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-fg-muted">
                                {preview}
                              </span>
                            ) : null}
                            {note.tags?.length ? (
                              <span className="mt-1 flex min-w-0 flex-wrap gap-1">
                                {note.tags.slice(0, 3).map((tag) => (
                                  <span
                                    key={tag}
                                    className="max-w-24 truncate rounded-md bg-surface-hover px-1.5 py-0.5 text-xs text-fg-muted"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
