import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AlignLeft, Archive, ArchiveRestore, ArrowLeft, Check, ChevronDown, Eye, Code2, FileText, History, MessageCircle, MoreHorizontal, RotateCcw, Search, Share2, Sparkles, Trash2, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { SessionManager } from '@/features/chat/session/session-manager';
import { pageContextDrafts, pageContextDraftKey } from '@/features/chat/context/page-context-draft';
import { useGatewayStore } from '@/stores/gateway-store';

import type { EditorTextSelection } from '@/components/editor-text-selection';
import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ProductAutomationFeedback } from '@/features/automations/product-automation-feedback';
import { getDiscussionForNote } from '@/features/discussions/discussion-api';
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
import { NoteMarkdownView, toggleMarkdownTaskAtIndex } from './note-markdown-view';
import { NoteOutlineDialog, NoteOutlinePopover, useNoteOutline } from './note-outline';
import { NoteBreakdownPanel } from './note-breakdown-panel';
import { NoteShareDialog } from './note-share-dialog';
import { NoteSelectionActions } from './note-selection-actions';
import { NoteReadAloudControls } from './note-read-aloud-controls';
import { buildNoteReadAloudText } from './note-read-aloud';
import { NoteBacklinksSection, NoteTagBar } from './note-tag-bar';

type EditorMode = 'wysiwyg' | 'source' | 'preview';

const loadBlockEditor = () => import('@/components/block-editor');
const loadMarkdownEditor = () => import('@/components/markdown/markdown-editor');

const NoteAssistantChat = lazy(() => import('@/features/chat/chat-page').then(module => ({ default: module.ChatPage })));

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
          className="z-50 min-w-36 rounded-xl border border-edge bg-surface-overlay p-1 shadow-popover"
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
        key={noteId}
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
  const contextLabels = messages(language).chat.pageContext;
  const { data: meeting } = useSWR(['note-discussion-document', noteId], () => getDiscussionForNote(noteId));
  const [showMeeting, setShowMeeting] = useState(true);
  const [populatedGen, setPopulatedGen] = useState(0);
  const didInitMeetingTabRef = useRef<string | null>(null);
  const [textSelection, setTextSelection] = useState<EditorTextSelection | null>(null);
  const dismissSelection = useCallback(() => setTextSelection(null), []);
  useEffect(() => { setTextSelection(null); }, [noteId]);
  const navigate = useNavigate();
  const isDark = useThemeStore((s) => s.resolved) === 'dark';
  const { openImage } = useNoteImageLightbox();
  const [mode, setMode] = useState<EditorMode>(initialMode);
  useEffect(() => { setTextSelection(null); }, [mode, showMeeting]);
  const [activeSidePanel, setActiveSidePanel] = useState<'history' | 'breakdown' | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<NoteSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reviewingConflict, setReviewingConflict] = useState(false);
  const [conflictingNote, setConflictingNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [sidePanelWidth, setSidePanelWidth] = useState(360);
  const [historyResizing, setHistoryResizing] = useState(false);
  const [catalyzing, setCatalyzing] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantBinding, setAssistantBinding] = useState<{ noteId: string; gatewayUrl: string; gatewayToken?: string; conversationId: string } | null>(null);
  const assistantGeneration = useRef(0);
  const [assistantDraft, setAssistantDraft] = useState<{ id: number; text: string } | null>(null);
  const gatewayUrl = useGatewayStore(state => state.baseUrl);
  const gatewayToken = useGatewayStore(state => state.conversationId);
  const assistantConversationId = assistantBinding?.noteId === noteId && assistantBinding.gatewayUrl === gatewayUrl
    && assistantBinding.gatewayToken === gatewayToken ? assistantBinding.conversationId : null;
  useEffect(() => {
    assistantGeneration.current++;
    setAssistantOpen(false); setAssistantBinding(null); setOpeningChat(false); setAssistantDraft(null);
    didInitMeetingTabRef.current = null;
    setShowMeeting(true);
    return () => { assistantGeneration.current++; };
  }, [noteId, gatewayUrl, gatewayToken]);
  const captureGeneration = useRef(0);
  useEffect(() => () => { captureGeneration.current += 1; }, [noteId]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareNote, setShareNote] = useState<Note | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const titleComposingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef<Promise<Note | null> | null>(null);
  const pendingMarkdownRef = useRef<string | null>(null);
  const pendingTitleRef = useRef<string | null>(null);
  const pendingEditRevision = useRef<number | undefined>(undefined);
  const saveConflictRef = useRef(false);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [outlineRoot, setOutlineRoot] = useState<HTMLDivElement | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const { headings, current: currentHeading, wide: wideOutline, goTo: goToHeading } = useNoteOutline(outlineRoot);
  const hasOutline = headings.length >= 2 && previewSnapshot === null && mode !== 'source' && (!meeting || !showMeeting);
  const dockOutline = hasOutline && wideOutline && !assistantOpen && !activeSidePanel && !meeting;
  useEffect(() => {
    if (!hasOutline || dockOutline) setOutlineOpen(false);
  }, [dockOutline, hasOutline]);
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
    setTitle('');
    setPreviewSnapshot(null);
    setActiveSidePanel(null);
    titleComposingRef.current = false;
    didAutoFocusRef.current = null;
  }, [noteId]);

  useEffect(() => {
    if (!note || saving || pendingTitleRef.current !== null || titleComposingRef.current) return;
    setTitle(note.title ?? '');
    if (meeting && didInitMeetingTabRef.current !== note.id) {
      didInitMeetingTabRef.current = note.id;
      if (note.markdown.trim().length > 0) {
        setShowMeeting(false);
      }
    }
  }, [meeting, note, saving]);

  const attachTitleInput = useCallback((element: HTMLInputElement | null) => {
    titleInputRef.current = element;
    if (!element || !autoFocus || didAutoFocusRef.current === noteId) return;
    window.requestAnimationFrame(() => {
      if (titleInputRef.current !== element || didAutoFocusRef.current === noteId) return;
      didAutoFocusRef.current = noteId;
      element.focus({ preventScroll: true });
      onAutoFocusConsumed?.();
    });
  }, [autoFocus, noteId, onAutoFocusConsumed]);

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
    if (nextMode === mode) return;
    if (nextMode !== 'preview') stopNoteReading();
    setMode(nextMode);
  }, [mode, stopNoteReading]);

  useEffect(() => {
    if (!saving && pendingMarkdownRef.current === null && pendingTitleRef.current === null) {
      pendingEditRevision.current = note?.remoteVersion ?? 1;
    }
  }, [noteId, note?.remoteVersion, saving]);
  const persistEditorPatch = useCallback(async (patch: Partial<Note>, expectedRevision?: number) => {
    const expected = expectedRevision ?? pendingEditRevision.current ?? note?.remoteVersion ?? 1;
    const saved = await updateNote(noteId, patch, expected);
    pendingEditRevision.current = saved.remoteVersion ?? expected + 1;
    return saved;
  }, [noteId, note?.remoteVersion]);

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
        <span role="status" className="shrink-0 text-xs text-fg-muted">{saving ? n.saving : null}</span>
      </div>
    ),
    [n.saving, saving, time, title],
  );

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
    setAssistantOpen(false);
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

  const flushPendingSave = useCallback(async (reviewedRevision?: number): Promise<Note | null> => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;

    while (saveInFlightRef.current) {
      const saved = await saveInFlightRef.current;
      if (!saved || (pendingMarkdownRef.current === null && pendingTitleRef.current === null)) return saved;
    }
    if (saveConflictRef.current && reviewedRevision === undefined) return null;

    const markdown = pendingMarkdownRef.current;
    const pendingTitle = titleComposingRef.current ? null : pendingTitleRef.current;
    const patch: Partial<Note> = {};
    if (markdown !== null) patch.markdown = markdown;
    if (pendingTitle !== null) patch.title = pendingTitle;
    if (markdown === null && pendingTitle === null) return note ?? null;

    // Keep the draft available while the request is in flight so mode changes see the latest text.
    setSaving(true);
    setSaveError(null);
    const request = persistEditorPatch(patch, reviewedRevision).then(async (saved) => {
      await mutate(saved, { revalidate: false });
      saveConflictRef.current = false;
      if (pendingMarkdownRef.current === markdown) pendingMarkdownRef.current = null;
      if (pendingTitleRef.current === pendingTitle) pendingTitleRef.current = null;
      onSaved?.();
      return saved;
    }).catch((err: unknown) => {
      if (err instanceof Error && 'status' in err && err.status === 409) {
        saveConflictRef.current = true;
        setSaveError(n.saveConflict);
      } else {
        setSaveError(`${n.saveFailed}: ${err instanceof Error ? err.message : n.saveFailedHint}`);
      }
      return null;
    }).finally(() => {
      saveInFlightRef.current = null;
      setSaving(false);
    });
    saveInFlightRef.current = request;
    return request;
  }, [mutate, n.saveConflict, n.saveFailed, n.saveFailedHint, note, onSaved, persistEditorPatch]);

  const reviewConflict = async () => {
    setReviewingConflict(true);
    try {
      const latest = await getNote(noteId);
      if (!latest) throw new Error(n.saveConflictMissing);
      setConflictingNote(latest);
      setSaveError(n.saveConflict);
    } catch (error) {
      setSaveError(`${n.saveFailed}: ${error instanceof Error ? error.message : n.saveFailedHint}`);
    } finally {
      setReviewingConflict(false);
    }
  };

  const flushPendingSaveRef = useRef(flushPendingSave);
  flushPendingSaveRef.current = flushPendingSave;
  const scheduleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void flushPendingSaveRef.current(), 600);
  }, []);

  const handleTitleChange = useCallback((value: string) => {
    stopNoteReading();
    setTitle(value);
    pendingTitleRef.current = value;
    if (!titleComposingRef.current) scheduleSave();
  }, [scheduleSave, stopNoteReading]);

  const finishTitleComposition = () => {
    titleComposingRef.current = false;
    if (pendingTitleRef.current !== null) scheduleSave();
  };

  const handleSave = useCallback((content: string) => {
    stopNoteReading();
    pendingMarkdownRef.current = content;
    scheduleSave();
  }, [scheduleSave, stopNoteReading]);

  const beforeAssistantSend = useCallback(async () => {
    if (saving) {
      setActionError(language === 'zh' ? '笔记正在保存，请稍后发送。' : 'The note is saving. Please send again shortly.');
      return false;
    }
    const saved = await flushPendingSave();
    return !!saved && pendingMarkdownRef.current === null && pendingTitleRef.current === null;
  }, [saving, language, flushPendingSave]);

  const handleOpenNoteChat = useCallback(async (forceNew = false) => {
    setActiveSidePanel(null);
    setAssistantOpen(true);
    if (openingChat || (!forceNew && assistantConversationId)) return;
    const generation = ++assistantGeneration.current;
    setOpeningChat(true); setActionError(null);
    try {
      if (!await beforeAssistantSend()) return;
      const result = await openNoteChat(noteId, { forceNew });
      if (generation !== assistantGeneration.current) return;
      setAssistantBinding({ noteId, gatewayUrl, gatewayToken, conversationId: result.conversationId });
      await mutate(); await mutateNoteThreads();
    } catch (err) {
      if (generation === assistantGeneration.current) setActionError(`${n.chatOpenFailedTitle}: ${err instanceof Error ? err.message : n.chatOpenFailedMessage}`);
    } finally {
      if (generation === assistantGeneration.current) setOpeningChat(false);
    }
  }, [openingChat, assistantConversationId, beforeAssistantSend, mutate, mutateNoteThreads, noteId, gatewayUrl, gatewayToken, n.chatOpenFailedMessage, n.chatOpenFailedTitle]);

  const handleCaptureContext = useCallback(async (selectionOverride?: string) => {
    if (!note || openingChat || saving) return;
    setOpeningChat(true);
    setActionError(null);
    const gateway = useGatewayStore.getState();
    const generation = ++captureGeneration.current;
    const isCurrent = () => captureGeneration.current === generation
      && useGatewayStore.getState().baseUrl === gateway.baseUrl
      && useGatewayStore.getState().conversationId === gateway.conversationId;
    try {
      const selection = window.getSelection();
      const selectedText = selectionOverride ?? (selection?.anchorNode && selection.focusNode
        && editorContainerRef.current?.contains(selection.anchorNode)
        && editorContainerRef.current.contains(selection.focusNode) ? selection.toString() : '');
      // Leaving this page flushes edits too; capture the saved revision, not its predecessor.
      const saved = await flushPendingSave();
      if (!saved || !isCurrent()) return;
      if (pendingMarkdownRef.current !== null || pendingTitleRef.current !== null) {
        throw new Error(contextLabels.unavailable);
      }
      const draft = pageContextDrafts.capture({ title: saved.title || saved.id, text: saved.markdown,
        resourceRefs: [{ kind: 'note', id: saved.id, revision: String(saved.remoteVersion ?? 1) }],
        selection: selectedText ? { text: selectedText, draft: false } : undefined,
      });
      const session = await new SessionManager().createSession();
      if (!isCurrent()) return;
      if (pendingMarkdownRef.current !== null || pendingTitleRef.current !== null) {
        throw new Error(contextLabels.unavailable);
      }
      const key = pageContextDraftKey(gateway.baseUrl, gateway.conversationId, session.key);
      if (!pageContextDrafts.put(key, draft)) throw new Error(contextLabels.unavailable);
      navigate(`/chat/${encodeURIComponent(session.key)}`);
    } catch {
      if (isCurrent()) setActionError(contextLabels.unavailable);
    } finally {
      if (captureGeneration.current === generation) setOpeningChat(false);
    }
  }, [note, openingChat, saving, flushPendingSave, navigate, contextLabels.unavailable]);

  const handleShare = useCallback(async () => {
    setActionError(null);
    const saved = await flushPendingSave();
    if (!saved) return;
    setShareNote(saved);
    setShareDialogOpen(true);
  }, [flushPendingSave]);

  const handleStatusUpdate = useCallback(
    async (nextStatus: 'inbox' | 'archived' | 'trashed') => {
      if (deleting || saving) return;
      setDeleting(true);
      setActionError(null);
      try {
        await flushPendingSave();
        await updateNote(noteId, { status: nextStatus });
        window.dispatchEvent(new CustomEvent('note-updated', { detail: { noteId } }));
        await mutate();
        onSaved?.();
        if (nextStatus === 'trashed') {
          onBack();
        }
      } catch (err) {
        setActionError(`${n.actionFailed}: ${err instanceof Error ? err.message : n.quickCaptureFailedHint}`);
      } finally {
        setDeleting(false);
      }
    },
    [deleting, flushPendingSave, mutate, n.actionFailed, n.quickCaptureFailedHint, noteId, onBack, onSaved, saving],
  );

  const handleDelete = useCallback(async () => {
    if (deleting || saving) return;
    setDeleteConfirmOpen(false);
    setDeleting(true);
    setActionError(null);
    stopNoteReading();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
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

  const selectOutlineHeading = (element: HTMLElement) => {
    if (outlineRoot?.clientWidth === 0) {
      setAssistantOpen(false);
      setActiveSidePanel(null);
      window.requestAnimationFrame(() => goToHeading(element));
      return;
    }
    goToHeading(element);
  };

  const headerEnd = useMemo(
    () => (
      <div className={cn('flex min-w-0 items-center gap-1 sm:gap-2', APP_CHROME_NO_DRAG_CLASS)}>
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
          onClick={() => { if (assistantOpen) setAssistantOpen(false); else void handleOpenNoteChat(); }}
          aria-label={openingChat ? n.openingChat : n.openChatButton}
          title={n.openChatButton}
          aria-controls={assistantOpen ? `note-assistant-${noteId}` : undefined}
          aria-expanded={assistantOpen}
          data-note-assistant-trigger
          disabled={openingChat}
          className={cn(
            'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50',
            assistantOpen && 'bg-surface-active text-fg',
          )}
        >
          <MessageCircle className="size-3.5" aria-hidden />
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
              data-note-actions-trigger
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
              className="z-50 min-w-40 rounded-xl border border-edge bg-surface-overlay p-1 shadow-popover"
            >
              {hasOutline && !dockOutline ? (
                <DropdownMenu.Item
                  onSelect={() => setOutlineOpen(true)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover"
                >
                  <AlignLeft className="size-4 text-fg-muted" aria-hidden />
                  {n.outline}
                </DropdownMenu.Item>
              ) : null}
              <DropdownMenu.Item onSelect={handleBreakdownClick} disabled={catalyzing}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover data-[disabled]:opacity-50">
                <Sparkles className="size-4 text-fg-muted" aria-hidden />
                {catalyzing ? n.catalyzing : n.catalyzeButton}
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => void handleCaptureContext()} disabled={openingChat || saving || !note || Boolean(previewSnapshot)}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover data-[disabled]:opacity-50">
                <FileText className="size-4 text-fg-muted" aria-hidden />
                {contextLabels.capture}
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-edge-subtle" />
              <DropdownMenu.Item
                onSelect={() => void handleShare()}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover"
              >
                <Share2 className="size-4 text-fg-muted" aria-hidden />
                {language === 'zh' ? '分享' : 'Share'}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => { setAssistantOpen(false); setActiveSidePanel(activeSidePanel === 'history' ? null : 'history'); }}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover"
              >
                <History className="size-4 text-fg-muted" aria-hidden />
                <span className="flex-1">{n.history}</span>
                {activeSidePanel === 'history' ? <Check className="size-4 text-accent" aria-hidden /> : null}
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-edge-subtle" />
              {note && note.status !== 'trashed' ? (
                <DropdownMenu.Item
                  disabled={deleting || saving}
                  onSelect={() => void handleStatusUpdate(note.status === 'archived' ? 'inbox' : 'archived')}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover data-[disabled]:opacity-50"
                >
                  {note.status === 'archived'
                    ? <ArchiveRestore className="size-4 text-fg-muted" aria-hidden />
                    : <Archive className="size-4 text-fg-muted" aria-hidden />}
                  {note.status === 'archived'
                    ? (language === 'zh' ? '取消归档' : 'Unarchive')
                    : (language === 'zh' ? '归档' : 'Archive')}
                </DropdownMenu.Item>
              ) : null}
              <DropdownMenu.Item
                disabled={deleting || saving}
                onSelect={() => {
                  if (note?.status === 'trashed') {
                    setDeleteConfirmOpen(true);
                  } else {
                    void handleStatusUpdate('trashed');
                  }
                }}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger outline-none hover:bg-danger-soft focus:bg-danger-soft data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
              >
                <Trash2 className="size-4" aria-hidden />
                {note?.status === 'trashed'
                  ? (language === 'zh' ? '彻底删除' : 'Delete permanently')
                  : (language === 'zh' ? '移至回收站' : 'Move to Trash')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    ),
    [
      catalyzing,
      hasOutline,
      dockOutline,
      n.outline,
      assistantOpen,
      noteId,
      handleBreakdownClick,
      handleOpenNoteChat,
      handleCaptureContext,
      contextLabels.capture,
      note,
      previewSnapshot,
      mode,
      n.history,
      n.catalyzeButton,
      n.catalyzing,
      n.noteActions,
      n.openChatButton,
      n.openingChat,
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
      handleStatusUpdate,
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
      main: note && !meeting ? headerMain : null,
      end: note && !meeting ? headerEnd : null,
    });
    return () => {
      if (clearHeaderOnCleanup) clearPageHeader();
    };
  }, [clearHeaderOnCleanup, clearPageHeader, headerEnd, headerMain, headerStart, meeting, showMeeting, note, setPageHeader]);

  const handleHistorySelect = useCallback(
    (entry: NoteSnapshotEntry) => {
      getNoteSnapshot(noteId, entry.timestamp).then((snapshot) => {
        if (snapshot) {
          stopNoteReading();
          setPreviewSnapshot(snapshot);
          if (meeting) setShowMeeting(false);
        }
      });
    },
    [meeting, noteId, stopNoteReading],
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
      void flushPendingSaveRef.current();
    };
  }, []);

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
  const voiceTitle = /^Discussion · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(title) ? '' : title;
  const voiceTitleLabel = language === 'zh' ? '语音笔记' : 'Voice note';
  const voiceTitleEditor = !showMeeting && !isPreviewingSnapshot ? (
    <div>
      <input
        ref={attachTitleInput}
        aria-label={n.titlePlaceholder}
        value={voiceTitle}
        placeholder={voiceTitleLabel}
        onChange={event => handleTitleChange(event.target.value)}
        onCompositionStart={() => { titleComposingRef.current = true; }}
        onCompositionEnd={finishTitleComposition}
        className="w-full rounded-md bg-transparent text-2xl font-semibold leading-snug tracking-tight placeholder:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <NoteTagBar
        noteId={noteId}
        tags={note.tags}
        suggestedTags={note.ai?.suggestedTags}
        readOnly={note.status === 'trashed'}
        onUpdated={() => { void mutate(); onSaved?.(); }}
      />
    </div>
  ) : null;

  const documentTitle = (
    <div>
      <input
        ref={attachTitleInput}
        type="text"
        aria-label={n.titlePlaceholder}
        value={title}
        onChange={event => handleTitleChange(event.target.value)}
        onCompositionStart={() => { titleComposingRef.current = true; }}
        onCompositionEnd={finishTitleComposition}
        onKeyDown={event => {
          if (event.key !== 'Enter' || titleComposingRef.current || event.nativeEvent.isComposing) return;
          const body = editorContainerRef.current?.querySelector<HTMLElement>('.ProseMirror, .cm-content');
          if (!body) return;
          event.preventDefault();
          body.focus();
        }}
        placeholder={n.titlePlaceholder}
        className="block w-full min-w-0 rounded-md bg-transparent text-[clamp(1.75rem,4vw,2.5rem)] font-bold leading-tight tracking-tight text-fg placeholder:text-fg-muted/60 focus:outline-none"
      />
      <NoteTagBar
        noteId={noteId}
        tags={note.tags}
        suggestedTags={note.ai?.suggestedTags}
        readOnly={isPreviewingSnapshot || note.status === 'trashed'}
        onUpdated={() => { void mutate(); onSaved?.(); }}
      />
    </div>
  );

  const personalEditor = (
    <div ref={setOutlineRoot} className="relative flex h-full min-h-0 flex-col">
      {dockOutline ? <NoteOutlinePopover label={n.outline} headings={headings} current={currentHeading} onSelect={selectOutlineHeading} /> : null}
      {meeting ? <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-wrap items-center justify-between gap-x-2 px-5 pb-1 pt-2 sm:px-10"><span className="text-xs text-fg-muted">{language === 'zh' ? '笔记正文 · 支持自由排版与编辑' : 'Editable note document'}</span><NoteDetailModeSwitcher mode={mode} onModeChange={handleModeChange} labels={{ edit: n.modeEdit, source: n.modeSource, preview: n.modePreview }} /></div> : null}
          <div className="h-full min-h-0 min-w-0 flex-1">
            {isPreviewingSnapshot ? (
              <div className="h-full overflow-y-auto px-4 py-4 sm:px-6">
                {displayTitle && (
                  <h1 className="mb-4 text-2xl font-bold text-fg/70">{displayTitle}</h1>
                )}
                {displayText ? (
                  <NoteMarkdownView
                    noteId={noteId}
                    attachments={note.attachments}
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
                    <div className="min-h-0 flex-1">
                      <Suspense fallback={<EditorFallback />}>
                        <BlockEditor
                          key={`wysiwyg-${noteId}-${populatedGen}`}
                          autoFocus={!!meeting && !showMeeting}
                          placeholder={n.editorPlaceholder}
                          documentHeader={!meeting ? documentTitle : undefined}
                          initialContent={displayText}
                          onChange={handleSave}
                          noteId={noteId}
                          attachments={note.attachments}
                          onAttachmentUploaded={() => void mutate()}
                          onTextSelection={setTextSelection}
                        />
                      </Suspense>
                    </div>
                  </div>
                )}
                {mode === 'source' && (
                  <div className="flex h-full flex-col">
                    {!meeting ? <div className="mx-auto mb-3 w-full max-w-3xl px-5 pt-6 sm:px-10 sm:pt-9">{documentTitle}</div> : null}
                    <div className="mx-auto min-h-0 min-w-0 w-full max-w-3xl flex-1 px-3 sm:px-8">
                      <Suspense fallback={<EditorFallback />}>
                        <MarkdownEditor
                          key={`source-${noteId}-${populatedGen}`}
                          initialContent={displayText}
                          onChange={handleSave}
                          isDark={isDark}
                          onTextSelection={setTextSelection}
                        />
                      </Suspense>
                    </div>
                  </div>
                )}
                {mode === 'preview' && (
                  <div
                    data-note-outline-scroll
                    className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-5 py-6 sm:px-10 sm:pt-9"
                    onClick={(event) => {
                      const target = event.target;
                      if (!(target instanceof HTMLImageElement)) return;
                      openImage(target.currentSrc || target.src, target.alt);
                    }}
                  >
                    {!meeting && title && !displayText.trimStart().startsWith(`# ${title.trim()}\n`) && displayText.trim() !== `# ${title.trim()}` && (
                      <h1 className="mb-5 break-words text-[clamp(1.75rem,4vw,2.5rem)] font-bold leading-tight tracking-tight text-fg">{title}</h1>
                    )}
                    {!meeting ? (
                      <NoteTagBar
                        noteId={noteId}
                        tags={note.tags}
                        suggestedTags={note.ai?.suggestedTags}
                        readOnly={note.status === 'trashed'}
                        onUpdated={() => { void mutate(); onSaved?.(); }}
                        className="mb-4 mt-0"
                      />
                    ) : null}
                    {displayText ? (
                      <div data-note-outline-content>
                        <NoteMarkdownView
                          noteId={noteId}
                          attachments={note.attachments}
                          content={displayText}
                          onToggleTaskIndex={
                            !isPreviewingSnapshot && note.status !== 'trashed'
                              ? (taskIdx, checked) => {
                                  const next = toggleMarkdownTaskAtIndex(displayText, taskIdx, checked);
                                  if (next !== displayText) {
                                    handleSave(next);
                                    setPopulatedGen((c) => c + 1);
                                  }
                                }
                              : undefined
                          }
                          className="[&_img]:cursor-zoom-in"
                        />
                      </div>
                    ) : (
                      meeting ? <button type="button" className="min-h-11 rounded-lg px-2 text-sm text-accent-fg hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" onClick={() => handleModeChange('wysiwyg')}>{language === 'zh' ? '写笔记' : 'Write notes'}</button> : <p className="italic text-fg-muted">{n.emptyPreview}</p>
                    )}
                    <NoteBacklinksSection noteId={noteId} />
                  </div>
                )}
              </>
            )}
          </div>
          {!isPreviewingSnapshot && mode !== 'preview' && (!meeting || !showMeeting) ? (
            <NoteBacklinksSection noteId={noteId} className="mx-auto mt-0 w-full max-w-3xl shrink-0 px-5 pb-3 pt-2 sm:px-10" />
          ) : null}
    </div>
  );

  return (
    <>
    {hasOutline && !dockOutline ? (
      <NoteOutlineDialog
        label={n.outline}
        closeLabel={n.outlineClose}
        headings={headings}
        current={currentHeading}
        onSelect={selectOutlineHeading}
        open={outlineOpen}
        onOpenChange={setOutlineOpen}
        returnFocus={() => document.querySelector<HTMLButtonElement>('[data-note-actions-trigger]')?.focus({ preventScroll: true })}
      />
    ) : null}
    {textSelection && !isPreviewingSnapshot && !(meeting && showMeeting) && mode !== 'preview' ? <NoteSelectionActions key={`${noteId}:${mode}`} noteId={noteId} selection={textSelection} zh={language === 'zh'} onDismiss={dismissSelection} onAsk={text => { setAssistantDraft({ id: Date.now(), text: language === 'zh' ? `请帮我分析或改写下面这段笔记：\n\n${text}` : `Help me analyze or rewrite this note selection:\n\n${text}` }); dismissSelection(); void handleOpenNoteChat(); }} /> : null}
    <div className="@container/note flex h-full min-h-0 min-w-0 gap-3 p-3 sm:p-4">
      {/* Editor */}
      <div className={cn("mx-auto min-h-0 min-w-0 w-full flex-1 flex-col", (assistantOpen || activeSidePanel) ? "hidden @min-[56rem]/note:flex" : "flex", !meeting && "max-w-[60rem]")}>
        {saveError ? (
          <div className="mb-3 flex shrink-0 items-center gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">
            <p role="alert" className="min-w-0 flex-1 break-words">{saveError}</p>
            <button type="button" className="shrink-0 rounded-md px-2 py-1 font-medium hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
              disabled={reviewingConflict}
              onClick={() => void (saveConflictRef.current ? reviewConflict() : flushPendingSave())}>
              {saveConflictRef.current ? n.saveConflictReview : n.home.retry}
            </button>
          </div>
        ) : null}
        {actionError ? <p className="mb-3 shrink-0 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{actionError}</p> : null}
        {note.status === 'trashed' ? (
          <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-fg">
            <span>{language === 'zh' ? '此笔记当前位于回收站。' : 'This note is currently in the Trash.'}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={deleting || saving}
                onClick={() => void handleStatusUpdate('inbox')}
                className="inline-flex items-center gap-1 rounded-md bg-surface-panel px-2.5 py-1 font-medium text-fg hover:bg-surface-hover disabled:opacity-50"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                {language === 'zh' ? '恢复笔记' : 'Restore'}
              </button>
              <button
                type="button"
                disabled={deleting || saving}
                onClick={() => setDeleteConfirmOpen(true)}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
              >
                <Trash2 className="size-3.5" aria-hidden />
                {language === 'zh' ? '彻底删除' : 'Delete permanently'}
              </button>
            </div>
          </div>
        ) : null}
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
          onKeyDown={event => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              if (!titleComposingRef.current && !event.nativeEvent.isComposing) void flushPendingSave();
            }
            if (textSelection && event.altKey && event.key === 'Enter') {
              event.preventDefault();
              document.querySelector<HTMLButtonElement>('[data-note-selection-actions] button:not(:disabled)')?.focus();
            }
          }}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel"
        >
          {meeting ? <DiscussionNoteSections
            noteId={noteId}
            noteTitle={voiceTitleEditor}
            personalNotes={personalEditor}
            personalNotesActive={!showMeeting}
            onMeetingContent={() => {
              if (isPreviewingSnapshot) handleHistoryClose();
              setShowMeeting(true);
            }}
            onPersonalNotes={() => {
              handleHistoryClose();
              handleModeChange('wysiwyg');
              setShowMeeting(false);
            }}
            onPopulateNote={(markdown) => {
              handleHistoryClose();
              handleSave(markdown);
              setPopulatedGen((c) => c + 1);
              handleModeChange('wysiwyg');
              setShowMeeting(false);
            }}
            noteActions={{
              onAnalyze: handleBreakdownClick,
              chatOpen: assistantOpen,
              onChat: () => { if (assistantOpen) setAssistantOpen(false); else void handleOpenNoteChat(false); },
              onShare: () => { void handleShare(); },
              onHistory: () => {
                setAssistantOpen(false);
                if (activeSidePanel === 'history') handleHistoryClose();
                else setActiveSidePanel('history');
              },
              onDelete: () => {
                if (note.status === 'trashed') setDeleteConfirmOpen(true);
                else void handleStatusUpdate('trashed');
              },
              onOutline: hasOutline ? () => setOutlineOpen(true) : undefined,
              busy: deleting || saving || catalyzing || openingChat,
            }}
          /> : null}
          {!meeting ? personalEditor : null}
        </div>
      </div>

      {assistantOpen || assistantConversationId ? <aside id={`note-assistant-${noteId}`} aria-label={language === 'zh' ? '笔记 AI 对话' : 'Note AI chat'} className={cn('min-h-0 min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel', assistantOpen ? 'flex w-full @min-[56rem]/note:w-[22rem] @min-[76rem]/note:w-[24rem]' : 'hidden')}>
        <header className="flex shrink-0 items-center gap-2 border-b border-edge-subtle px-4 py-2"><MessageCircle className="size-4 text-accent-fg" aria-hidden /><h2 className="flex-1 text-sm font-medium">{meeting ? (language === 'zh' ? '问这段录音' : 'Ask about this recording') : (language === 'zh' ? 'AI 对话' : 'AI chat')}</h2><button type="button" className="inline-flex size-11 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" aria-label={language === 'zh' ? '收起 AI 对话' : 'Close AI chat'} onClick={() => { setAssistantOpen(false); window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-note-assistant-trigger], [aria-controls="note-assistant-${noteId}"]`)?.focus({ preventScroll: true })); }}><X className="size-4" /></button></header>
        {meeting && assistantOpen && assistantConversationId && meeting.transcript?.text?.trim() ? (
          <div className="flex shrink-0 flex-wrap gap-1 border-b border-edge-subtle px-4 py-1">
            {(language === 'zh' ? ['最后决定了什么？', '有哪些待跟进事项？'] : ['What was decided?', 'What needs follow-up?']).map(question => (
              <button key={question} type="button" className="min-h-11 rounded-lg px-2 text-xs text-fg-muted hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                onClick={() => setAssistantDraft({ id: Date.now(), text: question })}>{question}</button>
            ))}
          </div>
        ) : null}
        {actionError && assistantConversationId ? <p role="alert" className="shrink-0 px-4 py-2 text-xs text-danger">{actionError}</p> : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {assistantConversationId ? <Suspense fallback={<EditorFallback />}><NoteAssistantChat key={`${noteId}:${assistantConversationId}`} embedded sourceNoteInView conversationId={assistantConversationId} draftSeed={assistantDraft} beforeSend={beforeAssistantSend} /></Suspense> : openingChat ? <EditorFallback /> : <div className="space-y-3 p-4 text-sm"><p className="text-fg-muted">{actionError || (language === 'zh' ? '对话尚未打开，请重试。' : 'Chat could not be opened. Try again.')}</p><button type="button" className="min-h-11 rounded-lg px-3 text-accent-fg hover:bg-surface-hover" onClick={() => void handleOpenNoteChat()}>{language === 'zh' ? '重新打开' : 'Try again'}</button></div>}
        </div>
      </aside> : null}

      {/* Shared side panel — responsive full-width on mobile, animated resizable width on desktop */}
      <div
        ref={sidePanelShellRef}
        style={{ '--note-side-w': `${sidePanelWidth}px` } as React.CSSProperties}
        className={cn(
          'relative min-h-0 max-w-full shrink-0 flex-col overflow-hidden',
          activeSidePanel ? 'flex w-full @min-[56rem]/note:w-[var(--note-side-w)]' : 'hidden w-0',
          !historyResizing && 'transition-[width] duration-300 ease-in-out',
        )}
      >
        <div
          ref={sidePanelInnerRef}
          className="flex min-h-0 w-full flex-1 flex-col @min-[56rem]/note:w-[var(--note-side-w)]"
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
                sidePanelShellRef.current?.style.setProperty('--note-side-w', `${committedWidth}px`);
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
              'absolute left-0 top-0 z-10 hidden h-full w-2 -translate-x-1/2 cursor-col-resize @min-[56rem]/note:block',
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
    {conflictingNote ? <ConfirmDialog
      open
      title={n.saveConflictReview}
      contentClassName="flex h-[min(calc(100dvh-2rem),32rem)] flex-col overflow-hidden"
      descriptionClassName="min-h-0 max-h-none flex-1"
      description={`${n.saveConflictReviewHint}\n\n${conflictingNote.title ?? ''}\n\n${conflictingNote.markdown ?? ''}`}
      confirmLabel={n.saveConflictOverwrite}
      cancelLabel={n.deleteCancelLabel}
      onConfirm={() => {
        setConflictingNote(null);
        void flushPendingSave(conflictingNote.remoteVersion ?? 1);
      }}
      onCancel={() => setConflictingNote(null)}
    /> : null}
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
