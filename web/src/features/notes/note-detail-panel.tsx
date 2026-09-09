import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowLeft, Check, ChevronDown, Eye, Code2, FileText, History, MessageCircle, MoreHorizontal, Search, Share2, Sparkles, Trash2 } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AutomationSuggestionCard } from '@/features/automations/automation-suggestion-card';
import { ProductAutomationFeedback } from '@/features/automations/product-automation-feedback';
import { DiscussionNoteSections } from '@/features/discussions/discussion-note-sections';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useThemeStore } from '@/stores/theme-store';
import { useReadAloudStore } from '@/features/voice/read-aloud-store';
import { detectSpeechLanguage } from '@/features/voice/read-aloud-text';

import {
  catalyzeNote,
  deleteNote,
  getNote,
  getNoteSnapshot,
  listNoteThreads,
  openNoteChat,
  updateNote,
  type NoteSnapshot,
  type NoteSnapshotEntry,
  type Note,
} from './notes-api';
import { NoteImageLightboxProvider, useNoteImageLightbox } from './note-image-lightbox';
import { NoteHistoryPanel } from './note-history-panel';
import { NoteMarkdownView } from './note-markdown-view';
import { NoteBreakdownPanel } from './note-breakdown-panel';
import { NoteShareDialog } from './note-share-dialog';
import { NoteReadAloudControls } from './note-read-aloud-controls';
import { buildNoteReadAloudText } from './note-read-aloud';

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
  const activeMode = modes.find((item) => item.id === mode) ?? modes[0];
  const ActiveIcon = activeMode.Icon;

  const preloadMode = (id: EditorMode) => {
    if (id === 'wysiwyg') void loadBlockEditor();
    if (id === 'source') void loadMarkdownEditor();
  };

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={activeMode.label}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-edge px-2.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ActiveIcon className="size-3.5" aria-hidden />
          <span>{activeMode.label}</span>
          <ChevronDown className="size-3 text-fg-subtle" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-36 rounded-xl border border-edge bg-surface-panel p-1 shadow-popover"
        >
          {modes.map(({ id, label, Icon }) => (
            <DropdownMenu.Item
              key={id}
              onSelect={() => onModeChange(id)}
              onPointerMove={() => preloadMode(id)}
              onFocus={() => preloadMode(id)}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover"
            >
              <Icon className="size-4 text-fg-muted" aria-hidden />
              <span className="flex-1">{label}</span>
              {mode === id ? <Check className="size-4 text-accent" aria-hidden /> : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
  initialMode?: EditorMode;
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
  initialMode,
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
        initialMode={initialMode}
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
  initialMode = 'wysiwyg',
  onAutoFocusConsumed,
}: NoteDetailPanelProps) {
  const language = useLocaleStore((s) => s.language);
  const n = messages(language).notes;
  const automationSuggestions = messages(language).automations.suggestions;
  const navigate = useNavigate();
  const isDark = useThemeStore((s) => s.resolved) === 'dark';
  const { openImage } = useNoteImageLightbox();
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [activeSidePanel, setActiveSidePanel] = useState<'history' | 'breakdown' | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<NoteSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [sidePanelWidth, setSidePanelWidth] = useState(360);
  const [historyResizing, setHistoryResizing] = useState(false);
  const [catalyzing, setCatalyzing] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareNote, setShareNote] = useState<Note | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  const { data: note, mutate, error: loadError } = useSWR(
    noteId ? ['note-detail', noteId] : null,
    () => getNote(noteId),
  );
  const { data: noteThreads = [], mutate: mutateNoteThreads } = useSWR(
    noteId ? ['note-threads', noteId] : null,
    () => listNoteThreads(noteId),
    { revalidateOnFocus: false },
  );
  const isPreviewingSnapshot = previewSnapshot !== null;

  const showRefreshError = useCallback((error: unknown) => {
    setActionError(`${n.refreshFailed}: ${error instanceof Error ? error.message : n.quickCaptureFailedHint}`);
  }, [n.quickCaptureFailedHint, n.refreshFailed]);

  useEffect(() => {
    if (!noteId) return undefined;
    const onNoteUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ noteId?: string }>).detail;
      if (detail?.noteId === noteId) {
        void mutate().catch(showRefreshError);
      }
    };
    window.addEventListener('note-updated', onNoteUpdated);
    return () => window.removeEventListener('note-updated', onNoteUpdated);
  }, [mutate, noteId, showRefreshError]);

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
        <ArrowLeft className="size-4" aria-hidden />
      </button>
    ) : null,
    [backButtonClassName, n.back, onBack, showBackButton],
  );

  const stopNoteReading = useCallback(() => {
    const player = useReadAloudStore.getState();
    if (player.source?.type === 'note' && player.source.id === noteId) player.stop();
  }, [noteId]);

  const handleModeChange = useCallback((nextMode: EditorMode) => {
    if (nextMode !== 'preview') stopNoteReading();
    setMode(nextMode);
  }, [stopNoteReading]);

  const handleTitleChange = useCallback(
    (value: string) => {
      stopNoteReading();
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
    [stopNoteReading, noteId, mutate, onSaved],
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
    setActionError(null);
    try {
      const result = await openNoteChat(noteId, { forceNew });
      await mutate();
      await mutateNoteThreads();
      navigate(`/chat/${encodeURIComponent(result.sessionKey)}`);
    } catch (err) {
      setActionError(`${n.chatOpenFailedTitle}: ${err instanceof Error ? err.message : n.chatOpenFailedMessage}`);
    } finally {
      setOpeningChat(false);
    }
  }, [mutate, mutateNoteThreads, navigate, noteId, n.chatOpenFailedMessage, n.chatOpenFailedTitle]);

  const handleCatalyze = useCallback(async () => {
    setCatalyzing(true);
    setActionError(null);
    try {
      await catalyzeNote(noteId);
      await mutate();
    } catch (err) {
      setActionError(`${n.catalysisFailed}: ${err instanceof Error ? err.message : n.chatOpenFailedMessage}`);
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

  const getNoteReadAloudInput = useCallback(() => {
    const markdown = previewSnapshot ? (previewSnapshot.markdown ?? '') : (pendingMarkdownRef.current ?? note?.markdown ?? '');
    const noteTitle = previewSnapshot ? (previewSnapshot.title ?? '') : title;
    const text = buildNoteReadAloudText(noteTitle, markdown);
    return {
      source: { type: 'note' as const, id: noteId, title: noteTitle || n.titlePlaceholder },
      text,
      language: detectSpeechLanguage(text, language),
    };
  }, [language, n.titlePlaceholder, note?.markdown, noteId, previewSnapshot, title]);

  const flushPendingSave = useCallback(async (): Promise<Note | null> => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
    debounceRef.current = null;
    titleDebounceRef.current = null;
    const markdown = pendingMarkdownRef.current;
    const pendingTitle = pendingTitleRef.current;
    pendingMarkdownRef.current = null;
    pendingTitleRef.current = null;
    const patch: Partial<Note> = {};
    if (markdown !== null) patch.markdown = markdown;
    if (pendingTitle !== null) patch.title = pendingTitle;
    if (Object.keys(patch).length === 0) return note ?? null;
    setSaving(true);
    try {
      const saved = await updateNote(noteId, patch);
      await mutate(saved, { revalidate: false });
      onSaved?.();
      return saved;
    } catch (err) {
      setActionError(`${n.saveFailed}: ${err instanceof Error ? err.message : n.saveFailedHint}`);
      return null;
    } finally {
      setSaving(false);
    }
  }, [mutate, n.saveFailed, n.saveFailedHint, note, noteId, onSaved]);

  const handleShare = useCallback(async () => {
    setActionError(null);
    const saved = await flushPendingSave();
    if (!saved) return;
    setShareNote(saved);
    setShareDialogOpen(true);
  }, [flushPendingSave]);

  const handleDelete = useCallback(async () => {
    if (deleting || saving) return;
    setDeleteConfirmOpen(false);
    setDeleting(true);
    setActionError(null);
    stopNoteReading();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
    debounceRef.current = null;
    titleDebounceRef.current = null;
    pendingMarkdownRef.current = null;
    pendingTitleRef.current = null;
    try {
      await deleteNote(noteId);
      window.dispatchEvent(new CustomEvent('note-deleted', { detail: { noteId } }));
      onSaved?.();
      onBack();
    } catch (err) {
      setActionError(`${n.deleteFailed}: ${err instanceof Error ? err.message : n.quickCaptureFailedHint}`);
    } finally {
      setDeleting(false);
    }
  }, [deleting, n.deleteFailed, n.quickCaptureFailedHint, noteId, onBack, onSaved, saving, stopNoteReading]);

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
            <Search className="size-4" aria-hidden />
          </button>
        ) : null}
        <NoteReadAloudControls
          input={getNoteReadAloudInput}
          showLabel={false}
          labels={{
            read: n.readAloud,
            preparing: n.readAloudPreparing,
            pause: n.readAloudPause,
            resume: n.readAloudResume,
            retry: n.readAloudRetry,
            stop: n.readAloudStop,
          }}
        />
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
          <Sparkles className="size-3.5" aria-hidden />
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
          <MessageCircle className="size-3.5" aria-hidden />
          {openingChat ? n.openingChat : n.openChatButton}
        </button>
        <NoteDetailModeSwitcher
          mode={mode}
          onModeChange={handleModeChange}
          labels={{ edit: n.modeEdit, source: n.modeSource, preview: n.modePreview }}
        />
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={n.noteActions}
              title={n.noteActions}
              className="inline-flex size-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-50 min-w-40 rounded-xl border border-edge bg-surface-panel p-1 shadow-popover"
            >
              <DropdownMenu.Item
                onSelect={() => void handleShare()}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover"
              >
                <Share2 className="size-4 text-fg-muted" aria-hidden />
                {language === 'zh' ? '分享' : 'Share'}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => setActiveSidePanel(activeSidePanel === 'history' ? null : 'history')}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover"
              >
                <History className="size-4 text-fg-muted" aria-hidden />
                <span className="flex-1">{n.history}</span>
                {activeSidePanel === 'history' ? <Check className="size-4 text-accent" aria-hidden /> : null}
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-edge-subtle" />
              <DropdownMenu.Item
                disabled={deleting || saving}
                onSelect={() => setDeleteConfirmOpen(true)}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger outline-none hover:bg-danger-soft focus:bg-danger-soft data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
              >
                <Trash2 className="size-4" aria-hidden />
                {n.delete}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
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
      n.readAloud,
      n.readAloudPause,
      n.readAloudPreparing,
      n.readAloudResume,
      n.readAloudRetry,
      n.readAloudStop,
      handleModeChange,
      getNoteReadAloudInput,
      handleShare,
      deleting,
      saving,
      language,
      n.delete,
      setDeleteConfirmOpen,
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
      stopNoteReading();
      pendingMarkdownRef.current = content;

      // Debounce saves to avoid excessive API calls
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        const markdown = pendingMarkdownRef.current;
        pendingMarkdownRef.current = null;
        if (markdown === null) return;
        setSaving(true);
        setActionError(null);
        try {
          await updateNote(noteId, { markdown });
          await mutate();
          onSaved?.();
        } catch (err) {
          setActionError(`${n.saveFailed}: ${err instanceof Error ? err.message : n.saveFailedHint}`);
        } finally {
          setSaving(false);
        }
      }, 600);
    },
    [stopNoteReading, noteId, mutate, n.saveFailed, n.saveFailedHint, onSaved],
  );

  const handleHistorySelect = useCallback(
    (entry: NoteSnapshotEntry) => {
      getNoteSnapshot(noteId, entry.timestamp).then((snapshot) => {
        if (snapshot) {
          stopNoteReading();
          setPreviewSnapshot(snapshot);
        }
      });
    },
    [noteId, stopNoteReading],
  );

  const handleHistoryClose = useCallback(() => {
    stopNoteReading();
    setActiveSidePanel(null);
    setPreviewSnapshot(null);
  }, [stopNoteReading]);

  const handleHistoryRestored = useCallback(() => {
    stopNoteReading();
    setActiveSidePanel(null);
    setPreviewSnapshot(null);
    void mutate().catch(showRefreshError);
    onSaved?.();
  }, [mutate, onSaved, showRefreshError, stopNoteReading]);

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
      if (Object.keys(patch).length > 0) {
        // The component is already unmounting, so only consume the best-effort save failure here.
        void updateNote(noteId, patch).catch(() => undefined);
      }
    };
  }, [noteId]);

  if (note === undefined) {
    if (loadError) return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
        <p className="text-sm text-danger">{n.home.loadFailed}</p>
        <button type="button" onClick={() => void mutate().catch(showRefreshError)} className="rounded-lg border border-edge px-3 py-2 text-sm text-fg hover:bg-surface-hover">{n.home.retry}</button>
        <button type="button" onClick={onBack} className="text-sm text-fg-muted hover:text-fg">{n.back}</button>
      </div>
    );
    return (
      <EditorFallback />
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
  const displayText = isPreviewingSnapshot ? (previewSnapshot.markdown ?? '') : (pendingMarkdownRef.current ?? note.markdown ?? '');
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
    <>
    <div className="flex h-full min-h-0 gap-3 p-4 sm:px-5">
      {/* Editor */}
      <div className="mx-auto flex min-h-0 min-w-0 w-full max-w-[60rem] flex-1 flex-col">
        {actionError ? <p className="mb-3 shrink-0 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{actionError}</p> : null}
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
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel xl:flex-row"
        >
          <DiscussionNoteSections noteId={noteId} />
          <div className="min-h-0 min-w-0 flex-1">
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
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel">
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
    {shareNote ? <NoteShareDialog open={shareDialogOpen} onOpenChange={setShareDialogOpen} note={shareNote} /> : null}
    <ConfirmDialog
      open={deleteConfirmOpen}
      title={n.deleteConfirmTitle}
      description={n.deleteConfirmDescription.replace('{{title}}', note.title || n.titlePlaceholder)}
      confirmLabel={n.deleteConfirmLabel}
      cancelLabel={n.deleteCancelLabel}
      destructive
      onConfirm={() => void handleDelete()}
      onCancel={() => setDeleteConfirmOpen(false)}
    />
    </>
  );
}
