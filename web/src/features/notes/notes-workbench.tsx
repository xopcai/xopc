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
  Pin,
  Search,
  StickyNote,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import useSWR from 'swr';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
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

const NOTES_LIST_MIN_WIDTH = 288;
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
  listTag?: string;
  captureTags?: string[];
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
  listTag,
  captureTags = [],
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
  const workspaceRef = useRef<HTMLDivElement>(null);
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
        ? ['notes-list', listTag, ui.statusFilter, ui.kindFilter, ui.pinnedOnly]
        : null,
    [hasToken, listTag, ui.statusFilter, ui.kindFilter, ui.pinnedOnly],
  );

  const { data, mutate, isLoading } = useSWR(swrKey, () =>
    listNotes({
      status: ui.statusFilter === 'all' ? undefined : ui.statusFilter,
      kind: ui.kindFilter === 'all' ? undefined : ui.kindFilter,
      tag: listTag,
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
      ? ['notes-search', listTag, trimmedSearchQuery]
      : null,
    () =>
      listNotes({
        search: trimmedSearchQuery,
        tag: listTag,
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
      const note = captureTags.length
        ? await createNote({ markdown: text, kind: 'thought', tags: captureTags, channel: 'web' })
        : await quickCapture(text, 'web');
      await mutate();
      if (opts?.navigate !== false) {
        navigate(notePath(basePath, note.id));
      }
    },
    [basePath, captureTags, mutate, navigate],
  );

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
    el.setPointerCapture(event.pointerId);
    setResizingList(true);

    const startX = event.clientX;
    const startWidth = notesListWidth;
    const pointerId = event.pointerId;
    let latestWidth = notesListWidth;

    const onMove = (moveEvent: PointerEvent) => {
      latestWidth = clampNotesListWidth(startWidth + moveEvent.clientX - startX);
      setNotesListWidth(latestWidth);
    };

    const onDone = () => {
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
      setResizingList(false);
      writeStoredNotesListWidth(listWidthStorageKey, latestWidth);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onDone);
      window.removeEventListener('pointercancel', onDone);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onDone);
    window.addEventListener('pointercancel', onDone);
  }, [clampNotesListWidth, listWidthStorageKey, notesListWidth]);

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
        <StickyNote className="h-10 w-10 text-fg-muted" />
        <p className="text-sm text-fg-muted">{n.needToken}</p>
      </div>
    );
  }

  return (
    <div
      ref={workspaceRef}
      className="flex h-full min-h-0 w-full flex-1 overflow-hidden bg-surface-panel"
      style={{ '--notes-list-width': `${notesListWidth}px` } as CSSProperties}
    >
      {showLibrary ? (
        <aside className="hidden w-56 shrink-0 flex-col gap-4 border-r border-edge-subtle bg-surface-base px-3 py-4 2xl:flex">
          <div className="px-2">
            <div className="text-sm font-semibold text-fg">{n.libraryTitle}</div>
            <div className="mt-0.5 text-xs leading-5 text-fg-muted">{n.libraryDescription}</div>
          </div>
          <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" aria-label={n.libraryTitle}>
            {libraryViews.map((view) => {
              const Icon = view.icon;
              const active = sameView(ui, view);
              return (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => dispatch({ type: 'patch', patch: view.patch })}
                  className={cn(
                    'group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                    active ? 'bg-surface-active text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', active && 'text-accent')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{view.label}</span>
                    <span className="block truncate text-xs text-fg-muted">{view.description}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>
      ) : null}

      <section
        className={cn(
          'relative flex min-h-0 w-full shrink-0 flex-col overflow-hidden bg-surface-panel lg:w-[var(--notes-list-width)]',
          selectedNoteId && 'hidden lg:flex',
        )}
      >
        <div className="flex shrink-0 flex-col gap-3 border-b border-edge-subtle p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-fg">{effectiveListTitle}</h2>
              <p className="truncate text-xs text-fg-muted">
                {noteCountLabel ?? effectiveListDescription}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {showLibrary ? (
                <select
                  value={activeLibraryView.id}
                  onChange={(event) => {
                    const next = libraryViews.find((view) => view.id === event.target.value);
                    if (next) dispatch({ type: 'patch', patch: next.patch });
                  }}
                  className="block max-w-32 rounded-lg border border-edge bg-surface-base px-2 py-1.5 text-xs font-medium text-fg 2xl:hidden"
                  aria-label={n.libraryTitle}
                >
                  {libraryViews.map((view) => (
                    <option key={view.id} value={view.id}>{view.label}</option>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="inline-flex size-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={n.searchDialogTitle}
              >
                <Search className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
          <QuickCaptureBar
            placeholder={n.quickCapturePlaceholder}
            sendLabel={n.send}
            onCapture={handleCapture}
            onImagePick={allowMediaCapture ? handleImagePick : undefined}
            onVoiceCapture={allowMediaCapture ? handleVoiceCapture : undefined}
            recordingLabel={n.recording}
          />
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
              <StickyNote className="h-8 w-8 text-fg-muted" />
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
        onKeyDown={handleListResizeKeyDown}
        className={cn(
          'relative hidden w-2 shrink-0 cursor-col-resize touch-none select-none items-stretch justify-center lg:flex',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-0',
          "before:pointer-events-none before:block before:h-full before:w-px before:bg-edge-subtle before:transition-colors before:duration-150",
          'hover:before:bg-edge-strong',
          resizingList && 'before:bg-accent',
        )}
      />

      <section
        className={cn(
          'min-w-0 flex-1 bg-surface-base',
          !selectedNoteId && 'hidden lg:flex',
        )}
      >
        {selectedNoteId ? (
          <NoteDetailPanel
            noteId={selectedNoteId}
            onBack={() => navigate(basePath)}
            onSaved={() => void mutate()}
            backButtonClassName="lg:hidden"
            clearHeaderOnCleanup={false}
            onOpenSearch={() => setSearchOpen(true)}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-1 items-center justify-center px-8 text-center">
            <div className="max-w-sm">
              <StickyNote className="mx-auto h-9 w-9 text-fg-muted" aria-hidden />
              <h2 className="mt-4 text-base font-semibold text-fg">{n.emptyEditorTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-fg-muted">{n.emptyEditorDescription}</p>
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
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
                <input
                  autoFocus
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
                    <Search className="h-7 w-7 text-fg-muted" aria-hidden />
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
                    <StickyNote className="h-7 w-7 text-fg-muted" aria-hidden />
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
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
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
