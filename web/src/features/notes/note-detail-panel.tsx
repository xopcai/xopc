import { ArrowLeft, Eye, Code2, FileText, History, MessageCircle, Search, Sparkles } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { AutomationSuggestionCard } from '@/features/automations/automation-suggestion-card';
import { ProductAutomationFeedback } from '@/features/automations/product-automation-feedback';
import { messages } from '@/i18n/messages';
import { showToast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useThemeStore } from '@/stores/theme-store';

import {
  catalyzeNote,
  getNote,
  getNoteSnapshot,
  listNoteThreads,
  openNoteChat,
  updateNote,
  type NoteSnapshot,
  type NoteSnapshotEntry,
} from './notes-api';
import { NoteImageLightboxProvider, useNoteImageLightbox } from './note-image-lightbox';
import { NoteHistoryPanel } from './note-history-panel';
import { NoteMarkdownView } from './note-markdown-view';
import { NoteBreakdownPanel } from './note-breakdown-panel';

type EditorMode = 'wysiwyg' | 'source' | 'preview';

const loadBlockEditor = () => import('@/components/block-editor');
const loadMarkdownEditor = () => import('@/components/markdown/markdown-editor');

const BlockEditor = lazy(() => loadBlockEditor().then((m) => ({ default: m.BlockEditor })));
const MarkdownEditor = lazy(() => loadMarkdownEditor().then((m) => ({ default: m.MarkdownEditor })));

function EditorFallback() {
  return (
    <div className="flex h-full min-h-0 flex-col px-6 py-4" aria-busy>
      <div className="h-8 w-56 max-w-full animate-pulse rounded-md bg-surface-hover" />
      <div className="mt-6 h-4 w-11/12 animate-pulse rounded bg-surface-hover" />
      <div className="mt-3 h-4 w-9/12 animate-pulse rounded bg-surface-hover" />
      <div className="mt-3 h-4 w-10/12 animate-pulse rounded bg-surface-hover" />
    </div>
  );
}

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
          onMouseEnter={() => {
            if (id === 'wysiwyg') void loadBlockEditor();
            if (id === 'source') void loadMarkdownEditor();
          }}
          onFocus={() => {
            if (id === 'wysiwyg') void loadBlockEditor();
            if (id === 'source') void loadMarkdownEditor();
          }}
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
  showBackButton?: boolean;
  backButtonClassName?: string;
  clearHeaderOnCleanup?: boolean;
  onOpenSearch?: () => void;
  autoFocus?: boolean;
  onAutoFocusConsumed?: () => void;
};

export function NoteDetailPanel({
  noteId,
  onBack,
  onSaved,
  showBackButton = true,
  backButtonClassName,
  clearHeaderOnCleanup = true,
  onOpenSearch,
  autoFocus = false,
  onAutoFocusConsumed,
}: NoteDetailPanelProps) {
  const language = useLocaleStore((s) => s.language);
  const closeLabel = messages(language).notes.lightboxClose;

  return (
    <NoteImageLightboxProvider closeLabel={closeLabel}>
      <NoteDetailPanelInner
        noteId={noteId}
        onBack={onBack}
        onSaved={onSaved}
        showBackButton={showBackButton}
        backButtonClassName={backButtonClassName}
        clearHeaderOnCleanup={clearHeaderOnCleanup}
        onOpenSearch={onOpenSearch}
        autoFocus={autoFocus}
        onAutoFocusConsumed={onAutoFocusConsumed}
      />
    </NoteImageLightboxProvider>
  );
}

function NoteDetailPanelInner({
  noteId,
  onBack,
  onSaved,
  showBackButton = true,
  backButtonClassName,
  clearHeaderOnCleanup = true,
  onOpenSearch,
  autoFocus = false,
  onAutoFocusConsumed,
}: NoteDetailPanelProps) {
  const language = useLocaleStore((s) => s.language);
  const n = messages(language).notes;
  const automationSuggestions = messages(language).automations.suggestions;
  const navigate = useNavigate();
  const isDark = useThemeStore((s) => s.resolved) === 'dark';
  const { openImage } = useNoteImageLightbox();
  const [mode, setMode] = useState<EditorMode>('wysiwyg');
  const [activeSidePanel, setActiveSidePanel] = useState<'history' | 'breakdown' | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<NoteSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [sidePanelWidth, setSidePanelWidth] = useState(360);
  const [historyResizing, setHistoryResizing] = useState(false);
  const [catalyzing, setCatalyzing] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const titleInitRef = useRef(false);
  const titleComposingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMarkdownRef = useRef<string | null>(null);
  const pendingTitleRef = useRef<string | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const sidePanelShellRef = useRef<HTMLDivElement>(null);
  const sidePanelInnerRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const didAutoFocusRef = useRef<string | null>(null);
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);

  const { data: note, mutate } = useSWR(
    noteId ? ['note-detail', noteId] : null,
    () => getNote(noteId),
  );
  const { data: noteThreads = [], mutate: mutateNoteThreads } = useSWR(
    noteId ? ['note-threads', noteId] : null,
    () => listNoteThreads(noteId),
    { revalidateOnFocus: false },
  );
  const isPreviewingSnapshot = previewSnapshot !== null;

  useEffect(() => {
    if (!noteId) return undefined;
    const onNoteUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ noteId?: string }>).detail;
      if (detail?.noteId === noteId) {
        void mutate();
      }
    };
    window.addEventListener('note-updated', onNoteUpdated);
    return () => window.removeEventListener('note-updated', onNoteUpdated);
  }, [mutate, noteId]);

  useEffect(() => {
    titleInitRef.current = false;
    setTitle('');
    setPreviewSnapshot(null);
    setActiveSidePanel(null);
    titleComposingRef.current = false;
    didAutoFocusRef.current = null;
  }, [noteId]);

  useEffect(() => {
    if (!note || titleInitRef.current) return;
    setTitle(note.title ?? '');
    titleInitRef.current = true;
  }, [note]);

  useEffect(() => {
    if (!autoFocus || !note || isPreviewingSnapshot || didAutoFocusRef.current === noteId) return undefined;
    const frame = window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      onAutoFocusConsumed?.();
    });
    didAutoFocusRef.current = noteId;
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus, isPreviewingSnapshot, note, noteId, onAutoFocusConsumed]);

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
    () => showBackButton ? (
      <button
        type="button"
        onClick={onBack}
        aria-label={n.back}
        className={cn(
          'rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
          APP_CHROME_NO_DRAG_CLASS,
          backButtonClassName,
        )}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </button>
    ) : null,
    [backButtonClassName, n.back, onBack, showBackButton],
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitle(value);
      if (!noteId) return;
      pendingTitleRef.current = value;
      if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
      titleDebounceRef.current = setTimeout(async () => {
        const nextTitle = pendingTitleRef.current;
        pendingTitleRef.current = null;
        if (nextTitle === null) return;
        setSaving(true);
        try {
          await updateNote(noteId, { title: nextTitle });
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

  const headerMain = useMemo(
    () => (
      <div
        className={cn(
          'flex min-w-0 items-center gap-2',
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

  const handleOpenNoteChat = useCallback(async (forceNew = false) => {
    setOpeningChat(true);
    try {
      const result = await openNoteChat(noteId, { forceNew });
      await mutate();
      await mutateNoteThreads();
      navigate(`/chat/${encodeURIComponent(result.sessionKey)}`);
    } catch (err) {
      showToast({
        type: 'error',
        title: n.chatOpenFailedTitle,
        message: err instanceof Error ? err.message : n.chatOpenFailedMessage,
      });
    } finally {
      setOpeningChat(false);
    }
  }, [mutate, mutateNoteThreads, navigate, noteId, n.chatOpenFailedMessage, n.chatOpenFailedTitle]);

  const handleCatalyze = useCallback(async () => {
    setCatalyzing(true);
    try {
      await catalyzeNote(noteId);
      await mutate();
      showToast({ type: 'success', title: n.catalysisDone });
    } catch (err) {
      showToast({
        type: 'error',
        title: n.catalysisFailed,
        message: err instanceof Error ? err.message : n.chatOpenFailedMessage,
      });
    } finally {
      setCatalyzing(false);
    }
  }, [mutate, noteId]);

  const handleBreakdownClick = useCallback(() => {
    setActiveSidePanel(activeSidePanel === 'breakdown' ? null : 'breakdown');
    if (!note?.aiDeep?.catalysis?.report && !catalyzing) {
      void handleCatalyze();
    }
  }, [activeSidePanel, catalyzing, handleCatalyze, note?.aiDeep?.catalysis?.report]);

  const headerEnd = useMemo(
    () => (
      <div className={cn('flex items-center gap-2', APP_CHROME_NO_DRAG_CLASS)}>
        {onOpenSearch ? (
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label={n.searchDialogTitle}
            className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Search className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleBreakdownClick}
          disabled={catalyzing}
          aria-label={n.catalysisSectionTitle}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            activeSidePanel === 'breakdown'
              ? 'bg-accent/10 text-accent'
              : 'bg-accent/10 text-fg hover:bg-accent/15',
          )}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {catalyzing ? n.catalyzing : n.catalyzeButton}
        </button>
        <button
          type="button"
          onClick={() => handleOpenNoteChat(false)}
          disabled={openingChat}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
            'border border-edge text-fg-muted hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden />
          {openingChat ? n.openingChat : n.openChatButton}
        </button>
        <NoteDetailModeSwitcher
          mode={mode}
          onModeChange={setMode}
          labels={{ edit: n.modeEdit, source: n.modeSource, preview: n.modePreview }}
        />
        <button
          type="button"
          onClick={() => setActiveSidePanel(activeSidePanel === 'history' ? null : 'history')}
          aria-label={n.history}
          className={cn(
            'rounded-lg p-1.5 transition-colors',
            activeSidePanel === 'history'
              ? 'bg-accent/10 text-accent'
              : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
          )}
        >
          <History className="h-4 w-4" aria-hidden />
        </button>
      </div>
    ),
    [
      catalyzing,
      handleBreakdownClick,
      handleOpenNoteChat,
      mode,
      n.history,
      n.modeEdit,
      n.modePreview,
      n.modeSource,
      openingChat,
      activeSidePanel,
      onOpenSearch,
      n.searchDialogTitle,
    ],
  );

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: headerStart,
      main: note ? headerMain : null,
      end: note ? headerEnd : null,
    });
    return () => {
      if (clearHeaderOnCleanup) clearPageHeader();
    };
  }, [clearHeaderOnCleanup, clearPageHeader, headerEnd, headerMain, headerStart, note, setPageHeader]);

  const handleSave = useCallback(
    (content: string) => {
      if (!noteId) return;
      pendingMarkdownRef.current = content;

      // Debounce saves to avoid excessive API calls
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        const markdown = pendingMarkdownRef.current;
        pendingMarkdownRef.current = null;
        if (markdown === null) return;
        setSaving(true);
        try {
          await updateNote(noteId, { markdown });
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

  const handleHistorySelect = useCallback(
    (entry: NoteSnapshotEntry) => {
      getNoteSnapshot(noteId, entry.timestamp).then((snapshot) => {
        if (snapshot) setPreviewSnapshot(snapshot);
      });
    },
    [noteId],
  );

  const handleHistoryClose = useCallback(() => {
    setActiveSidePanel(null);
    setPreviewSnapshot(null);
  }, []);

  const handleHistoryRestored = useCallback(() => {
    setActiveSidePanel(null);
    setPreviewSnapshot(null);
    mutate();
    onSaved?.();
  }, [mutate, onSaved]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
      const pendingMarkdown = pendingMarkdownRef.current;
      const pendingTitle = pendingTitleRef.current;
      pendingMarkdownRef.current = null;
      pendingTitleRef.current = null;
      const patch: Partial<import('./notes-api').Note> = {};
      if (pendingMarkdown !== null) patch.markdown = pendingMarkdown;
      if (pendingTitle !== null) patch.title = pendingTitle;
      if (Object.keys(patch).length > 0) void updateNote(noteId, patch);
    };
  }, [noteId]);

  if (note === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (note === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="text-sm font-medium text-fg">{n.notFoundTitle}</div>
        <p className="text-sm text-fg-muted">{n.notFoundDescription}</p>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-edge px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          {n.back}
        </button>
      </div>
    );
  }

  const displayTitle = isPreviewingSnapshot ? (previewSnapshot.title ?? '') : title;
  const displayText = isPreviewingSnapshot ? (previewSnapshot.markdown ?? '') : (note.markdown ?? '');
  const noteCreatedAtMs = new Date(note.createdAt).getTime();
  const shouldSuggestNoteAutomation =
    Number.isFinite(noteCreatedAtMs) && Date.now() - noteCreatedAtMs < 60 * 60 * 1000;
  const titleAutomationSuggestion = shouldSuggestNoteAutomation ? (
    <AutomationSuggestionCard
      title={automationSuggestions.noteCreatedTitle}
      description={automationSuggestions.noteCreatedDescription}
      prompt={automationSuggestions.noteCreatedPrompt}
      coverage={{ eventType: 'note.created', source: 'notes', eventPayload: { noteId } }}
      variant="titleAction"
      className="ml-3 hidden max-w-[18rem] shrink-0 md:flex"
    />
  ) : null;

  return (
    <div className="flex h-full min-h-0 gap-3 p-4 sm:px-5">
      {/* Editor */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ProductAutomationFeedback
          eventType="note.created"
          source="notes"
          payloadKey="noteId"
          payloadValue={noteId}
          className="mb-3 shrink-0"
        />
        <ProductAutomationFeedback
          eventType="note.updated"
          source="notes"
          payloadKey="noteId"
          payloadValue={noteId}
          className="mb-3 shrink-0"
        />
        <div
          ref={editorContainerRef}
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge-subtle bg-surface-base"
        >
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
                  <div className="flex shrink-0 items-start px-6 pt-4">
                    <input
                      ref={titleInputRef}
                      type="text"
                      value={title}
                      onChange={(e) => handleTitleChange(e.target.value)}
                      onCompositionStart={() => {
                        titleComposingRef.current = true;
                      }}
                      onCompositionEnd={() => {
                        titleComposingRef.current = false;
                      }}
                      onKeyDown={(e) => {
                        const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
                        if (e.key === 'Enter' && !titleComposingRef.current && !nativeEvent.isComposing) {
                          e.preventDefault();
                          const prosemirror = editorContainerRef.current?.querySelector<HTMLElement>('.ProseMirror');
                          prosemirror?.focus();
                        }
                      }}
                      placeholder={n.titlePlaceholder}
                      className="min-w-0 flex-1 border-none bg-transparent text-2xl font-bold text-fg placeholder:text-fg-muted/40 focus:outline-none"
                    />
                    {titleAutomationSuggestion}
                  </div>
                  <div className="min-h-0 flex-1">
                    <Suspense fallback={<EditorFallback />}>
                      <BlockEditor
                        key={`wysiwyg-${noteId}`}
                        initialContent={note.markdown ?? ''}
                        onChange={handleSave}
                        noteId={noteId}
                      />
                    </Suspense>
                  </div>
                </div>
              )}
              {mode === 'source' && (
                <div className="flex h-full flex-col">
                  <div className="flex shrink-0 items-start px-6 pt-4">
                    <input
                      ref={titleInputRef}
                      type="text"
                      value={title}
                      onChange={(e) => handleTitleChange(e.target.value)}
                      placeholder={n.titlePlaceholder}
                      className="min-w-0 flex-1 border-none bg-transparent text-2xl font-bold text-fg placeholder:text-fg-muted/40 focus:outline-none"
                    />
                    {titleAutomationSuggestion}
                  </div>
                  <div className="min-h-0 flex-1">
                    <Suspense fallback={<EditorFallback />}>
                      <MarkdownEditor
                        key={`source-${noteId}`}
                        initialContent={note.markdown ?? ''}
                        onChange={handleSave}
                        isDark={isDark}
                      />
                    </Suspense>
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
                  {note.markdown ? (
                    <NoteMarkdownView
                      noteId={noteId}
                      content={note.markdown}
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

      {/* Shared side panel — animated width */}
      <div
        ref={sidePanelShellRef}
        className={cn(
          'relative flex min-h-0 shrink-0 flex-col overflow-hidden',
          !historyResizing && 'transition-[width] duration-300 ease-in-out',
        )}
        style={{ width: activeSidePanel ? sidePanelWidth : 0 }}
      >
        <div
          ref={sidePanelInnerRef}
          className="flex min-h-0 flex-1 flex-col"
          style={{ width: sidePanelWidth }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            onPointerDown={(e) => {
              e.preventDefault();
              const el = e.currentTarget;
              el.setPointerCapture(e.pointerId);
              setHistoryResizing(true);
              const startX = e.clientX;
              const startW = sidePanelWidth;
              const pid = e.pointerId;
              let rafId = 0;
              let nextWidth = sidePanelWidth;
              let committedWidth = sidePanelWidth;
              const applyWidth = () => {
                rafId = 0;
                committedWidth = nextWidth;
                if (activeSidePanel) {
                  sidePanelShellRef.current?.style.setProperty('width', `${committedWidth}px`);
                }
                sidePanelInnerRef.current?.style.setProperty('width', `${committedWidth}px`);
              };
              const onMove = (ev: PointerEvent) => {
                const newW = startW - (ev.clientX - startX);
                nextWidth = Math.max(280, Math.min(600, Math.round(newW)));
                if (rafId === 0) {
                  rafId = window.requestAnimationFrame(applyWidth);
                }
              };
              const onDone = () => {
                if (rafId !== 0) {
                  window.cancelAnimationFrame(rafId);
                  applyWidth();
                }
                try { el.releasePointerCapture(pid); } catch { /* */ }
                setHistoryResizing(false);
                setSidePanelWidth(committedWidth);
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onDone);
                window.removeEventListener('pointercancel', onDone);
              };
              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onDone);
              window.addEventListener('pointercancel', onDone);
            }}
            className={cn(
              'absolute left-0 top-0 z-10 h-full w-2 -translate-x-1/2 cursor-col-resize',
              "before:content-[''] before:pointer-events-none before:absolute before:left-1/2 before:top-0 before:h-full before:w-px before:-translate-x-1/2",
              'before:bg-transparent before:transition-[background-color] before:duration-150',
              'hover:before:bg-edge/65 dark:hover:before:bg-edge/75',
              historyResizing && 'before:!bg-edge/80 dark:before:!bg-edge/85',
              'touch-none select-none',
            )}
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge-subtle bg-surface-base">
            {activeSidePanel === 'history' ? (
              <NoteHistoryPanel
                noteId={noteId}
                activeTimestamp={previewSnapshot?.timestamp ?? null}
                onSelect={handleHistorySelect}
                onClose={handleHistoryClose}
                onRestored={handleHistoryRestored}
              />
            ) : activeSidePanel === 'breakdown' ? (
              <NoteBreakdownPanel
                noteId={noteId}
                note={note ?? null}
                catalyzing={catalyzing}
                onCatalyze={handleCatalyze}
                onClose={() => setActiveSidePanel(null)}
                noteThreads={noteThreads}
                openingChat={openingChat}
                onOpenChat={() => handleOpenNoteChat(false)}
                onOpenNewChat={() => handleOpenNoteChat(true)}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
