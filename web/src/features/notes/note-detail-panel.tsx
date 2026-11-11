import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowLeft, Check, ChevronDown, Eye, Code2, FileText, History, MessageCircle, MoreHorizontal, Search, Share2, Sparkles, Trash2, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { SessionManager } from '@/features/chat/session/session-manager';
import { pageContextDrafts, pageContextDraftKey } from '@/features/chat/context/page-context-draft';
import { useGatewayStore } from '@/stores/gateway-store';

import type { EditorTextSelection } from '@/components/editor-text-selection';
import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AutomationSuggestionCard } from '@/features/automations/automation-suggestion-card';
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
import { NoteMarkdownView } from './note-markdown-view';
import { NoteBreakdownPanel } from './note-breakdown-panel';
import { NoteShareDialog } from './note-share-dialog';
import { NoteSelectionActions } from './note-selection-actions';
import { NoteReadAloudControls } from './note-read-aloud-controls';
import { buildNoteReadAloudText } from './note-read-aloud';

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
  const automationSuggestions = messages(language).automations.suggestions;
  const { data: meeting } = useSWR(['note-discussion-document', noteId], () => getDiscussionForNote(noteId));
  const [showMeeting, setShowMeeting] = useState(true);
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
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMarkdownRef = useRef<string | null>(null);
  const pendingTitleRef = useRef<string | null>(null);
  const pendingEditRevision = useRef<number | undefined>(undefined);
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
    setTitle('');
    setPreviewSnapshot(null);
    setActiveSidePanel(null);
    titleComposingRef.current = false;
    didAutoFocusRef.current = null;
  }, [noteId]);

  useEffect(() => {
    if (!note || saving || pendingTitleRef.current !== null || titleComposingRef.current) return;
    setTitle(note.title ?? '');
  }, [note, saving]);

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

  useEffect(() => {
    if (!saving && pendingMarkdownRef.current === null && pendingTitleRef.current === null) {
      pendingEditRevision.current = note?.remoteVersion ?? 1;
    }
  }, [noteId, note?.remoteVersion, saving]);
  const persistEditorPatch = useCallback(async (patch: Partial<Note>) => {
    const expected = pendingEditRevision.current ?? note?.remoteVersion ?? 1;
    const saved = await updateNote(noteId, patch, expected);
    if (pendingEditRevision.current === expected) pendingEditRevision.current = saved.remoteVersion ?? expected + 1;
    return saved;
  }, [noteId, note?.remoteVersion]);

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
          await persistEditorPatch({ title: nextTitle });
          await mutate();
          onSaved?.();
        } catch (err) {
          if (pendingTitleRef.current === null) pendingTitleRef.current = nextTitle;
          setActionError(`${n.saveFailed}: ${err instanceof Error ? err.message : n.saveFailedHint}`);
        } finally {
          setSaving(false);
        }
      }, 600);
    },
    [stopNoteReading, noteId, mutate, onSaved, persistEditorPatch, n.saveFailed, n.saveFailedHint],
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
      const saved = await persistEditorPatch(patch);
      await mutate(saved, { revalidate: false });
      onSaved?.();
      return saved;
    } catch (err) {
      if (pendingMarkdownRef.current === null) pendingMarkdownRef.current = markdown;
      if (pendingTitleRef.current === null) pendingTitleRef.current = pendingTitle;
      setActionError(`${n.saveFailed}: ${err instanceof Error ? err.message : n.saveFailedHint}`);
      return null;
    } finally {
      setSaving(false);
    }
  }, [mutate, n.saveFailed, n.saveFailedHint, note, onSaved, persistEditorPatch]);

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
          <span className="hidden sm:inline">{catalyzing ? n.catalyzing : n.catalyzeButton}</span>
        </button>
        <button
          type="button"
          onClick={() => handleOpenNoteChat(false)}
          aria-label={n.openChatButton}
          disabled={openingChat}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
            'border border-edge text-fg-muted hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <MessageCircle className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">{openingChat ? n.openingChat : n.openChatButton}</span>
        </button>
        <NoteDetailModeSwitcher
          mode={mode}
          onModeChange={handleModeChange}
          labels={{ edit: n.modeEdit, source: n.modeSource, preview: n.modePreview }}
        />
        <button type="button" onClick={() => void handleCaptureContext()} disabled={openingChat || saving || !note || Boolean(previewSnapshot)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
          <FileText className="size-3.5" aria-hidden />{contextLabels.capture}
        </button>
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
              className="z-50 min-w-40 rounded-xl border border-edge bg-surface-overlay p-1 shadow-popover"
            >
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
      handleCaptureContext,
      contextLabels.capture,
      note,
      previewSnapshot,
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
      main: note && !meeting ? headerMain : null,
      end: note && !meeting ? headerEnd : null,
    });
    return () => {
      if (clearHeaderOnCleanup) clearPageHeader();
    };
  }, [clearHeaderOnCleanup, clearPageHeader, headerEnd, headerMain, headerStart, meeting, showMeeting, note, setPageHeader]);

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
          await persistEditorPatch({ markdown });
          await mutate();
          onSaved?.();
        } catch (err) {
          if (pendingMarkdownRef.current === null) pendingMarkdownRef.current = markdown;
          setActionError(`${n.saveFailed}: ${err instanceof Error ? err.message : n.saveFailedHint}`);
        } finally {
          setSaving(false);
        }
      }, 600);
    },
    [stopNoteReading, noteId, mutate, n.saveFailed, n.saveFailedHint, onSaved, persistEditorPatch],
  );

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
        void updateNote(noteId, patch, pendingEditRevision.current).catch(() => undefined);
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

  const voiceTitle = /^Discussion · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(title) ? '' : title;
  const voiceTitleLabel = language === 'zh' ? '语音笔记' : 'Voice note';
  const voiceTitleEditor = !showMeeting && !isPreviewingSnapshot ? (
    <input
      ref={titleInputRef}
      aria-label={n.titlePlaceholder}
      value={voiceTitle}
      placeholder={voiceTitleLabel}
      onChange={event => handleTitleChange(event.target.value)}
      onCompositionStart={() => { titleComposingRef.current = true; }}
      onCompositionEnd={() => { titleComposingRef.current = false; }}
      className="w-full rounded-md bg-transparent text-2xl font-semibold leading-snug tracking-tight placeholder:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    />
  ) : null;

  const personalEditor = (
    <div className="flex h-full min-h-0 flex-col">
      {meeting ? <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 border-b border-edge-subtle px-4 py-1"><h3 className="text-sm font-medium">{language === 'zh' ? '我的笔记' : 'My notes'}</h3><NoteDetailModeSwitcher mode={mode} onModeChange={handleModeChange} labels={{ edit: n.modeEdit, source: n.modeSource, preview: n.modePreview }} /></div> : null}
          <div className="h-full min-h-0 min-w-0 flex-1">
            {isPreviewingSnapshot ? (
              <div className="h-full overflow-y-auto px-4 py-4 sm:px-6">
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
                    {!meeting ? <div className="flex shrink-0 items-start px-6 pt-4">
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
                    </div> : null}
                    <div className="min-h-0 flex-1">
                      <Suspense fallback={<EditorFallback />}>
                        <BlockEditor
                          key={`wysiwyg-${noteId}`}
                          autoFocus={!!meeting && !showMeeting}
                          placeholder={meeting ? (language === 'zh' ? '写点什么…' : 'Write a note…') : undefined}
                          initialContent={note.markdown ?? ''}
                          onChange={handleSave}
                          noteId={noteId}
                          onTextSelection={setTextSelection}
                        />
                      </Suspense>
                    </div>
                  </div>
                )}
                {mode === 'source' && (
                  <div className="flex h-full flex-col">
                    {!meeting ? <div className="flex shrink-0 items-start px-6 pt-4">
                      <input
                        ref={titleInputRef}
                        type="text"
                        value={title}
                        onChange={(e) => handleTitleChange(e.target.value)}
                        placeholder={n.titlePlaceholder}
                        className="min-w-0 flex-1 border-none bg-transparent text-2xl font-bold text-fg placeholder:text-fg-muted/40 focus:outline-none"
                      />
                      {titleAutomationSuggestion}
                    </div> : null}
                    <div className="min-h-0 flex-1">
                      <Suspense fallback={<EditorFallback />}>
                        <MarkdownEditor
                          key={`source-${noteId}`}
                          initialContent={note.markdown ?? ''}
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
                    className="h-full overflow-y-auto px-4 py-4 sm:px-6"
                    onClick={(event) => {
                      const target = event.target;
                      if (!(target instanceof HTMLImageElement)) return;
                      openImage(target.currentSrc || target.src, target.alt);
                    }}
                  >
                    {!meeting && title && !note.markdown.trimStart().startsWith(`# ${title.trim()}\n`) && note.markdown.trim() !== `# ${title.trim()}` && (
                      <h1 className="mb-4 text-2xl font-bold text-fg">{title}</h1>
                    )}
                    {note.markdown ? (
                      <NoteMarkdownView
                        noteId={noteId}
                        content={note.markdown}
                        className="[&_img]:cursor-zoom-in"
                      />
                    ) : (
                      meeting ? <button type="button" className="min-h-11 rounded-lg px-2 text-sm text-accent-fg hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" onClick={() => handleModeChange('wysiwyg')}>{language === 'zh' ? '写笔记' : 'Write notes'}</button> : <p className="italic text-fg-muted">{n.emptyPreview}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
    </div>
  );

  return (
    <>
    {textSelection && !isPreviewingSnapshot && !(meeting && showMeeting) && mode !== 'preview' ? <NoteSelectionActions key={`${noteId}:${mode}`} noteId={noteId} selection={textSelection} zh={language === 'zh'} onDismiss={dismissSelection} onAsk={text => { setAssistantDraft({ id: Date.now(), text: language === 'zh' ? `请帮我分析或改写下面这段笔记：\n\n${text}` : `Help me analyze or rewrite this note selection:\n\n${text}` }); dismissSelection(); void handleOpenNoteChat(); }} /> : null}
    <div className="@container/note flex h-full min-h-0 min-w-0 gap-3 p-3 sm:p-4">
      {/* Editor */}
      <div className={cn("mx-auto min-h-0 min-w-0 w-full flex-1 flex-col", (assistantOpen || activeSidePanel) ? "hidden @min-[56rem]/note:flex" : "flex", !meeting && "max-w-[60rem]")}>
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
          onKeyDown={event => {
            if (textSelection && event.altKey && event.key === 'Enter') {
              event.preventDefault();
              document.querySelector<HTMLButtonElement>('[data-note-selection-actions] button:not(:disabled)')?.focus();
            }
          }}
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel xl:flex-row"
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
              onDelete: () => setDeleteConfirmOpen(true),
              busy: deleting || saving || catalyzing || openingChat,
            }}
          /> : null}
          {!meeting ? personalEditor : null}
        </div>
      </div>

      {assistantOpen || assistantConversationId ? <aside id={`note-assistant-${noteId}`} aria-label={language === 'zh' ? '笔记 AI 对话' : 'Note AI chat'} className={cn('min-h-0 min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel', assistantOpen ? 'flex w-full @min-[56rem]/note:w-[22rem] @min-[76rem]/note:w-[24rem]' : 'hidden')}>
        <header className="flex shrink-0 items-center gap-2 border-b border-edge-subtle px-4 py-2"><MessageCircle className="size-4 text-accent-fg" aria-hidden /><h2 className="flex-1 text-sm font-medium">{meeting ? (language === 'zh' ? '问这段录音' : 'Ask about this recording') : (language === 'zh' ? 'AI 对话' : 'AI chat')}</h2><button type="button" className="inline-flex size-11 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" aria-label={language === 'zh' ? '收起 AI 对话' : 'Close AI chat'} onClick={() => { setAssistantOpen(false); window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[aria-controls="note-assistant-${noteId}"]`)?.focus({ preventScroll: true })); }}><X className="size-4" /></button></header>
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

      {/* Shared side panel — animated width */}
      <div
        ref={sidePanelShellRef}
        className={cn(
          'relative min-h-0 max-w-full shrink-0 flex-col overflow-hidden',
          activeSidePanel ? 'flex' : 'hidden',
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
