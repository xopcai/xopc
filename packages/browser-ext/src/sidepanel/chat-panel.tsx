import type { ClarificationSubmission } from '@xopcai/gateway-contract';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appendPageContext } from './composer-contexts';

import { classifyPastedText } from '@xopcai/composer-core/pasted-text';
import { ModelControls } from './model-controls';
import { VoiceInput } from './voice-input';
import { QueuedInput } from './queued-input';
import { findCommand, loadComposerCommands, matchesCommandQuery, type ComposerCommand } from './composer-commands';
import { ComposerPreviewDialog, type ComposerPreview } from './composer-preview';
import { AssistantActivity } from './assistant-activity';
import { messageText } from './chat-message-model';
import { MessageAttachmentChip } from './message-attachment-chip';

import { extensionLocale, t } from '../i18n';
import {
  BrowserChatClient,
  type BrowserChatSnapshot,
  type BrowserNextTurnSuggestion,
} from './chat-client';
import {
  activeTabId,
  activeTabSummary,
  captureTabWithPermission,
  PENDING_ACTION_KEY,
  PENDING_CONTEXT_KEY,
  type ActiveTabSummary,
  type AttachedPageContext,
  type CaptureMode,
  type PendingSidePanelAction,
} from './page-context';
import {
  captureVisibleScreenshot,
  fileToBrowserAttachment,
  MAX_BROWSER_ATTACHMENTS,
  BROWSER_ATTACHMENT_ACCEPT,
  type BrowserAttachment,
} from './attachments';
import {
  findTabMention,
  listMentionableTabs,
  removeTabMention,
  type MentionableTab,
  type TabMention,
} from './tab-mention';
import {
  AlertIcon,
  ArrowDownIcon,
  BotIcon,
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  CompressIcon,
  CopyIcon,
  CursorIcon,
  DownloadIcon,
  EditIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileIcon,
  PageIcon,
  PaperclipIcon,
  PinIcon,
  PlusIcon,
  RefreshIcon,
  RotateCcwIcon,
  SearchIcon,
  SelectionIcon,
  SendIcon,
  SparkleIcon,
  StopIcon,
  TranslateIcon,
  TrashIcon,
} from './icons';
import { EMPTY_DRAFT, useComposerDrafts } from './composer-drafts';
import { MarkdownContent } from './markdown-content';

const EMPTY: BrowserChatSnapshot = {
  connection: 'idle',
  endpointReady: false,
  sessionLoading: false,
  submitting: false,
  stopping: false,
  pendingDelivery: false,
  sessions: [],
  agents: [],
  selectedAgentId: 'main',
  messages: [],
  models: [],
};

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function formatMessageTime(timestamp?: number): string {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat(extensionLocale(), { hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

function formatSessionDate(timestamp?: string | number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return formatMessageTime(date.getTime());
  return new Intl.DateTimeFormat(extensionLocale(), { month: 'short', day: 'numeric' }).format(date);
}

function formatFileSize(size?: number): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}k`;
  return String(count);
}

function openConsoleTab(url: string): void {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    void chrome.tabs.create({ url }).catch(() => undefined);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function downloadMarkdownFile(title: string, content: string): void {
  const safeName = (title || 'xopc-chat')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'xopc-chat';
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeName}.md`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ChatPanel({ gatewayId, deviceId }: { gatewayId: string; deviceId: string }) {
  const client = useMemo(() => new BrowserChatClient(), []);
  const [snapshot, setSnapshot] = useState(EMPTY);
  const keyForSession = (conversationId?: string) => JSON.stringify([gatewayId, deviceId, conversationId ?? 'new']);
  const draftKey = keyForSession(snapshot.conversationId);
  const { store: drafts, draft: composerDraft, ready: draftReady, update: updateDraft } = useComposerDrafts(
    draftKey,
    cause => setError(errorMessage(cause)),
  );
  const draft = composerDraft.text;
  const attachments = composerDraft.attachments;
  const pageContexts = composerDraft.pages;
  const [preview, setPreview] = useState<ComposerPreview>();
  const setDraft = (text: string) => updateDraft(current => ({ ...current, text }));
  const setAttachments = (
    value: BrowserAttachment[] | ((current: BrowserAttachment[]) => BrowserAttachment[]),
  ) => updateDraft(current => ({
    ...current,
    attachments: typeof value === 'function' ? value(current.attachments) : value,
  }));
  function addPageContext(page: AttachedPageContext) {
    updateDraft(current => ({ ...current, pages: appendPageContext(current.pages, page) }));
  }

  const submittingRef = useRef(false);
  const composing = useRef(false);
  const historyWalk = useRef<{ items: string[]; index: number; draft: string } | undefined>(undefined);
  const acceptedSuggestionRef = useRef<BrowserNextTurnSuggestion | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [commands, setCommands] = useState<ComposerCommand[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [commandsFailed, setCommandsFailed] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const commandRange = commandsOpen ? findCommand(draft, cursor) : undefined;
  const commandItems = commandRange
    ? commands.filter(item => matchesCommandQuery(item, commandRange.query)).slice(0, 12)
    : [];

  const canSend = draftReady
    && !sending
    && !processing
    && !voiceBusy
    && !snapshot.submitting
    && !snapshot.pendingDelivery
    && !snapshot.sessionLoading
    && !snapshot.stopping
    && snapshot.endpointReady;

  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [renamingSession, setRenamingSession] = useState<{ key: string; title: string }>();
  const [deletingSessionKey, setDeletingSessionKey] = useState<string>();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [statusNotice, setStatusNotice] = useState('');
  const [error, setError] = useState('');
  const [screenshotFallbackError, setScreenshotFallbackError] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const [editingTurn, setEditingTurn] = useState<{ turnId: string; text: string }>();
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const [remoteFindTotal, setRemoteFindTotal] = useState<number>();
  const [activeTab, setActiveTab] = useState<ActiveTabSummary>();
  const [clarificationAnswer, setClarificationAnswer] = useState('');
  const [clarificationChoice, setClarificationChoice] = useState<string>();
  const [clarificationEditing, setClarificationEditing] = useState(false);
  useEffect(() => {
    setClarificationAnswer('');
    setClarificationChoice(undefined);
    setClarificationEditing(false);
  }, [snapshot.clarification?.id]);
  const [clarificationSubmitting, setClarificationSubmitting] = useState(false);
  const [tabMention, setTabMention] = useState<TabMention>();
  const [mentionTabs, setMentionTabs] = useState<MentionableTab[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const followingTail = useRef(true);
  const attachmentTask = useRef(false);
  const sessionMenu = useRef<HTMLDivElement>(null);
  const sessionTrigger = useRef<HTMLButtonElement>(null);
  const toolsMenu = useRef<HTMLDivElement>(null);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mentionRequest = useRef(0);
  const bindingRef = useRef(snapshot.tabBinding);
  bindingRef.current = snapshot.tabBinding;

  const showTransientStatus = useCallback((message: string) => {
    setStatusNotice(message);
    window.setTimeout(() => {
      setStatusNotice((current) => current === message ? '' : current);
    }, 2_600);
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    followingTail.current = true;
    setAtBottom(true);
    viewport.current?.scrollTo({
      top: viewport.current.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  const trackScrollPosition = useCallback(() => {
    const target = viewport.current;
    if (!target) return;
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 48;
    followingTail.current = isAtBottom;
    setAtBottom(isAtBottom);
  }, []);

  useEffect(() => {
    let active = true;
    let readyForPending = false;
    const appliedContexts = new Set<string>();
    const appliedActions = new Set<string>();
    const unsubscribe = client.subscribe(setSnapshot);
    const attachPending = async (pending: AttachedPageContext | undefined) => {
      if (!pending || !active || !readyForPending || appliedContexts.has(pending.context.sourceId)) return;
      appliedContexts.add(pending.context.sourceId);
      try {
        const key = keyForSession(client.currentConversationId);
        await drafts.load(key);
        if (!active) return;
        drafts.update(key, current => ({ ...current, pages: appendPageContext(current.pages, pending) }));
        await chrome.storage.session.remove(PENDING_CONTEXT_KEY);
      } catch (cause) {
        appliedContexts.delete(pending.context.sourceId);
        if (active) setError(errorMessage(cause));
      }
    };
    const applyPendingAction = async (pending: PendingSidePanelAction | undefined) => {
      if (!pending?.id || !active || !readyForPending || appliedActions.has(pending.id)) return;
      appliedActions.add(pending.id);
      try {
        const key = keyForSession(client.currentConversationId);
        await drafts.load(key);
        if (!active) return;
        drafts.update(key, current => ({
          ...current,
          ...(pending.prompt && !current.text.trim() ? { text: pending.prompt } : {}),
          ...(pending.attachment && current.attachments.length < MAX_BROWSER_ATTACHMENTS
            ? { attachments: [...current.attachments, pending.attachment] }
            : {}),
        }));
        await chrome.storage.session.remove(PENDING_ACTION_KEY);
        requestAnimationFrame(() => textarea.current?.focus());
      } catch (cause) {
        appliedActions.delete(pending.id);
        if (active) setError(errorMessage(cause));
      }
    };
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'session') return;
      void attachPending(changes[PENDING_CONTEXT_KEY]?.newValue as AttachedPageContext | undefined);
      void applyPendingAction(changes[PENDING_ACTION_KEY]?.newValue as PendingSidePanelAction | undefined);
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    void client.start().then(async () => {
      if (!active) return;
      readyForPending = true;
      const stored = await chrome.storage.session.get([PENDING_CONTEXT_KEY, PENDING_ACTION_KEY]);
      await attachPending(stored[PENDING_CONTEXT_KEY] as AttachedPageContext | undefined);
      await applyPendingAction(stored[PENDING_ACTION_KEY] as PendingSidePanelAction | undefined);
    }).catch((cause) => { if (active) setError(errorMessage(cause)); });
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(onStorageChanged);
      unsubscribe();
      client.stop();
    };
  }, [client]);

  useEffect(() => {
    let active = true;
    const refreshActiveTab = () => {
      void activeTabSummary().then((summary) => {
        if (active) setActiveTab(summary);
      }).catch(() => undefined);
    };
    refreshActiveTab();
    const onUpdated = (tabId: number, change: chrome.tabs.TabChangeInfo) => {
      if (change.url || change.status === 'loading') {
        drafts.invalidate(tabId);
      }
      if (change.url || change.title || change.status === 'complete') {
        refreshActiveTab();
      }
    };
    const onRemoved = (tabId: number) => {
      drafts.invalidate(tabId);
      refreshActiveTab();
    };
    const onActivated = () => refreshActiveTab();
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onActivated.addListener(onActivated);
    return () => {
      active = false;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, []);

  useEffect(() => {
    const invalidate = (tabId: number) => {
      const binding = bindingRef.current;
      if (binding && String(tabId) === binding.tabId) void client.unbindActiveTab();
    };
    const onUpdated = (tabId: number, change: chrome.tabs.TabChangeInfo) => {
      if (change.url) invalidate(tabId);
    };
    const onRemoved = (tabId: number) => invalidate(tabId);
    const onActivated = ({ tabId }: chrome.tabs.TabActiveInfo) => {
      const binding = bindingRef.current;
      if (binding && String(tabId) !== binding.tabId) void client.unbindActiveTab();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onActivated.addListener(onActivated);
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, [client]);

  useEffect(() => {
    if (followingTail.current) scrollToBottom();
  }, [scrollToBottom, snapshot.messages, snapshot.streamingMessage]);

  useEffect(() => {
    followingTail.current = true;
    setAtBottom(true);
    const frame = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(frame);
  }, [scrollToBottom, snapshot.conversationId]);

  useEffect(() => {
    const target = textarea.current;
    if (!target) return;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 144)}px`;
  }, [draft]);

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      const target = event.target as Node;
      if (!sessionMenu.current?.contains(target) && !sessionTrigger.current?.contains(target)) {
        setMenuOpen(false);
        setRenamingSession(undefined);
        setDeletingSessionKey(undefined);
        setConfirmingReset(false);
      }
      if (!toolsMenu.current?.contains(target) && !toolsTrigger.current?.contains(target)) setToolsOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFindOpen(true);
        requestAnimationFrame(() => {
          findInput.current?.focus();
          findInput.current?.select();
        });
        return;
      }
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setToolsOpen(false);
        setRenamingSession(undefined);
        setDeletingSessionKey(undefined);
        setConfirmingReset(false);
        setEditingTurn(undefined);
        setFindOpen(false);
      }
    }
    document.addEventListener('mousedown', closeMenus);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', closeMenus);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    historyWalk.current = undefined;
    acceptedSuggestionRef.current = undefined;
    mentionRequest.current += 1;
    setTabMention(undefined);
    setMentionTabs([]);
    setCommandsOpen(false);
    setPreview(undefined);
    setEditingTurn(undefined);
    setFindOpen(false);
    setFindQuery('');
    setFindIndex(0);
    setRemoteFindTotal(undefined);
    setError('');
    setConfirmingReset(false);
    if (!snapshot.conversationId || snapshot.isDraftSession || !snapshot.endpointReady) return;
    let active = true;
    const refresh = () => {
      if (active) void client.refreshInputs().catch(() => undefined);
    };
    refresh();
    const timer = setInterval(refresh, 3_000);
    return () => { active = false; clearInterval(timer); };
  }, [client, snapshot.conversationId, snapshot.isDraftSession, snapshot.endpointReady]);

  useEffect(() => {
    if (!commandsOpen) return;
    let active = true;
    setCommands([]);
    setCommandsLoading(true);
    setCommandsFailed(false);
    void loadComposerCommands(snapshot.conversationId)
      .then(items => { if (active) setCommands(items); })
      .catch(() => { if (active) setCommandsFailed(true); })
      .finally(() => { if (active) setCommandsLoading(false); });
    return () => { active = false; };
  }, [commandsOpen, snapshot.conversationId]);

  // In-chat search matches across loaded messages + optional server total when truncated
  const findMatches = useMemo(() => {
    const needle = findQuery.trim().toLowerCase();
    if (!findOpen || !needle) return [];
    return snapshot.messages
      .filter((message) => messageText(message).toLowerCase().includes(needle))
      .map((message) => message.id);
  }, [findOpen, findQuery, snapshot.messages]);

  const activeFindMessageId = findMatches.length > 0
    ? findMatches[((findIndex % findMatches.length) + findMatches.length) % findMatches.length]
    : undefined;

  useEffect(() => {
    setFindIndex(0);
  }, [findQuery]);

  useEffect(() => {
    if (!activeFindMessageId || !viewport.current) return;
    const node = Array.from(viewport.current.querySelectorAll<HTMLElement>('[data-message-id]'))
      .find((element) => element.dataset.messageId === activeFindMessageId);
    node?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [activeFindMessageId, findIndex]);

  useEffect(() => {
    const needle = findQuery.trim();
    if (!findOpen || !needle || !snapshot.hasMoreHistory || !client.findInSession) {
      setRemoteFindTotal(undefined);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void client.findInSession?.(needle).then((result) => {
        if (active) setRemoteFindTotal(result.total);
      }).catch(() => undefined);
    }, 220);
    return () => { active = false; clearTimeout(timer); };
  }, [client, findOpen, findQuery, snapshot.hasMoreHistory]);

  function chooseCommand(item: ComposerCommand) {
    if (!commandRange || item.disabled) return;
    const text = `${draft.slice(0, commandRange.start)}${item.wire}${draft.slice(commandRange.end)}`;
    setDraft(text);
    setCommandsOpen(false);
    const nextCursor = commandRange.start + item.wire.length;
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  async function submit(event: FormEvent, interrupt = false) {
    event.preventDefault();
    if (!canSend || submittingRef.current || composing.current || tabMention || commandRange || attachmentTask.current) return;
    const payload = drafts.get(draftKey);
    if (!payload.text.trim() && !payload.attachments.length) return;
    if (payload.pages.some(page => page.stale)) {
      setError(t('errorAttachedPageChanged'));
      return;
    }
    submittingRef.current = true;
    setSending(true);
    setError('');
    followingTail.current = true;
    setAtBottom(true);
    let targetKey = draftKey;
    try {
      if (!snapshot.conversationId) {
        await client.createSession();
        targetKey = keyForSession(client.currentConversationId!);
        drafts.update(targetKey, () => payload);
        drafts.update(draftKey, () => EMPTY_DRAFT);
      }
      if (interrupt && snapshot.runId) await client.abort();
      await client.send(payload.text, payload.pages.map(page => page.context), payload.attachments);
      if (acceptedSuggestionRef.current) {
        const accepted = acceptedSuggestionRef.current;
        acceptedSuggestionRef.current = undefined;
        client.sendSuggestionFeedback?.(accepted, 'submitted', payload.text.trim() !== accepted.prompt.trim());
      }
      historyWalk.current = undefined;
      drafts.update(targetKey, current => ({
        text: current.text === payload.text ? '' : current.text,
        attachments: current.attachments.filter(item => !payload.attachments.includes(item)),
        pages: current.pages.filter(page => !payload.pages.some(sent => sent.context.sourceId === page.context.sourceId)),
      }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      submittingRef.current = false;
      setSending(false);
    }
  }

  async function updateModelConfig(action: () => Promise<void>) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSending(true);
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    } finally {
      submittingRef.current = false;
      setSending(false);
    }
  }

  async function processAttachmentTask(operation: () => Promise<void>) {
    if (attachmentTask.current || submittingRef.current || !draftReady || snapshot.sessionLoading) return;
    attachmentTask.current = true;
    setProcessing(true);
    setError('');
    try {
      await operation();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      attachmentTask.current = false;
      setProcessing(false);
    }
  }

  async function addFiles(files: FileList | readonly File[] | null) {
    const incoming = Array.from(files ?? []);
    if (!incoming.length) return;
    await processAttachmentTask(async () => {
      const remaining = MAX_BROWSER_ATTACHMENTS - drafts.get(draftKey).attachments.length;
      const failures: string[] = [];
      if (incoming.length > remaining) failures.push(t('errorAttachmentLimit', String(MAX_BROWSER_ATTACHMENTS)));
      const added: BrowserAttachment[] = [];
      // Bound peak memory when encoding large files.
      for (const file of incoming.slice(0, remaining)) {
        try { added.push(await fileToBrowserAttachment(file)); }
        catch (cause) { failures.push(`${file.name}: ${errorMessage(cause)}`); }
      }
      setAttachments(current => [...current, ...added]);
      if (fileInput.current) fileInput.current.value = '';
      if (failures.length) setError(failures.join('\n'));
    });
  }

  async function addScreenshot() {
    await processAttachmentTask(async () => {
      if (drafts.get(draftKey).attachments.length >= MAX_BROWSER_ATTACHMENTS) {
        throw new Error(t('errorAttachmentLimit', String(MAX_BROWSER_ATTACHMENTS)));
      }
      const screenshot = await captureVisibleScreenshot();
      setAttachments(current => [...current, screenshot]);
    });
  }

  async function runControlAction(action: () => Promise<void>) {
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function runSessionAction(action: () => Promise<void>) {
    if (sessionBusy) return;
    setSessionBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSessionBusy(false);
    }
  }

  async function loadEarlierHistory() {
    const target = viewport.current;
    const prevScrollHeight = target?.scrollHeight ?? 0;
    const prevScrollTop = target?.scrollTop ?? 0;
    followingTail.current = false;
    setError('');
    try {
      const added = await client.loadEarlierMessages?.();
      if (added && target) {
        requestAnimationFrame(() => {
          const delta = target.scrollHeight - prevScrollHeight;
          target.scrollTop = prevScrollTop + Math.max(0, delta);
        });
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function replaceTurn(turnId: string, content: string) {
    if (!content.trim()) return;
    setError('');
    followingTail.current = true;
    setAtBottom(true);
    try {
      await client.replaceLatestTurn?.(turnId, content);
      setEditingTurn(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function handleDiscardPendingDelivery() {
    setError('');
    try {
      const restored = await client.discardPendingDelivery?.();
      if (restored && !draft.trim()) {
        setDraft(restored);
        requestAnimationFrame(() => textarea.current?.focus());
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function attachPage(mode: CaptureMode): Promise<boolean> {
    if (attachmentTask.current || submittingRef.current || !draftReady) return false;
    attachmentTask.current = true;
    setProcessing(true);
    setError('');
    setScreenshotFallbackError('');
    try {
      const tabId = await activeTabId();
      if (tabId === undefined) throw new Error(t('errorNoActivePage'));
      addPageContext({
        context: await captureTabWithPermission(tabId, mode),
        tabId,
        source: mode === 'selection' ? 'current_selection' : 'current_page',
      });
      return true;
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      setScreenshotFallbackError(mode === 'page' ? message : '');
      return false;
    } finally {
      attachmentTask.current = false;
      setProcessing(false);
    }
  }

  async function startQuickPrompt(prompt: string, mode?: CaptureMode) {
    if (mode && !await attachPage(mode)) return;
    setDraft(prompt);
    requestAnimationFrame(() => textarea.current?.focus());
  }

  async function copyMessage(messageId: string, text: string) {
    setError('');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      window.setTimeout(() => setCopiedMessageId((current) => current === messageId ? '' : current), 1600);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function refreshPageContext(pageContext: AttachedPageContext) {
    if (attachmentTask.current || submittingRef.current) return;
    attachmentTask.current = true;
    setProcessing(true);
    setError('');
    try {
      const mode = pageContext.context.selection ? 'selection' : 'page';
      const context = await captureTabWithPermission(pageContext.tabId, mode);
      addPageContext({ ...pageContext, context, stale: false });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      attachmentTask.current = false;
      setProcessing(false);
    }
  }

  async function updateTabMention(value: string, position: number) {
    setCursor(position);
    setCommandsOpen(Boolean(findCommand(value, position)));
    setCommandIndex(0);
    const requestId = ++mentionRequest.current;
    const mention = findTabMention(value, position);
    setTabMention(mention);
    setMentionIndex(0);
    if (!mention) {
      setMentionTabs([]);
      return;
    }
    try {
      const tabs = await listMentionableTabs(mention.query);
      if (requestId === mentionRequest.current) setMentionTabs(tabs);
    } catch (cause) {
      if (requestId === mentionRequest.current) {
        setTabMention(undefined);
        setMentionTabs([]);
        setError(errorMessage(cause));
      }
    }
  }

  async function chooseMentionedTab(tab: MentionableTab) {
    const mention = tabMention;
    if (!mention || attachmentTask.current || submittingRef.current) return;
    attachmentTask.current = true;
    setProcessing(true);
    mentionRequest.current += 1;
    setTabMention(undefined);
    setMentionTabs([]);
    setError('');
    try {
      const context = await captureTabWithPermission(tab.id, 'page');
      const nextDraft = removeTabMention(draft, mention);
      addPageContext({ context, tabId: tab.id, source: 'tab_mention' });
      setDraft(nextDraft);
      requestAnimationFrame(() => {
        textarea.current?.focus();
        textarea.current?.setSelectionRange(mention.start, mention.start);
      });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      attachmentTask.current = false;
      setProcessing(false);
    }
  }

  async function runSearch(value: string) {
    setSearch(value);
    await client.loadSessions(value).catch((cause) => setError(errorMessage(cause)));
  }

  async function respondToClarification(action: 'answer' | 'agent_decide' | 'cancel', submission?: ClarificationSubmission) {
    setClarificationSubmitting(true);
    setError('');
    try {
      await client.respondToClarification(action, submission);
      setClarificationAnswer('');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setClarificationSubmitting(false);
    }
  }

  function acceptSuggestion(suggestion: BrowserNextTurnSuggestion) {
    acceptedSuggestionRef.current = suggestion;
    client.sendSuggestionFeedback?.(suggestion, 'accepted');
    setDraft(suggestion.prompt);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      const length = suggestion.prompt.length;
      textarea.current?.setSelectionRange(length, length);
    });
  }

  const agents = snapshot.agents ?? [];
  const selectedAgentId = snapshot.selectedAgentId ?? 'main';
  const activeSession = snapshot.sessions.find((session) => session.key === snapshot.conversationId);
  const selectedModel = snapshot.models.find((model) => model.id === snapshot.modelConfig?.model);
  const contextWindow = selectedModel?.contextWindow;
  const totalTokens = activeSession?.totalTokens;
  const contextRatio = typeof totalTokens === 'number' && typeof contextWindow === 'number' && contextWindow > 0
    ? Math.min(1, totalTokens / contextWindow)
    : undefined;
  const consoleUrl = client.getConsoleUrl?.(snapshot.conversationId);
  const connectionText = snapshot.endpointReady
    ? t('ready')
    : snapshot.connection === 'connected'
      ? t('wakingUp')
      : snapshot.connection === 'connecting' || snapshot.connection === 'reconnecting'
        ? t('connecting')
        : t('offline');
  const connectionProblem = !snapshot.endpointReady
    && (snapshot.connection === 'error' || snapshot.connection === 'disconnected');
  const hasComposerContent = Boolean(draft.trim() || attachments.length > 0);
  const showSuggestion = Boolean(
    snapshot.nextTurnSuggestion
    && !draft.trim()
    && !snapshot.runId
    && !snapshot.submitting
    && !snapshot.clarification
    && snapshot.messages.length > 0,
  );
  const showAgentPicker = agents.length > 1
    && (!snapshot.conversationId || snapshot.isDraftSession)
    && snapshot.messages.length === 0
    && !snapshot.streamingMessage;

  const latestUserIndex = useMemo(() => {
    for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
      if (snapshot.messages[index].role === 'user') return index;
    }
    return -1;
  }, [snapshot.messages]);
  const latestUserMessage = latestUserIndex >= 0 ? snapshot.messages[latestUserIndex] : undefined;
  const latestAssistantIndex = useMemo(() => {
    for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
      if (snapshot.messages[index].role === 'assistant') return index;
    }
    return -1;
  }, [snapshot.messages]);
  const canReplaceLatestTurn = Boolean(
    latestUserMessage?.turnId
    && messageText(latestUserMessage).trim()
    && !snapshot.runId
    && !snapshot.submitting
    && !snapshot.pendingDelivery
    && snapshot.endpointReady,
  );
  const activeTabAttached = Boolean(
    activeTab && pageContexts.some((page) => page.tabId === activeTab.tabId && !page.stale),
  );
  const activeTabControlled = Boolean(
    activeTab && snapshot.tabBinding?.mode === 'act' && snapshot.tabBinding.tabId === String(activeTab.tabId),
  );

  return (
    <section className="chat">
      {preview ? <ComposerPreviewDialog preview={preview} onClose={() => setPreview(undefined)} /> : null}
      <div className="chat-toolbar">
        <button ref={sessionTrigger} className="session-trigger" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          <span className="session-trigger-copy">
            <span className="session-title">
              {activeSession?.pinned ? <PinIcon className="inline-pin-icon" /> : null}
              <span>{activeSession?.title ?? t('newChat')}</span>
            </span>
            <span className="session-status">
              <span className={`mini-status ${snapshot.endpointReady ? 'online' : ''}`} />
              {connectionText}
            </span>
          </span>
          <ChevronDownIcon className="icon-sm" />
        </button>
        <div className="toolbar-actions">
          {snapshot.messages.length > 0 ? (
            <button
              className={`icon-button subtle${findOpen ? ' active' : ''}`}
              type="button"
              aria-label={t('findInChat')}
              title={t('findInChat')}
              aria-pressed={findOpen}
              onClick={() => {
                setFindOpen((open) => {
                  const next = !open;
                  if (next) requestAnimationFrame(() => findInput.current?.focus());
                  return next;
                });
              }}
            >
              <SearchIcon />
            </button>
          ) : null}
          {consoleUrl ? (
            <button
              className="icon-button subtle"
              type="button"
              aria-label={t('openWebConsole')}
              title={t('openWebConsole')}
              onClick={() => openConsoleTab(consoleUrl)}
            >
              <ExternalLinkIcon />
            </button>
          ) : null}
          <button
            className="icon-button"
            type="button"
            aria-label={t('startNewChat')}
            title={t('newChat')}
            disabled={sending || snapshot.submitting || snapshot.sessionLoading}
            onClick={() => void runControlAction(() => client.createSession())}
          >
            <PlusIcon />
          </button>
        </div>
      </div>
      {findOpen ? (
        <div className="chat-find-bar" role="search" aria-label={t('findInChat')}>
          <SearchIcon className="find-icon" />
          <input
            ref={findInput}
            value={findQuery}
            placeholder={t('findInChatPlaceholder')}
            aria-label={t('findInChat')}
            onChange={(event) => setFindQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setFindOpen(false);
              } else if (event.key === 'Enter' && findMatches.length > 0) {
                event.preventDefault();
                setFindIndex((current) => current + (event.shiftKey ? -1 : 1));
              }
            }}
          />
          {findQuery.trim() ? (
            <span className="find-count">
              {findMatches.length > 0
                ? `${((findIndex % findMatches.length) + findMatches.length) % findMatches.length + 1}/${findMatches.length}${remoteFindTotal && remoteFindTotal > findMatches.length ? ` (${remoteFindTotal})` : ''}`
                : t('findNoMatches')}
            </span>
          ) : null}
          <button
            type="button"
            className="find-nav-btn"
            aria-label={t('findPreviousMatch')}
            disabled={findMatches.length === 0}
            onClick={() => setFindIndex((current) => current - 1)}
          >
            <ChevronUpIcon />
          </button>
          <button
            type="button"
            className="find-nav-btn"
            aria-label={t('findNextMatch')}
            disabled={findMatches.length === 0}
            onClick={() => setFindIndex((current) => current + 1)}
          >
            <ChevronDownIcon />
          </button>
          <button
            type="button"
            className="find-nav-btn"
            aria-label={t('closePreview')}
            onClick={() => setFindOpen(false)}
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}
      {menuOpen ? (
        <div className="session-menu" ref={sessionMenu}>
          <div className="session-menu-header">
            <strong>{t('recentChats')}</strong>
            <button
              type="button"
              aria-label={t('closeRecentChats')}
              onClick={() => {
                setMenuOpen(false);
                setRenamingSession(undefined);
                setDeletingSessionKey(undefined);
                setConfirmingReset(false);
              }}
            >
              <CloseIcon />
            </button>
          </div>
          <label className="session-search">
            <SearchIcon />
            <input
              value={search}
              onChange={(event) => void runSearch(event.target.value)}
              placeholder={t('searchChats')}
              autoFocus
            />
            {search ? (
              <button
                type="button"
                className="session-search-clear"
                aria-label={t('clearSearch')}
                onClick={() => void runSearch('')}
              >
                <CloseIcon />
              </button>
            ) : null}
          </label>
          <div className="session-list">
            {snapshot.sessions.map((session) => {
              const isCurrent = session.key === snapshot.conversationId;
              const isRenaming = renamingSession?.key === session.key;
              const isDeleting = deletingSessionKey === session.key;
              if (isRenaming) {
                return (
                  <div key={session.key} className="session-inline-editor">
                    <input
                      value={renamingSession.title}
                      disabled={sessionBusy}
                      aria-label={t('renameChat')}
                      autoFocus
                      onChange={(event) => setRenamingSession({ key: session.key, title: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setRenamingSession(undefined);
                        } else if (event.key === 'Enter' && renamingSession.title.trim()) {
                          event.preventDefault();
                          void runSessionAction(async () => {
                            await client.renameSession?.(session.key, renamingSession.title);
                            setRenamingSession(undefined);
                          });
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="session-inline-primary"
                      disabled={sessionBusy || !renamingSession.title.trim()}
                      onClick={() => void runSessionAction(async () => {
                        await client.renameSession?.(session.key, renamingSession.title);
                        setRenamingSession(undefined);
                      })}
                    >
                      {t('saveQueuedMessage')}
                    </button>
                    <button type="button" disabled={sessionBusy} onClick={() => setRenamingSession(undefined)}>
                      {t('cancelQueuedMessage')}
                    </button>
                  </div>
                );
              }
              if (isDeleting) {
                return (
                  <div key={session.key} className="session-inline-confirm" role="alert">
                    <span>{t('confirmDeleteChat')}</span>
                    <div className="session-inline-confirm-actions">
                      <button
                        type="button"
                        className="session-inline-danger"
                        disabled={sessionBusy}
                        onClick={() => void runSessionAction(async () => {
                          await client.deleteSession?.(session.key);
                          setDeletingSessionKey(undefined);
                        })}
                      >
                        {t('deleteChat')}
                      </button>
                      <button type="button" disabled={sessionBusy} onClick={() => setDeletingSessionKey(undefined)}>
                        {t('cancelQueuedMessage')}
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={session.key} className={`session-item${isCurrent ? ' active' : ''}`}>
                  <button
                    type="button"
                    className="session-item-main"
                    disabled={sending || snapshot.submitting || snapshot.sessionLoading || sessionBusy}
                    onClick={() => {
                      setMenuOpen(false);
                      void runControlAction(() => client.openSession(session.key));
                    }}
                  >
                    <span className="session-list-copy">
                      <span className="session-list-title">
                        {session.pinned ? <PinIcon className="session-pin-badge" /> : null}
                        <span>{session.title}</span>
                      </span>
                      <small>{formatSessionDate(session.updatedAt)}</small>
                    </span>
                    {isCurrent ? <CheckIcon className="session-active-check" /> : null}
                  </button>
                  <div className="session-item-actions">
                    <button
                      type="button"
                      aria-label={session.pinned ? t('unpinChat') : t('pinChat')}
                      title={session.pinned ? t('unpinChat') : t('pinChat')}
                      disabled={sessionBusy}
                      onClick={() => void runSessionAction(async () => {
                        await client.togglePinSession?.(session.key, Boolean(session.pinned));
                      })}
                    >
                      <PinIcon />
                    </button>
                    <button
                      type="button"
                      aria-label={t('renameChat')}
                      title={t('renameChat')}
                      disabled={sessionBusy}
                      onClick={() => {
                        setDeletingSessionKey(undefined);
                        setRenamingSession({ key: session.key, title: session.title });
                      }}
                    >
                      <EditIcon />
                    </button>
                    <button
                      type="button"
                      className="danger"
                      aria-label={t('deleteChat')}
                      title={t('deleteChat')}
                      disabled={sessionBusy}
                      onClick={() => {
                        setRenamingSession(undefined);
                        setDeletingSessionKey(session.key);
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              );
            })}
            {!snapshot.sessions.length ? <div className="session-list-empty">{t('noChatsFound')}</div> : null}
          </div>
          {snapshot.conversationId && !snapshot.isDraftSession && snapshot.messages.length > 0 ? (
            <div className="session-menu-footer">
              {typeof totalTokens === 'number' && totalTokens > 0 ? (
                <div className="context-usage-row">
                  <div className="context-usage-meta">
                    <span>{t('contextUsage')}</span>
                    <strong>
                      {formatTokenCount(totalTokens)}
                      {contextWindow ? ` / ${formatTokenCount(contextWindow)}` : ''}
                    </strong>
                  </div>
                  {contextRatio !== undefined ? (
                    <div className="context-usage-track">
                      <span
                        className={`context-usage-fill${contextRatio > 0.8 ? ' high' : ''}`}
                        style={{ width: `${Math.max(4, Math.round(contextRatio * 100))}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="session-footer-actions">
                <button
                  type="button"
                  className="session-footer-btn"
                  disabled={sessionBusy || Boolean(snapshot.runId)}
                  onClick={() => void runSessionAction(async () => {
                    const ok = await client.compactSession?.(snapshot.conversationId);
                    if (ok) {
                      setMenuOpen(false);
                      showTransientStatus(t('contextCompacted'));
                    }
                  })}
                >
                  <CompressIcon />
                  <span>{sessionBusy ? t('compactingContext') : t('compactContext')}</span>
                </button>
                <button
                  type="button"
                  className="session-footer-btn"
                  disabled={sessionBusy}
                  onClick={() => void runSessionAction(async () => {
                    const markdown = await client.exportSessionMarkdown?.(snapshot.conversationId);
                    if (markdown) {
                      downloadMarkdownFile(activeSession?.title ?? 'xopc-chat', markdown);
                      setMenuOpen(false);
                      showTransientStatus(t('exportedMarkdown'));
                    }
                  })}
                >
                  <DownloadIcon />
                  <span>{t('exportMarkdown')}</span>
                </button>
              </div>
              {confirmingReset ? (
                <div className="session-reset-confirm">
                  <span>{t('confirmResetChat')}</span>
                  <div>
                    <button
                      type="button"
                      className="session-inline-danger"
                      disabled={sessionBusy}
                      onClick={() => void runSessionAction(async () => {
                        await client.resetSession?.(snapshot.conversationId);
                        setConfirmingReset(false);
                        setMenuOpen(false);
                      })}
                    >
                      {t('resetChat')}
                    </button>
                    <button type="button" disabled={sessionBusy} onClick={() => setConfirmingReset(false)}>
                      {t('cancelQueuedMessage')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="session-reset-trigger"
                  disabled={sessionBusy || Boolean(snapshot.runId)}
                  onClick={() => setConfirmingReset(true)}
                >
                  <RotateCcwIcon />
                  <span>{t('resetChat')}</span>
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {connectionProblem ? (
        <div className="connection-banner" role="alert">
          <AlertIcon />
          <span>{snapshot.error || t('gatewayOffline')}</span>
          <button type="button" onClick={() => void runControlAction(() => client.reconnect())}>{t('reconnect')}</button>
        </div>
      ) : null}
      {statusNotice ? (
        <div className="status-toast" role="status" aria-live="polite">
          <CheckIcon />
          <span>{statusNotice}</span>
        </div>
      ) : null}
      <div className="messages-shell">
        <div className="messages" ref={viewport} onScroll={trackScrollPosition}>
          {snapshot.hasMoreHistory && !snapshot.sessionLoading ? (
            <div className="load-earlier-bar">
              <button
                type="button"
                className="load-earlier-button"
                disabled={snapshot.loadingMoreHistory}
                onClick={() => void loadEarlierHistory()}
              >
                {snapshot.loadingMoreHistory ? t('loadingEarlierMessages') : t('loadEarlierMessages')}
              </button>
            </div>
          ) : null}
          {snapshot.sessionLoading ? (
            <div className="message-skeleton" aria-label={t('loadingChat')}>
              <div className="skeleton-user"><span /></div>
              <div className="skeleton-assistant"><span /><span /><span /></div>
            </div>
          ) : null}
          {!snapshot.sessionLoading && !snapshot.messages.length && !snapshot.streamingMessage ? (
            <div className="empty-chat">
              <div className="empty-mark"><SparkleIcon /></div>
              <h1>{t('emptyChatTitle')}</h1>
              <p>{t('emptyChatDescription')}</p>
              {showAgentPicker ? (
                <div className="agent-picker" role="group" aria-label={t('selectAgent')}>
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      className={agent.id === selectedAgentId ? 'active' : ''}
                      aria-pressed={agent.id === selectedAgentId}
                      title={agent.description || agent.name}
                      onClick={() => void runControlAction(async () => {
                        await client.selectAgent?.(agent.id);
                      })}
                    >
                      <BotIcon />
                      <span>{agent.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="quick-prompts">
                <button type="button" onClick={() => void startQuickPrompt(t('promptSummarizePage'), 'page')}>
                  <span className="quick-prompt-icon"><PageIcon /></span>
                  <span className="quick-prompt-copy">
                    <strong>{t('summarizePage')}</strong>
                    <small>{t('quickPromptSummarizeHint')}</small>
                  </span>
                </button>
                <button type="button" onClick={() => void startQuickPrompt(t('promptExplainSelection'), 'selection')}>
                  <span className="quick-prompt-icon"><SelectionIcon /></span>
                  <span className="quick-prompt-copy">
                    <strong>{t('explainSelection')}</strong>
                    <small>{t('quickPromptSelectionHint')}</small>
                  </span>
                </button>
                <button type="button" onClick={() => void startQuickPrompt(t('promptExtractInsights'), 'page')}>
                  <span className="quick-prompt-icon"><TranslateIcon /></span>
                  <span className="quick-prompt-copy">
                    <strong>{t('extractInsights')}</strong>
                    <small>{t('quickPromptExtractHint')}</small>
                  </span>
                </button>
                <button type="button" onClick={() => void startQuickPrompt(t('promptHelpTask'))}>
                  <span className="quick-prompt-icon"><CursorIcon /></span>
                  <span className="quick-prompt-copy">
                    <strong>{t('helpWithTask')}</strong>
                    <small>{t('quickPromptTaskHint')}</small>
                  </span>
                </button>
              </div>
            </div>
          ) : null}
          {snapshot.messages.map((message, messageIndex) => {
            const text = messageText(message);
            const isFindMatch = findMatches.includes(message.id);
            const isActiveFind = activeFindMessageId === message.id;
            const isLatestUser = messageIndex === latestUserIndex;
            const isLatestAssistant = messageIndex === latestAssistantIndex && latestAssistantIndex > latestUserIndex;
            const isEditingThis = Boolean(editingTurn && message.turnId && editingTurn.turnId === message.turnId);
            return (
              <article
                key={message.id}
                data-message-id={message.id}
                className={`message ${message.role}${isFindMatch ? ' find-match' : ''}${isActiveFind ? ' find-match-active' : ''}`}
              >
                <div className="message-heading">
                  {message.role === 'assistant' ? <span className="message-avatar"><SparkleIcon /></span> : null}
                  <span className="message-author">
                    {message.role === 'user' ? t('you') : message.role === 'assistant' ? 'xopc' : t('system')}
                  </span>
                  {formatMessageTime(message.timestamp) ? <time>{formatMessageTime(message.timestamp)}</time> : null}
                </div>
                <div className="message-body">
                  {message.sourceContexts?.length ? (
                    <div className="message-sources">
                      {message.sourceContexts.map((source, index) => (
                        <span className="source-badge" key={`${source.title}-${index}`} title={source.url}>
                          {source.kind === 'browser_page' ? <PageIcon /> : <FileIcon />}
                          <span>{source.title}{source.truncated ? ` · ${t('truncated')}` : ''}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {message.attachments?.length ? (
                    <div className="message-attachments">
                      {message.attachments.map((attachment, index) => (
                        <MessageAttachmentChip
                          key={`${attachment.name}-${index}`}
                          attachment={attachment}
                          hasPreview={Boolean(client.hasAttachmentPreview?.(message.id, index))}
                          loadPreview={client.loadAttachmentPreview
                            ? () => client.loadAttachmentPreview(message.id, index)
                            : undefined}
                          onPreview={(title, image) => setPreview({ title, image })}
                        />
                      ))}
                    </div>
                  ) : null}
                  {message.role === 'assistant' ? (
                    <AssistantActivity message={message} detail={snapshot.modelConfig?.activityDetail ?? 'on'} streaming={false} />
                  ) : null}
                  {isEditingThis && editingTurn ? (
                    <div className="turn-edit-box">
                      <textarea
                        value={editingTurn.text}
                        rows={3}
                        autoFocus
                        aria-label={t('editAndResend')}
                        onChange={(event) => setEditingTurn({ ...editingTurn, text: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            setEditingTurn(undefined);
                          } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && editingTurn.text.trim()) {
                            event.preventDefault();
                            void replaceTurn(editingTurn.turnId, editingTurn.text);
                          }
                        }}
                      />
                      <div className="turn-edit-actions">
                        <button
                          type="button"
                          className="session-inline-primary"
                          disabled={snapshot.submitting || !editingTurn.text.trim()}
                          onClick={() => void replaceTurn(editingTurn.turnId, editingTurn.text)}
                        >
                          {t('send')}
                        </button>
                        <button type="button" onClick={() => setEditingTurn(undefined)}>
                          {t('cancelQueuedMessage')}
                        </button>
                      </div>
                    </div>
                  ) : text ? (
                    message.role === 'assistant'
                      ? <MarkdownContent>{text}</MarkdownContent>
                      : <div className="plain-message-content">{text}</div>
                  ) : null}
                </div>
                {(message.role === 'assistant' || message.role === 'user') && text && !isEditingThis ? (
                  <div className={`message-actions${message.role === 'user' ? ' user-actions' : ''}`}>
                    <button
                      type="button"
                      aria-label={t('copyResponse')}
                      title={t('copyResponse')}
                      onClick={() => void copyMessage(message.id, text)}
                    >
                      {copiedMessageId === message.id ? <CheckIcon /> : <CopyIcon />}
                      <span>{copiedMessageId === message.id ? t('copied') : t('copy')}</span>
                    </button>
                    {isLatestUser && canReplaceLatestTurn && message.turnId ? (
                      <button
                        type="button"
                        aria-label={t('editAndResend')}
                        title={t('editAndResend')}
                        onClick={() => setEditingTurn({ turnId: message.turnId!, text })}
                      >
                        <EditIcon />
                        <span>{t('editAndResend')}</span>
                      </button>
                    ) : null}
                    {isLatestAssistant && canReplaceLatestTurn && latestUserMessage?.turnId ? (
                      <button
                        type="button"
                        aria-label={t('regenerateResponse')}
                        title={t('regenerateResponse')}
                        onClick={() => void replaceTurn(latestUserMessage.turnId!, messageText(latestUserMessage))}
                      >
                        <RefreshIcon />
                        <span>{t('regenerateResponse')}</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
          {snapshot.streamingMessage ? (
            <article className="message assistant streaming">
              <div className="message-heading">
                <span className="message-avatar"><SparkleIcon /></span>
                <span className="message-author">xopc</span>
                <span className="responding-label">{t('responding')}</span>
              </div>
              <div className="message-body">
                <AssistantActivity message={snapshot.streamingMessage} detail={snapshot.modelConfig?.activityDetail ?? 'on'} streaming />
                {messageText(snapshot.streamingMessage) ? (
                  <MarkdownContent streaming>{messageText(snapshot.streamingMessage)}</MarkdownContent>
                ) : null}
              </div>
            </article>
          ) : null}
        </div>
        {!atBottom ? (
          <button
            className="scroll-bottom-button"
            type="button"
            aria-label={t('scrollLatest')}
            title={t('scrollLatest')}
            onClick={() => scrollToBottom(true)}
          >
            <ArrowDownIcon />
          </button>
        ) : null}
      </div>
      {showSuggestion && snapshot.nextTurnSuggestion ? (
        <div className="suggestion-bar">
          <button
            type="button"
            className="suggestion-chip"
            onClick={() => acceptSuggestion(snapshot.nextTurnSuggestion!)}
          >
            <SparkleIcon />
            <span>{snapshot.nextTurnSuggestion.prompt}</span>
          </button>
          <button
            type="button"
            className="suggestion-dismiss"
            aria-label={t('dismissSuggestion')}
            title={t('dismissSuggestion')}
            onClick={() => client.dismissNextTurnSuggestion?.()}
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}
      {activeTab && !snapshot.clarification ? (
        <div className="active-tab-bar" aria-label={activeTab.title}>
          <PageIcon className="active-tab-icon" />
          <span className="active-tab-copy" title={`${activeTab.title} (${activeTab.url})`}>
            <strong>{activeTab.hostname}</strong>
            <span>{activeTab.title}</span>
          </span>
          <div className="active-tab-actions">
            <button
              type="button"
              className={`active-tab-btn${activeTabAttached ? ' attached' : ''}`}
              disabled={!draftReady || processing || sending || snapshot.sessionLoading}
              onClick={() => void attachPage('page')}
            >
              {activeTabAttached ? <CheckIcon /> : <PlusIcon />}
              <span>{activeTabAttached ? t('attachedTabShort') : t('attachTabShort')}</span>
            </button>
            <button
              type="button"
              className={`active-tab-btn${activeTabControlled ? ' controlled' : ''}`}
              disabled={!snapshot.endpointReady || !snapshot.conversationId}
              onClick={() => void runControlAction(() => (
                activeTabControlled ? client.unbindActiveTab() : client.bindActiveTab('act')
              ))}
            >
              <CursorIcon />
              <span>{t('controlTabShort')}</span>
            </button>
          </div>
        </div>
      ) : null}
      <form
        className={`composer${draggingFiles ? ' dragging' : ''}`}
        onSubmit={submit}
        onKeyDown={event => {
          if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
        }}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes('Files')) setDraggingFiles(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDraggingFiles(true);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setDraggingFiles(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          setDraggingFiles(false);
          void addFiles(event.dataTransfer.files);
        }}
      >
        {draggingFiles ? <div className="file-drop-overlay"><PaperclipIcon /><span>{t('dropFiles')}</span></div> : null}
        {snapshot.clarification ? (
          <section className="request-card" aria-label={t('agentQuestion')}>
            <div className="request-card-title">
              <SparkleIcon />
              <strong>{snapshot.clarification.kind === 'approval' ? t('approvalRequired') : t('xopcNeedsInput')}</strong>
            </div>
            <p className="request-question">{snapshot.clarification.question}</p>
            {snapshot.clarification.kind === 'approval' ? (
              <div className="request-approval">
                {snapshot.clarification.approval?.operation || snapshot.clarification.approval?.target || snapshot.clarification.approval?.impact ? (
                  <div className="request-meta-list">
                    {snapshot.clarification.approval?.operation ? (
                      <div className="request-meta-row"><strong>{snapshot.clarification.approval.operation}</strong></div>
                    ) : null}
                    {snapshot.clarification.approval?.target ? (
                      <div className="request-meta-row muted">{snapshot.clarification.approval.target}</div>
                    ) : null}
                    {snapshot.clarification.approval?.impact ? (
                      <div className="request-meta-row warning-text">{snapshot.clarification.approval.impact}</div>
                    ) : null}
                  </div>
                ) : null}
                {snapshot.clarification.approval?.argumentsPreview ? (
                  <pre className="request-code">{JSON.stringify(snapshot.clarification.approval.argumentsPreview, null, 2)}</pre>
                ) : null}
                <div className="request-actions">
                  <button
                    type="button"
                    className="request-danger"
                    disabled={clarificationSubmitting}
                    onClick={() => void respondToClarification('answer', { decision: 'deny' })}
                  >
                    {t('clarifyDeny')}
                  </button>
                  <button
                    type="button"
                    className="request-primary"
                    disabled={clarificationSubmitting}
                    onClick={() => void respondToClarification('answer', { decision: 'approve' })}
                  >
                    {t('clarifyApprove')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="request-input-body">
                {snapshot.clarification.choiceDetails?.length ? (
                  <>
                    <div className="choice-list">
                      {snapshot.clarification.choiceDetails.map(choice => {
                        const selected = clarificationChoice === choice.id;
                        const recommended = snapshot.clarification?.recommendedChoiceId === choice.id;
                        return (
                          <button
                            key={choice.id}
                            type="button"
                            className={`choice-button${selected ? ' selected' : ''}`}
                            disabled={clarificationSubmitting}
                            aria-pressed={selected}
                            onClick={() => {
                              if (snapshot.clarification?.interactionMode === 'compose' || clarificationEditing || clarificationAnswer) {
                                setClarificationChoice(choice.id);
                              } else {
                                void respondToClarification('answer', { response: { choiceId: choice.id } });
                              }
                            }}
                          >
                            <span className="choice-title">
                              {choice.label}
                              {recommended ? <span className="choice-recommended"> · {t('clarifyRecommended')}</span> : null}
                            </span>
                            {choice.description ? <small>{choice.description}</small> : null}
                          </button>
                        );
                      })}
                    </div>
                    <div className="choice-toolbar">
                      <button type="button" className="request-ghost" disabled={clarificationSubmitting} onClick={() => setClarificationEditing(true)}>
                        {t('clarifyCompose')}
                      </button>
                      {clarificationChoice ? (
                        <button type="button" className="request-ghost" onClick={() => setClarificationChoice(undefined)}>
                          {t('clarifyClear')}
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}
                <label className="request-answer-field">
                  <span>{t('typeAnswer')}</span>
                  <textarea
                    value={clarificationAnswer}
                    rows={2}
                    disabled={clarificationSubmitting}
                    onChange={event => {
                      setClarificationAnswer(event.target.value);
                      if (event.target.value) setClarificationEditing(true);
                    }}
                    onKeyDown={event => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter'
                        && !clarificationSubmitting
                        && clarificationAnswer.trim().length <= 8000
                        && (clarificationChoice || clarificationAnswer.trim())) {
                        event.preventDefault();
                        void respondToClarification('answer', {
                          response: { choiceId: clarificationChoice, text: clarificationAnswer.trim() || undefined },
                        });
                      }
                    }}
                  />
                </label>
                <div className="request-actions">
                  <button
                    type="button"
                    className="request-primary"
                    disabled={clarificationSubmitting || clarificationAnswer.trim().length > 8000 || (!clarificationChoice && !clarificationAnswer.trim())}
                    onClick={() => void respondToClarification('answer', {
                      response: { choiceId: clarificationChoice, text: clarificationAnswer.trim() || undefined },
                    })}
                  >
                    {t('send')}
                  </button>
                  <button type="button" disabled={clarificationSubmitting} onClick={() => void respondToClarification('agent_decide')}>
                    {t('letXopcDecide')}
                  </button>
                  <button type="button" className="request-ghost" disabled={clarificationSubmitting} onClick={() => void respondToClarification('cancel')}>
                    {t('cancelTask')}
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}
        {processing ? <div className="composer-notice" role="status">{t('processingAttachments')}</div> : null}
        {snapshot.queuedInputs?.map(input => (
          <QueuedInput
            key={`${snapshot.conversationId}:${input.id}`}
            input={input}
            onSave={(content, version) => client.editInput(input.id, version, content)}
            onCancel={() => client.cancelInput(input.id, input.version)}
          />
        ))}
        {snapshot.pendingDelivery ? (
          <div className="composer-notice pending-delivery-notice" role="status">
            <span>{t('queuedMessageNotice')}</span>
            <div className="pending-delivery-actions">
              <button
                type="button"
                disabled={!snapshot.endpointReady}
                onClick={() => void runControlAction(async () => {
                  await client.retryPendingDelivery?.();
                })}
              >
                {t('retryNow')}
              </button>
              <button type="button" onClick={() => void handleDiscardPendingDelivery()}>
                {t('discardQueuedMessage')}
              </button>
            </div>
          </div>
        ) : null}
        {error || (!connectionProblem && snapshot.error) ? (
          <div className="composer-error" role="alert">
            <AlertIcon />
            <span>{error || snapshot.error}</span>
            {error && error === screenshotFallbackError ? (
              <button
                type="button"
                className="composer-error-action"
                disabled={processing}
                onClick={() => {
                  setScreenshotFallbackError('');
                  void addScreenshot();
                }}
              >
                {t('attachScreenshotInstead')}
              </button>
            ) : null}
            {!error && snapshot.error && canReplaceLatestTurn && latestUserMessage?.turnId ? (
              <button
                type="button"
                className="composer-error-action"
                onClick={() => void replaceTurn(latestUserMessage.turnId!, messageText(latestUserMessage))}
              >
                {t('retryNow')}
              </button>
            ) : null}
            {error ? (
              <button
                type="button"
                className="composer-error-dismiss"
                aria-label={t('closePreview')}
                onClick={() => {
                  setError('');
                  setScreenshotFallbackError('');
                }}
              >
                <CloseIcon />
              </button>
            ) : null}
          </div>
        ) : null}
        {pageContexts.length || attachments.length ? (
          <div className="composer-contexts">
            {pageContexts.map(pageContext => (
              <div key={pageContext.context.sourceId} className={`context-chip${pageContext.stale ? ' stale' : ''}`}>
                {pageContext.context.selection ? <SelectionIcon /> : <PageIcon />}
                <span>
                  <strong>{pageContext.source === 'tab_mention' ? t('tab') : pageContext.context.selection ? t('selection') : t('page')}</strong>
                  {' · '}{new URL(pageContext.context.url).hostname} · {pageContext.context.title}
                </span>
                <button
                  type="button"
                  onClick={() => setPreview({
                    title: pageContext.context.title,
                    text: `${pageContext.context.url}\n\n${pageContext.context.selection ?? pageContext.context.text ?? ''}`,
                  })}
                >
                  {t('preview')}
                </button>
                {pageContext.context.truncated ? <small>{t('truncated')}</small> : null}
                {pageContext.stale ? (
                  <button type="button" disabled={processing} onClick={() => void refreshPageContext(pageContext)}>
                    {t('refresh')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="chip-remove"
                  aria-label={t('removePageContext')}
                  onClick={() => updateDraft(current => ({
                    ...current,
                    pages: current.pages.filter(page => page.context.sourceId !== pageContext.context.sourceId),
                  }))}
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
            {attachments.map((attachment, index) => (
              <div className="attachment-chip" key={`${attachment.name}-${index}`}>
                {attachment.type === 'image' ? (
                  <button
                    type="button"
                    className="attachment-thumbnail"
                    aria-label={t('preview')}
                    onClick={() => setPreview({ title: attachment.name, image: `data:${attachment.mimeType};base64,${attachment.data}` })}
                  >
                    <img src={`data:${attachment.mimeType};base64,${attachment.data}`} alt={attachment.name} />
                  </button>
                ) : <FileIcon />}
                <span>
                  <strong>{attachment.type === 'image' ? t('image') : t('file')}</strong>
                  {' · '}{attachment.name} · {formatFileSize(attachment.size)}
                </span>
                <button
                  type="button"
                  className="chip-remove"
                  aria-label={t('removeAttachment', attachment.name)}
                  onClick={() => setAttachments((current) => current.filter((_, candidate) => candidate !== index))}
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <input
          ref={fileInput}
          className="file-input"
          type="file"
          multiple
          accept={BROWSER_ATTACHMENT_ACCEPT}
          onChange={(event) => void addFiles(event.target.files)}
        />
        {tabMention ? (
          <div className="tab-mention-menu" role="listbox" aria-label={t('openTabs')}>
            {mentionTabs.length ? mentionTabs.map((tab, index) => (
              <button
                key={tab.id}
                type="button"
                role="option"
                aria-selected={index === mentionIndex}
                className={index === mentionIndex ? 'selected' : ''}
                onMouseDown={(event) => {
                  event.preventDefault();
                  void chooseMentionedTab(tab);
                }}
              >
                <span>{tab.title}</span>
                <small>{tab.hostname}{tab.active ? ` · ${t('currentTab')}` : ''}</small>
              </button>
            )) : <div className="tab-mention-empty">{t('noMatchingTabs')}</div>}
          </div>
        ) : null}
        {commandRange ? (
          <div className="tab-mention-menu" role="listbox" aria-label={t('commandsAndSkills')}>
            {commandsLoading ? (
              <div className="message-skeleton compact" aria-label={t('loadingCommands')}><span /><span /><span /></div>
            ) : commandItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === commandIndex}
                disabled={item.disabled}
                title={item.disabled ? t('skillUnavailable') : item.description}
                className={index === commandIndex ? 'selected' : ''}
                onMouseDown={event => {
                  event.preventDefault();
                  chooseCommand(item);
                }}
              >
                <span>{item.name}</span>
                <small>{item.description}{item.disabled ? ` · ${t('skillUnavailable')}` : ''}</small>
              </button>
            ))}
            {!commandsLoading && !commandItems.length ? (
              <div className="tab-mention-empty">{t(commandsFailed ? 'commandsLoadFailed' : 'noMatchingCommands')}</div>
            ) : null}
          </div>
        ) : null}
        <div className="composer-input-row">
          <textarea
            ref={textarea}
            value={draft}
            onChange={(event) => {
              historyWalk.current = undefined;
              setDraft(event.target.value);
              void updateTabMention(event.target.value, event.target.selectionStart);
            }}
            onSelect={(event) => void updateTabMention(event.currentTarget.value, event.currentTarget.selectionStart)}
            onPaste={(event) => {
              if (event.clipboardData.files.length) {
                event.preventDefault();
                void addFiles(event.clipboardData.files);
                return;
              }
              const pasted = classifyPastedText(event.clipboardData.getData('text/plain'));
              if (pasted) {
                event.preventDefault();
                void addFiles([new File([pasted.text], pasted.name, { type: pasted.mimeType })]);
              }
            }}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={(event) => {
              if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (commandRange) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  if (commandItems.length) {
                    setCommandIndex(current => (current + (event.key === 'ArrowDown' ? 1 : -1) + commandItems.length) % commandItems.length);
                  }
                  return;
                }
                if (event.key === 'Escape') { event.preventDefault(); setCommandsOpen(false); return; }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  if (commandItems[commandIndex]) chooseCommand(commandItems[commandIndex]);
                  return;
                }
              }
              if (tabMention) {
                if (event.key === 'ArrowDown' && mentionTabs.length) {
                  event.preventDefault();
                  setMentionIndex((current) => (current + 1) % mentionTabs.length);
                  return;
                }
                if (event.key === 'ArrowUp' && mentionTabs.length) {
                  event.preventDefault();
                  setMentionIndex((current) => (current - 1 + mentionTabs.length) % mentionTabs.length);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  mentionRequest.current += 1;
                  setTabMention(undefined);
                  setMentionTabs([]);
                  return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const selectedTab = mentionTabs[mentionIndex];
                  if (selectedTab) void chooseMentionedTab(selectedTab);
                  return;
                }
              }
              if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                const input = event.currentTarget;
                const walk = historyWalk.current;
                if (walk || (event.key === 'ArrowUp' && input.selectionStart === 0 && input.selectionEnd === 0)) {
                  const history = walk ?? {
                    items: snapshot.messages.filter(message => message.role === 'user' && messageText(message).trim()).map(messageText).reverse(),
                    index: -1,
                    draft,
                  };
                  const index = event.key === 'ArrowUp' ? Math.min(history.index + 1, history.items.length - 1) : history.index - 1;
                  if (index >= 0 || walk) {
                    event.preventDefault();
                    historyWalk.current = index >= 0 ? { ...history, index } : undefined;
                    setDraft(index >= 0 ? history.items[index] : history.draft);
                    requestAnimationFrame(() => textarea.current?.setSelectionRange(0, 0));
                    return;
                  }
                }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if ((event.ctrlKey || event.metaKey) && snapshot.runId) void submit(event, true);
                else event.currentTarget.form?.requestSubmit();
              }
            }}
            onBlur={() => {
              setCommandsOpen(false);
              mentionRequest.current += 1;
              setTabMention(undefined);
              setMentionTabs([]);
            }}
            placeholder={t('composerPlaceholder')}
            disabled={!draftReady || sending || snapshot.submitting || snapshot.sessionLoading || processing}
            rows={1}
          />
        </div>
        <div className="composer-footer">
          <div className="composer-toolbar-start">
            <div className="tools-anchor">
              <button
                ref={toolsTrigger}
                type="button"
                className={`composer-icon-button${toolsOpen ? ' active' : ''}`}
                aria-label={t('addContext')}
                aria-expanded={toolsOpen}
                onClick={() => setToolsOpen((open) => !open)}
              >
                <PlusIcon />
              </button>
              {toolsOpen ? (
                <div className="tools-menu" ref={toolsMenu}>
                  <div className="tools-menu-section">
                    <span className="tools-menu-label">{t('addToMessage')}</span>
                    <button type="button" onClick={() => { setToolsOpen(false); void attachPage('page'); }}>
                      <PageIcon /><span><strong>{t('currentPage')}</strong><small>{t('sharePageContent')}</small></span>
                    </button>
                    <button type="button" onClick={() => { setToolsOpen(false); void attachPage('selection'); }}>
                      <SelectionIcon /><span><strong>{t('selectedText')}</strong><small>{t('shareSelection')}</small></span>
                    </button>
                    <button type="button" onClick={() => { setToolsOpen(false); void addScreenshot(); }}>
                      <CameraIcon /><span><strong>{t('screenshot')}</strong><small>{t('captureVisibleTab')}</small></span>
                    </button>
                    <button type="button" onClick={() => { setToolsOpen(false); fileInput.current?.click(); }}>
                      <FileIcon /><span><strong>{t('file')}</strong><small>{t('supportedFileTypes')}</small></span>
                    </button>
                  </div>
                  <div className="tools-menu-section tab-access-section">
                    <span className="tools-menu-label">{t('liveTabAccess')}</span>
                    {snapshot.tabBinding?.mode === 'act' ? (
                      <button
                        type="button"
                        className="active-access"
                        onClick={() => { setToolsOpen(false); void runControlAction(() => client.unbindActiveTab()); }}
                      >
                        <CursorIcon /><span><strong>{t('controlEnabled')}</strong><small>{t('stopAccess')}</small></span><CloseIcon />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setToolsOpen(false); void runControlAction(() => client.bindActiveTab('act')); }}
                      >
                        <CursorIcon /><span><strong>{t('useThisTab')}</strong><small>{t('useThisTabHelp')}</small></span>
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="composer-icon-button quick-context-button"
              aria-label={t('quickAttachPage')}
              title={t('currentPage')}
              disabled={!draftReady || processing || sending || snapshot.sessionLoading}
              onClick={() => void attachPage('page')}
            >
              <PageIcon />
            </button>
            <button
              type="button"
              className="composer-icon-button quick-context-button"
              aria-label={t('quickScreenshot')}
              title={t('screenshot')}
              disabled={!draftReady || processing || sending || snapshot.sessionLoading}
              onClick={() => void addScreenshot()}
            >
              <CameraIcon />
            </button>
            {snapshot.tabBinding ? (
              <button
                type="button"
                className="access-pill"
                title={t('stopAccess')}
                onClick={() => void runControlAction(() => client.unbindActiveTab())}
              >
                {snapshot.tabBinding.mode === 'act' ? <CursorIcon /> : <EyeIcon />}
                <span>{snapshot.tabBinding.mode === 'act' ? t('control') : t('read')}</span>
                <CloseIcon className="access-pill-close" />
              </button>
            ) : null}
          </div>
          <div className="composer-toolbar-end">
            <ModelControls
              key={draftKey}
              models={snapshot.models}
              config={snapshot.modelConfig}
              disabled={sending || processing || voiceBusy || snapshot.submitting || snapshot.sessionLoading || Boolean(snapshot.runId)}
              onModel={model => updateModelConfig(async () => {
                if (!client.currentConversationId) {
                  const payload = drafts.get(draftKey);
                  await client.createSession();
                  drafts.update(keyForSession(client.currentConversationId!), () => payload);
                  drafts.update(draftKey, () => EMPTY_DRAFT);
                }
                await client.updateModel(model);
              })}
              onThinking={level => updateModelConfig(() => client.updateThinking(level))}
            />
            <VoiceInput
              key={`voice:${draftKey}`}
              disabled={sending || processing || snapshot.submitting || snapshot.sessionLoading || !draftReady || !snapshot.endpointReady}
              onBusy={setVoiceBusy}
              onTranscript={text => updateDraft(current => ({ ...current, text: current.text.trim() ? `${current.text} ${text}` : text }))}
            />
            {snapshot.runId && hasComposerContent ? (
              <button
                type="button"
                className="composer-icon-button"
                disabled={!canSend}
                title={t('interruptSend')}
                aria-label={t('interruptSend')}
                onClick={event => void submit(event, true)}
              >
                <SendIcon />
              </button>
            ) : null}
            {snapshot.runId ? (
              <button
                type="button"
                className="send-button stop-button"
                aria-label={t('stopResponse')}
                title={snapshot.stopping ? t('stoppingResponse') : t('stopResponse')}
                disabled={snapshot.stopping}
                onClick={() => void runControlAction(() => client.abort())}
              >
                <StopIcon />
              </button>
            ) : null}
            <button
              className={`send-button${canSend && hasComposerContent && !tabMention && !commandRange ? ' ready' : ''}`}
              type="submit"
              aria-label={snapshot.runId ? t('queueMessage') : t('sendMessage')}
              title={snapshot.runId ? t('queueMessage') : t('sendMessage')}
              disabled={!canSend || !hasComposerContent || Boolean(tabMention) || Boolean(commandRange)}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
