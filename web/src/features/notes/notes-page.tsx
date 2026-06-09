import { StickyNote } from 'lucide-react';
import { useCallback, useMemo, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';

import useSWR from 'swr';

import { uiPatchReducer } from '@/lib/settings-form-draft';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { NoteCard } from './note-card';
import { QuickCaptureBar } from './quick-capture-bar';
import { deleteNote, listNotes, quickCapture, updateNote, type NoteKind, type NoteStatus } from './notes-api';

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
  );

  const notes = data?.items ?? [];
  const total = data?.total ?? 0;

  const handleCapture = useCallback(
    async (text: string) => {
      await quickCapture(text, 'web');
      await mutate();
    },
    [mutate],
  );

  const handleImagePick = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      await quickCapture(`[image: ${file.name}]`, 'web');
      await mutate();
    };
    input.click();
  }, [mutate]);

  const handleVoiceRecord = useCallback(() => {
    // Web voice: use MediaRecorder API
    if (!navigator.mediaDevices?.getUserMedia) return;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const duration = Math.round((Date.now() - startTime) / 1000);
          await quickCapture(`[voice memo: ${duration}s]`, 'web');
          await mutate();
        };
        const startTime = Date.now();
        recorder.start();
        // Stop after 30s max or on user action (simplified: auto-stop after short delay for MVP)
        setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 30000);
      } catch {
        // Permission denied or no mic
      }
    })();
  }, [mutate]);

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
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <StickyNote className="h-5 w-5 text-fg-muted" />
        <h1 className="text-lg font-semibold text-fg">{n.title}</h1>
        {total > 0 && (
          <span className="text-xs text-fg-muted">
            {n.noteCount.replace('{{count}}', String(total))}
          </span>
        )}
      </div>

      {/* Quick capture with voice + image */}
      <QuickCaptureBar
        placeholder={n.quickCapturePlaceholder}
        sendLabel={n.send}
        onCapture={handleCapture}
        onImagePick={handleImagePick}
        onVoiceRecord={handleVoiceRecord}
      />

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

      {/* Notes list */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-hover" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <StickyNote className="h-8 w-8 text-fg-muted" />
          <p className="text-sm font-medium text-fg-muted">{n.noNotes}</p>
          <p className="text-xs text-fg-muted">{n.noNotesDescription}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onPress={handleNoteClick}
              onPin={handlePin}
              onArchive={handleArchive}
              onDelete={handleDelete}
              labels={{
                pin: n.pin,
                unpin: n.unpin,
                archive: n.archive,
                delete: n.delete,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
