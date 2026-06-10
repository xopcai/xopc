import { ArrowLeft, Eye, Code2, FileText, History } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { BlockEditor } from '@/components/block-editor';
import { MarkdownEditor } from '@/components/markdown/markdown-editor';
import { messages } from '@/i18n/messages';
import { showToast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useThemeStore } from '@/stores/theme-store';

import { getNote, getNoteSnapshot, updateNote, type NoteSnapshot, type NoteSnapshotEntry } from './notes-api';
import { NoteImageLightboxProvider, useNoteImageLightbox } from './note-image-lightbox';
import { NoteHistoryPanel } from './note-history-panel';
import { NoteMarkdownView } from './note-markdown-view';

type EditorMode = 'wysiwyg' | 'source' | 'preview';

function NoteDetailModeSwitcher({
  mode,
  onModeChange,
  labels,
}: {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  labels: { edit: string; source: string; preview: string };
}) {
  const modes = [
    { id: 'wysiwyg' as const, label: labels.edit, Icon: FileText },
    { id: 'source' as const, label: labels.source, Icon: Code2 },
    { id: 'preview' as const, label: labels.preview, Icon: Eye },
  ];

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-edge p-0.5">
      {modes.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onModeChange(id)}
          className={cn(
            'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors',
            mode === id
              ? 'bg-surface-hover text-fg'
              : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}

export type NoteDetailPanelProps = {
  noteId: string;
  onBack: () => void;
  onSaved?: () => void;
};

export function NoteDetailPanel({ noteId, onBack, onSaved }: NoteDetailPanelProps) {
  const language = useLocaleStore((s) => s.language);
  const closeLabel = messages(language).notes.lightboxClose;

  return (
    <NoteImageLightboxProvider closeLabel={closeLabel}>
      <NoteDetailPanelInner noteId={noteId} onBack={onBack} onSaved={onSaved} />
    </NoteImageLightboxProvider>
  );
}

function NoteDetailPanelInner({ noteId, onBack, onSaved }: NoteDetailPanelProps) {
  const language = useLocaleStore((s) => s.language);
  const n = messages(language).notes;
  const isDark = useThemeStore((s) => s.resolved) === 'dark';
  const { openImage } = useNoteImageLightbox();
  const [mode, setMode] = useState<EditorMode>('wysiwyg');
  const [showHistory, setShowHistory] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState<NoteSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [historyWidth, setHistoryWidth] = useState(288);
  const [historyResizing, setHistoryResizing] = useState(false);
  const titleInitRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);

  const { data: note, mutate } = useSWR(
    noteId ? ['note-detail', noteId] : null,
    () => getNote(noteId),
  );

  if (note && !titleInitRef.current) {
    setTitle(note.title ?? '');
    titleInitRef.current = true;
  }

  const time = note
    ? new Date(note.createdAt).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const headerStart = useMemo(
    () => (
      <button
        type="button"
        onClick={onBack}
        aria-label={n.back}
        className={cn(
          'rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
          APP_CHROME_NO_DRAG_CLASS,
        )}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </button>
    ),
    [n.back, onBack],
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitle(value);
      if (!noteId) return;
      if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
      titleDebounceRef.current = setTimeout(async () => {
        setSaving(true);
        try {
          await updateNote(noteId, { title: value });
          await mutate();
          onSaved?.();
        } catch {
          // title save failed silently — content save will surface errors
        } finally {
          setSaving(false);
        }
      }, 600);
    },
    [noteId, mutate, onSaved],
  );

  const onHistoryResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      setHistoryResizing(true);
      const startX = e.clientX;
      const startW = historyWidth;
      const pid = e.pointerId;
      const onMove = (ev: PointerEvent) => {
        const newW = startW - (ev.clientX - startX);
        setHistoryWidth(Math.max(200, Math.min(600, newW)));
      };
      const onDone = () => {
        try { el.releasePointerCapture(pid); } catch { /* */ }
        setHistoryResizing(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onDone);
        window.removeEventListener('pointercancel', onDone);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onDone);
      window.addEventListener('pointercancel', onDone);
    },
    [historyWidth],
  );

  const headerMain = useMemo(
    () => (
      <div
        className={cn(
          'flex min-w-0 items-center gap-2 px-3 sm:px-5 xl:px-6',
          APP_CHROME_NO_DRAG_CLASS,
        )}
      >
        <span className="min-w-0 truncate text-sm font-medium text-fg" title={title || time || undefined}>
          {title || time}
        </span>
        {saving ? <span className="shrink-0 text-xs text-fg-muted opacity-60">{n.saving}</span> : null}
      </div>
    ),
    [n.saving, saving, time, title],
  );

  const headerEnd = useMemo(
    () => (
      <div className={cn('flex items-center gap-2', APP_CHROME_NO_DRAG_CLASS)}>
        <NoteDetailModeSwitcher
          mode={mode}
          onModeChange={setMode}
          labels={{ edit: n.modeEdit, source: n.modeSource, preview: n.modePreview }}
        />
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          aria-label={n.history}
          className={cn(
            'rounded-lg p-1.5 transition-colors',
            showHistory
              ? 'bg-accent/10 text-accent'
              : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
          )}
        >
          <History className="h-4 w-4" aria-hidden />
        </button>
      </div>
    ),
    [mode, n.modeEdit, n.modePreview, n.modeSource, n.history, showHistory],
  );

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: headerStart,
      main: note ? headerMain : null,
      end: note ? headerEnd : null,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, headerMain, headerStart, note, setPageHeader]);

  const handleSave = useCallback(
    (content: string) => {
      if (!noteId) return;

      // Debounce saves to avoid excessive API calls
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setSaving(true);
        try {
          await updateNote(noteId, { text: content });
          await mutate();
          onSaved?.();
        } catch (err) {
          showToast({
            type: 'error',
            title: n.saveFailed,
            message: err instanceof Error ? err.message : n.saveFailedHint,
          });
        } finally {
          setSaving(false);
        }
      }, 600);
    },
    [noteId, mutate, n.saveFailed, n.saveFailedHint, onSaved],
  );

  if (!note) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  const handleHistorySelect = useCallback(
    async (entry: NoteSnapshotEntry) => {
      try {
        const snapshot = await getNoteSnapshot(noteId, entry.timestamp);
        setPreviewSnapshot(snapshot);
      } catch {
        setPreviewSnapshot(null);
      }
    },
    [noteId],
  );

  const handleHistoryClose = useCallback(() => {
    setShowHistory(false);
    setPreviewSnapshot(null);
  }, []);

  const handleHistoryRestored = useCallback(() => {
    setShowHistory(false);
    setPreviewSnapshot(null);
    mutate();
    onSaved?.();
  }, [mutate, onSaved]);

  const isPreviewingSnapshot = previewSnapshot !== null;
  const displayTitle = isPreviewingSnapshot ? (previewSnapshot.title ?? '') : title;
  const displayText = isPreviewingSnapshot ? (previewSnapshot.text ?? '') : (note.text ?? '');

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={editorContainerRef} className="min-h-0 flex-1 overflow-hidden">
          {isPreviewingSnapshot ? (
            <div className="h-full overflow-y-auto px-6 py-4">
              {displayTitle && (
                <h1 className="mb-4 text-2xl font-bold text-fg/70">{displayTitle}</h1>
              )}
              {displayText ? (
                <NoteMarkdownView
                  noteId={noteId}
                  content={displayText}
                  className="opacity-80"
                />
              ) : (
                <p className="italic text-fg-muted">{n.emptyPreview}</p>
              )}
            </div>
          ) : (
            <>
              {mode === 'wysiwyg' && (
                <div className="flex h-full flex-col">
                  <div className="shrink-0 px-6 pt-4">
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => handleTitleChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const prosemirror = editorContainerRef.current?.querySelector<HTMLElement>('.ProseMirror');
                          prosemirror?.focus();
                        }
                      }}
                      placeholder={n.titlePlaceholder}
                      className="w-full border-none bg-transparent text-2xl font-bold text-fg placeholder:text-fg-muted/40 focus:outline-none"
                    />
                  </div>
                  <div className="min-h-0 flex-1">
                    <BlockEditor
                      key={`wysiwyg-${noteId}`}
                      initialContent={note.text ?? ''}
                      onChange={handleSave}
                      noteId={noteId}
                    />
                  </div>
                </div>
              )}
              {mode === 'source' && (
                <div className="flex h-full flex-col">
                  <div className="shrink-0 px-6 pt-4">
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => handleTitleChange(e.target.value)}
                      placeholder={n.titlePlaceholder}
                      className="w-full border-none bg-transparent text-2xl font-bold text-fg placeholder:text-fg-muted/40 focus:outline-none"
                    />
                  </div>
                  <div className="min-h-0 flex-1">
                    <MarkdownEditor
                      key={`source-${noteId}`}
                      initialContent={note.text ?? ''}
                      onChange={handleSave}
                      isDark={isDark}
                    />
                  </div>
                </div>
              )}
              {mode === 'preview' && (
                <div
                  className="h-full overflow-y-auto px-6 py-4"
                  onClick={(event) => {
                    const target = event.target;
                    if (!(target instanceof HTMLImageElement)) return;
                    openImage(target.currentSrc || target.src, target.alt);
                  }}
                >
                  {title && (
                    <h1 className="mb-4 text-2xl font-bold text-fg">{title}</h1>
                  )}
                  {note.text ? (
                    <NoteMarkdownView
                      noteId={noteId}
                      content={note.text}
                      className="[&_img]:cursor-zoom-in"
                    />
                  ) : (
                    <p className="italic text-fg-muted">{n.emptyPreview}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {showHistory && (
        <div className="relative shrink-0" style={{ width: historyWidth }}>
          <div
            role="separator"
            aria-orientation="vertical"
            onPointerDown={onHistoryResizePointerDown}
            className={cn(
              'absolute left-0 top-0 z-10 h-full w-2 -translate-x-1/2 cursor-col-resize',
              "before:content-[''] before:pointer-events-none before:absolute before:left-1/2 before:top-0 before:h-full before:w-px before:-translate-x-1/2",
              'before:bg-transparent before:transition-[background-color] before:duration-150',
              'hover:before:bg-edge/65 dark:hover:before:bg-edge/75',
              historyResizing && 'before:!bg-edge/80 dark:before:!bg-edge/85',
              'touch-none select-none',
            )}
          />
          <NoteHistoryPanel
            noteId={noteId}
            activeTimestamp={previewSnapshot?.timestamp ?? null}
            onSelect={handleHistorySelect}
            onClose={handleHistoryClose}
            onRestored={handleHistoryRestored}
          />
        </div>
      )}
    </div>
  );
}
