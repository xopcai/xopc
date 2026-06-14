import { StickyNote, Search } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useReducer, useState } from 'react';
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
import { QuickCaptureBar } from './quick-capture-bar';
import { dateGroupKey, formatDateGroup, type NoteTimeLabels } from './note-time';
import { deleteNote, listNotes, quickCapture, quickCaptureImage, quickCaptureVoice, updateNote, type NoteKind, type NoteStatus } from './notes-api';
import { showToast } from '@/lib/toast';

type StatusFilter = 'all' | NoteStatus;
type KindFilter = 'all' | NoteKind;

type NotesUi = {
  statusFilter: StatusFilter;
  kindFilter: KindFilter;
  search: string;
};

const initialUi: NotesUi = {
  statusFilter: 'all',
  kindFilter: 'all',
  search: '',
};

export function NotesPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const n = m.notes;
  const token = useGatewayStore((s) => s.token);
  const hasToken = Boolean(token);

  const [ui, dispatch] = useReducer(uiPatchReducer<NotesUi>, initialUi);
  const [nowMs] = useState(() => Date.now());
  const navigate = useNavigate();

  const swrKey = useMemo(
    () =>
      hasToken
        ? ['notes-list', ui.statusFilter, ui.kindFilter, ui.search]
        : null,
    [hasToken, ui.statusFilter, ui.kindFilter, ui.search],
  );

  const { data, mutate, isLoading } = useSWR(swrKey, () =>
    listNotes({
      status: ui.statusFilter === 'all' ? undefined : ui.statusFilter,
      kind: ui.kindFilter === 'all' ? undefined : ui.kindFilter,
      search: ui.search || undefined,
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

  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const noteCountLabel = total > 0 ? n.noteCount.replace('{{count}}', String(total)) : null;

  useLayoutEffect(() => {
    if (!hasToken) {
      clearPageHeader();
      return () => clearPageHeader();
    }
    setPageHeader({
      startExtra: null,
      main: (
        <div
          className={cn(
            'flex min-w-0 items-center gap-2 px-3 sm:px-5 xl:px-6',
            APP_CHROME_NO_DRAG_CLASS,
          )}
        >
          <h1 className="min-w-0 truncate text-base font-semibold tracking-tight text-fg">{n.title}</h1>
          {noteCountLabel ? (
            <span className="shrink-0 text-xs text-fg-muted">{noteCountLabel}</span>
          ) : null}
        </div>
      ),
      end: null,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, hasToken, n.title, noteCountLabel, setPageHeader]);

  const timeLabels: NoteTimeLabels = useMemo(() => ({
    justNow: n.justNow,
    minutesAgo: n.minutesAgo,
    today: n.today,
    yesterday: n.yesterday,
    daysAgo: n.daysAgo,
  }), [n.justNow, n.minutesAgo, n.today, n.yesterday, n.daysAgo]);

  const handleCapture = useCallback(
    async (text: string, opts?: { navigate?: boolean }) => {
      const note = await quickCapture(text, 'web');
      await mutate();
      if (opts?.navigate !== false) {
        navigate(`/notes/${note.id}`);
      }
    },
    [mutate, navigate],
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
    navigate(`/notes/${id}`);
  }, [navigate]);

  if (!hasToken) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <StickyNote className="h-10 w-10 text-fg-muted" />
        <p className="text-sm text-fg-muted">{n.needToken}</p>
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex h-full min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-col gap-4 p-4 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
          <input
            type="search"
            value={ui.search}
            onChange={(e) => dispatch({ type: 'patch', patch: { search: e.target.value } })}
            placeholder={n.searchPlaceholder}
            className="w-full rounded-xl border border-edge bg-surface-panel py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'inbox', 'processed', 'archived'] as const).map((f) => {
            const label =
              f === 'all' ? n.filterAll
              : f === 'inbox' ? n.filterInbox
              : f === 'processed' ? n.filterProcessed
              : n.filterArchived;
            return (
              <button
                type="button"
                key={f}
                onClick={() => dispatch({ type: 'patch', patch: { statusFilter: f } })}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  ui.statusFilter === f
                    ? 'bg-accent text-white'
                    : 'bg-surface-hover text-fg-muted hover:text-fg',
                )}
              >
                {label}
              </button>
            );
          })}

          <div className="mx-1 h-4 w-px bg-edge-subtle" />

          {(['all', 'thought', 'todo', 'voice', 'media', 'bookmark'] as const).map((f) => {
            const label =
              f === 'all' ? n.kindAll
              : f === 'thought' ? n.kindThought
              : f === 'todo' ? n.kindTodo
              : f === 'voice' ? n.kindVoice
              : f === 'media' ? n.kindMedia
              : n.kindBookmark;
            return (
              <button
                type="button"
                key={f}
                onClick={() => dispatch({ type: 'patch', patch: { kindFilter: f } })}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  ui.kindFilter === f
                    ? 'bg-accent text-white'
                    : 'bg-surface-hover text-fg-muted hover:text-fg',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Notes list — only this region scrolls */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-24 [scrollbar-gutter:stable]">
        {showSkeleton ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-hover" />
            ))}
          </div>
        ) : notes.length === 0 ? (
          <div className="flex min-h-[min(40vh,20rem)] flex-col items-center justify-center gap-2 py-16 text-center">
            <StickyNote className="h-8 w-8 text-fg-muted" />
            <p className="text-sm font-medium text-fg-muted">{n.noNotes}</p>
            <p className="text-xs text-fg-muted">{n.noNotesDescription}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {notes.map((note, idx) => {
              const prevKey = idx > 0 ? dateGroupKey(notes[idx - 1].createdAt) : null;
              const currentKey = dateGroupKey(note.createdAt);
              const showDateHeader = currentKey !== prevKey;

              return (
                <div key={note.id}>
                  {showDateHeader && (
                    <div className={cn('pb-2 text-xs font-medium text-fg-muted', idx > 0 && 'pt-2')}>
                      {formatDateGroup(note.createdAt, nowMs, timeLabels)}
                    </div>
                  )}
                  <NoteCard
                    note={note}
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

      {/* Quick capture — floats above the scrolling list */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-surface-panel from-60% via-surface-panel/90 to-transparent px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-6">
        <div className="pointer-events-auto">
        <QuickCaptureBar
          placeholder={n.quickCapturePlaceholder}
          sendLabel={n.send}
          onCapture={handleCapture}
          onImagePick={handleImagePick}
          onVoiceCapture={handleVoiceCapture}
          recordingLabel={n.recording}
        />
        </div>
      </div>
    </div>
  );
}
