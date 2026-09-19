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

import { extensionLocale, t } from '../i18n';
import {
  BrowserChatClient,
  type BrowserApproval,
  type BrowserChatSnapshot,
} from './chat-client';
import {
  activeTabId,
  captureTabWithPermission,
  PENDING_CONTEXT_KEY,
  type AttachedPageContext,
  type CaptureMode,
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
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  CopyIcon,
  CursorIcon,
  EyeIcon,
  FileIcon,
  PageIcon,
  PaperclipIcon,
  PlusIcon,
  SearchIcon,
  SelectionIcon,
  SendIcon,
  SparkleIcon,
  StopIcon,
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
  messages: [],
  models: [],
};

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

const RISK_MESSAGE_KEYS: Record<BrowserApproval['risk'], string> = {
  external_effect: 'riskExternalEffect',
  destructive: 'riskDestructive',
  sensitive: 'riskSensitive',
  draft: 'riskDraft',
  read: 'riskRead',
};

function formatFileSize(size?: number): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatPanel({ gatewayId }: { gatewayId: string }) {
  const client = useMemo(() => new BrowserChatClient(), []);
  const [snapshot, setSnapshot] = useState(EMPTY);
  const keyForSession = (conversationId?: string) => JSON.stringify([gatewayId, conversationId ?? 'new']);
  const draftKey = keyForSession(snapshot.conversationId);
  const { store: drafts, draft: composerDraft, ready: draftReady, update: updateDraft } = useComposerDrafts(draftKey, cause => setError(String(cause)));
  const draft = composerDraft.text;
  const attachments = composerDraft.attachments;
  const pageContexts = composerDraft.pages;
  const [preview, setPreview] = useState<ComposerPreview>();
  const setDraft = (text: string) => updateDraft(current => ({ ...current, text }));
  const setAttachments = (value: BrowserAttachment[] | ((current: BrowserAttachment[]) => BrowserAttachment[])) => updateDraft(current => ({ ...current, attachments: typeof value === 'function' ? value(current.attachments) : value }));
  function addPageContext(page: AttachedPageContext) {
    updateDraft(current => ({ ...current, pages: appendPageContext(current.pages, page) }));
  }
  const submittingRef = useRef(false);
  const composing = useRef(false);
  const historyWalk = useRef<{ items: string[]; index: number; draft: string } | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [commands, setCommands] = useState<ComposerCommand[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const commandRange = commandsOpen ? findCommand(draft, cursor) : undefined;
  const commandItems = commandRange ? commands.filter(item => matchesCommandQuery(item, commandRange.query)).slice(0, 12) : [];

  const canSend = draftReady && !sending && !processing && !voiceBusy && !snapshot.submitting && !snapshot.pendingDelivery && !snapshot.sessionLoading && !snapshot.stopping && snapshot.endpointReady;

  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [error, setError] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const [clarificationAnswer, setClarificationAnswer] = useState('');
  const [clarificationSubmitting, setClarificationSubmitting] = useState(false);
  const [tabMention, setTabMention] = useState<TabMention>();
  const [mentionTabs, setMentionTabs] = useState<MentionableTab[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
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
    const unsubscribe = client.subscribe(setSnapshot);
    void client.start().then(async () => {
      if (!active) return;
      const stored = await chrome.storage.session.get(PENDING_CONTEXT_KEY);
      const pending = stored[PENDING_CONTEXT_KEY] as AttachedPageContext | undefined;
      if (!pending || !active) return;
      const key = keyForSession(client.currentConversationId);
      await drafts.load(key);
      if (!active) return;
      drafts.update(key, current => ({ ...current, pages: appendPageContext(current.pages, pending) }));
      await chrome.storage.session.remove(PENDING_CONTEXT_KEY);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => {
      active = false;
      unsubscribe();
      client.stop();
    };
  }, [client]);

  useEffect(() => {
    const onUpdated = (tabId: number, change: chrome.tabs.TabChangeInfo) => {
      if (change.url || change.status === 'loading') {
        drafts.invalidate(tabId);
      }
    };
    const onRemoved = (tabId: number) => {
      drafts.invalidate(tabId);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
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
      if (!sessionMenu.current?.contains(target) && !sessionTrigger.current?.contains(target)) setMenuOpen(false);
      if (!toolsMenu.current?.contains(target) && !toolsTrigger.current?.contains(target)) setToolsOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setToolsOpen(false);
      }
    }
    document.addEventListener('mousedown', closeMenus);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenus);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useEffect(() => {
    historyWalk.current = undefined;
    mentionRequest.current += 1;
    setTabMention(undefined);
    setMentionTabs([]);
    setCommandsOpen(false);
    setPreview(undefined);
    setError('');
    if (!snapshot.conversationId) return;
    let active = true;
    const refresh = () => { if (active) void client.refreshInputs().catch(cause => { if (active) setError(String(cause)); }); };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [client, snapshot.conversationId]);

  useEffect(() => {
    if (!commandsOpen) return;
    let active = true;
    setCommandsLoading(true);
    void loadComposerCommands(snapshot.conversationId).then(items => { if (active) setCommands(items); })
      .catch(cause => { if (active) { setCommands([]); setError(String(cause)); } })
      .finally(() => { if (active) setCommandsLoading(false); });
    return () => { active = false; };
  }, [commandsOpen, snapshot.conversationId]);

  function chooseCommand(item: ComposerCommand) {
    if (!commandRange || item.disabled) return;
    const text = `${draft.slice(0, commandRange.start)}${item.wire}${draft.slice(commandRange.end)}`;
    setDraft(text); setCommandsOpen(false);
    const nextCursor = commandRange.start + item.wire.length;
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(nextCursor, nextCursor); });
  }

  async function submit(event: FormEvent, interrupt = false) {
    event.preventDefault();
    if (!canSend || submittingRef.current || composing.current || tabMention || commandRange || attachmentTask.current) return;
    const payload = drafts.get(draftKey);
    if (!payload.text.trim() && !payload.attachments.length) return;
    if (payload.pages.some(page => page.stale)) { setError(t('errorAttachedPageChanged')); return; }
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
      historyWalk.current = undefined;
      drafts.update(targetKey, current => ({
        text: current.text === payload.text ? '' : current.text,
        attachments: current.attachments.filter(item => !payload.attachments.includes(item)),
        pages: current.pages.filter(page => !payload.pages.some(sent => sent.context.sourceId === page.context.sourceId)),
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submittingRef.current = false;
      setSending(false);
    }
  }

  async function updateModelConfig(action: () => Promise<void>) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSending(true);
    try { await action(); }
    catch (cause) { setError(String(cause)); throw cause; }
    finally { submittingRef.current = false; setSending(false); }
  }

  async function processAttachmentTask(operation: () => Promise<void>) {
    if (attachmentTask.current || submittingRef.current || !draftReady || snapshot.sessionLoading) return;
    attachmentTask.current = true;
    setProcessing(true);
    setError('');
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { attachmentTask.current = false; setProcessing(false); }
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
        catch (cause) { failures.push(`${file.name}: ${cause instanceof Error ? cause.message : String(cause)}`); }
      }
      setAttachments(current => [...current, ...added]);
      if (fileInput.current) fileInput.current.value = '';
      if (failures.length) setError(failures.join('\n'));
    });
  }

  async function addScreenshot() {
    await processAttachmentTask(async () => {
      if (drafts.get(draftKey).attachments.length >= MAX_BROWSER_ATTACHMENTS) throw new Error(t('errorAttachmentLimit', String(MAX_BROWSER_ATTACHMENTS)));
      const screenshot = await captureVisibleScreenshot();
      setAttachments(current => [...current, screenshot]);
    });
  }

  async function runControlAction(action: () => Promise<void>) {
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }


  async function attachPage(mode: CaptureMode): Promise<boolean> {
    if (attachmentTask.current || submittingRef.current || !draftReady) return false;
    attachmentTask.current = true;
    setProcessing(true);
    setError('');
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
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally { attachmentTask.current = false; setProcessing(false); }
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
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function refreshPageContext(pageContext: AttachedPageContext) {
    if (attachmentTask.current || submittingRef.current) return;
    attachmentTask.current = true; setProcessing(true);
    setError('');
    try {
      const mode = pageContext.context.selection ? 'selection' : 'page';
      const context = await captureTabWithPermission(
        pageContext.tabId,
        mode,
      );
      addPageContext({ ...pageContext, context, stale: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { attachmentTask.current = false; setProcessing(false); }
  }

  async function updateTabMention(value: string, cursor: number) {
    setCursor(cursor);
    setCommandsOpen(Boolean(findCommand(value, cursor)));
    setCommandIndex(0);
    const requestId = ++mentionRequest.current;
    const mention = findTabMention(value, cursor);
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
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  }

  async function chooseMentionedTab(tab: MentionableTab) {
    const mention = tabMention;
    if (!mention || attachmentTask.current || submittingRef.current) return;
    attachmentTask.current = true; setProcessing(true);
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
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { attachmentTask.current = false; setProcessing(false); }
  }

  async function runSearch(value: string) {
    setSearch(value);
    await client.loadSessions(value).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }

  async function respondToClarification(action: 'answer' | 'agent_decide' | 'cancel', answer?: string) {
    setClarificationSubmitting(true);
    setError('');
    try {
      await client.respondToClarification(action, answer);
      setClarificationAnswer('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClarificationSubmitting(false);
    }
  }

  const activeSession = snapshot.sessions.find((session) => session.key === snapshot.conversationId);
  const connectionText = snapshot.endpointReady
    ? t('ready')
    : snapshot.connection === 'connected'
      ? t('wakingUp')
      : snapshot.connection === 'connecting' || snapshot.connection === 'reconnecting'
        ? t('connecting')
        : t('offline');
  const connectionProblem = !snapshot.endpointReady
    && (snapshot.connection === 'error' || snapshot.connection === 'disconnected');

  return (
    <section className="chat">
      {preview ? <ComposerPreviewDialog preview={preview} onClose={() => setPreview(undefined)} /> : null}
      <div className="chat-toolbar">
        <button ref={sessionTrigger} className="session-trigger" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          <span className="session-trigger-copy">
            <span className="session-title">{activeSession?.title ?? t('newChat')}</span>
            <span className="session-status"><span className={`mini-status ${snapshot.endpointReady ? 'online' : ''}`} />{connectionText}</span>
          </span>
          <ChevronDownIcon className="icon-sm" />
        </button>
        <button className="icon-button" type="button" aria-label={t('startNewChat')} title={t('newChat')} disabled={sending || snapshot.submitting || snapshot.sessionLoading} onClick={() => void runControlAction(() => client.createSession())}><PlusIcon /></button>
      </div>
      {menuOpen ? (
        <div className="session-menu" ref={sessionMenu}>
          <div className="session-menu-header">
            <strong>{t('recentChats')}</strong>
            <button type="button" aria-label={t('closeRecentChats')} onClick={() => setMenuOpen(false)}><CloseIcon /></button>
          </div>
          <label className="session-search">
            <SearchIcon />
            <input value={search} onChange={(event) => void runSearch(event.target.value)} placeholder={t('searchChats')} autoFocus />
          </label>
          <div className="session-list">
            {snapshot.sessions.map((session) => (
              <button key={session.key} disabled={sending || snapshot.submitting || snapshot.sessionLoading} className={session.key === snapshot.conversationId ? 'active' : ''} onClick={() => {
                setMenuOpen(false);
                void runControlAction(() => client.openSession(session.key));
              }}>
                <span className="session-list-copy"><span>{session.title}</span><small>{formatSessionDate(session.updatedAt)}</small></span>
                {session.key === snapshot.conversationId ? <CheckIcon /> : null}
              </button>
            ))}
            {!snapshot.sessions.length ? <div className="session-list-empty">{t('noChatsFound')}</div> : null}
          </div>
        </div>
      ) : null}
      {connectionProblem ? (
        <div className="connection-banner" role="alert">
          <AlertIcon />
          <span>{snapshot.error || t('gatewayOffline')}</span>
          <button type="button" onClick={() => void runControlAction(() => client.reconnect())}>{t('reconnect')}</button>
        </div>
      ) : null}
      <div className="messages-shell">
      <div className="messages" ref={viewport} onScroll={trackScrollPosition}>
        {snapshot.sessionLoading ? (
          <div className="message-skeleton" aria-label={t('loadingChat')}><span /><span /><span /></div>
        ) : null}
        {!snapshot.sessionLoading && !snapshot.messages.length && !snapshot.streamingMessage ? (
          <div className="empty-chat">
            <div className="empty-mark"><SparkleIcon /></div>
            <h1>{t('emptyChatTitle')}</h1>
            <p>{t('emptyChatDescription')}</p>
            <div className="quick-prompts">
              <button type="button" onClick={() => void startQuickPrompt(t('promptSummarizePage'), 'page')}><PageIcon /><span>{t('summarizePage')}</span></button>
              <button type="button" onClick={() => void startQuickPrompt(t('promptExplainSelection'), 'selection')}><SelectionIcon /><span>{t('explainSelection')}</span></button>
              <button type="button" onClick={() => void startQuickPrompt(t('promptHelpTask'))}><CursorIcon /><span>{t('helpWithTask')}</span></button>
            </div>
          </div>
        ) : null}
        {snapshot.messages.map((message) => {
          const text = messageText(message);
          return <article key={message.id} className={`message ${message.role}`}>
            <div className="message-heading">
              <span className="message-author">{message.role === 'user' ? t('you') : message.role === 'assistant' ? 'xopc' : t('system')}</span>
              {formatMessageTime(message.timestamp) ? <time>{formatMessageTime(message.timestamp)}</time> : null}
            </div>
            <div className="message-body">
              {message.sourceContexts?.length ? <div className="message-sources">{message.sourceContexts.map((source, index) => (
                <span className="source-badge" key={`${source.title}-${index}`} title={source.url}>
                  {source.kind === 'browser_page' ? <PageIcon /> : <FileIcon />}
                  <span>{source.title}{source.truncated ? ` · ${t('truncated')}` : ''}</span>
                </span>
              ))}</div> : null}
              {message.attachments?.length ? <div className="message-attachments">{message.attachments.map((attachment, index) => (
                <span className="message-attachment" key={`${attachment.name}-${index}`} title={attachment.mimeType}>
                  {attachment.type === 'image' ? <CameraIcon /> : <FileIcon />}
                  <span><strong>{attachment.name}</strong>{formatFileSize(attachment.size) ? <small>{formatFileSize(attachment.size)}</small> : null}</span>
                </span>
              ))}</div> : null}
              {message.role === 'assistant' ? (
                <AssistantActivity message={message} detail={snapshot.modelConfig?.activityDetail ?? 'on'} streaming={false} />
              ) : null}
              {text ? message.role === 'assistant' ? <MarkdownContent>{text}</MarkdownContent> : <div className="plain-message-content">{text}</div> : null}
            </div>
            {message.role === 'assistant' && text ? (
              <div className="message-actions">
                <button type="button" aria-label={t('copyResponse')} title={t('copyResponse')} onClick={() => void copyMessage(message.id, text)}>
                  {copiedMessageId === message.id ? <CheckIcon /> : <CopyIcon />}
                  <span>{copiedMessageId === message.id ? t('copied') : t('copy')}</span>
                </button>
              </div>
            ) : null}
          </article>;
        })}
        {snapshot.streamingMessage ? (
          <article className="message assistant streaming">
            <div className="message-heading"><span className="message-author">xopc</span><span className="responding-label">{t('responding')}</span></div>
            <div className="message-body">
              <AssistantActivity message={snapshot.streamingMessage} detail={snapshot.modelConfig?.activityDetail ?? 'on'} streaming />
              {messageText(snapshot.streamingMessage) ? <MarkdownContent streaming>{messageText(snapshot.streamingMessage)}</MarkdownContent> : null}
            </div>
          </article>
        ) : null}
      </div>
      {!atBottom ? <button className="scroll-bottom-button" type="button" aria-label={t('scrollLatest')} title={t('scrollLatest')} onClick={() => scrollToBottom(true)}><ArrowDownIcon /></button> : null}
      </div>
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
        {snapshot.browserApproval ? (
          <section className="request-card browser-approval" aria-label={t('browserApproval')}>
            <div className="request-card-title"><AlertIcon /><strong>{t('browserApproval')} · {t(RISK_MESSAGE_KEYS[snapshot.browserApproval.risk])}</strong></div>
            <p>{snapshot.browserApproval.summary}</p>
            <div className="request-actions">
              <button className="request-primary" type="button" onClick={() => void runControlAction(() => client.respondToBrowserApproval('approved'))}>{t('allowOnce')}</button>
              <button type="button" onClick={() => void runControlAction(() => client.respondToBrowserApproval('denied'))}>{t('deny')}</button>
            </div>
          </section>
        ) : null}
        {snapshot.clarification ? (
          <section className="request-card" aria-label={t('agentQuestion')}>
            <div className="request-card-title"><SparkleIcon /><strong>{snapshot.clarification.kind === 'approval' ? t('approvalRequired') : t('xopcNeedsInput')}</strong></div>
            <p>{snapshot.clarification.question}</p>
            {snapshot.clarification.choices?.length ? <div className="choice-list">{snapshot.clarification.choices.map((choice) => (
              <button key={choice} type="button" disabled={clarificationSubmitting} onClick={() => void respondToClarification('answer', choice)}>{choice}</button>
            ))}</div> : null}
            <div className="clarification-answer">
              <input
                value={clarificationAnswer}
                onChange={(event) => setClarificationAnswer(event.target.value)}
                placeholder={snapshot.clarification.suggestedAnswer ?? t('typeAnswer')}
              />
              <button
                type="button"
                disabled={clarificationSubmitting || !clarificationAnswer.trim()}
                onClick={() => void respondToClarification('answer', clarificationAnswer.trim())}
              >{t('send')}</button>
            </div>
            <div className="clarification-actions">
              <button type="button" disabled={clarificationSubmitting} onClick={() => void respondToClarification('agent_decide')}>{t('letXopcDecide')}</button>
              <button type="button" disabled={clarificationSubmitting} onClick={() => void respondToClarification('cancel')}>{t('cancelTask')}</button>
            </div>
          </section>
        ) : null}
        {processing ? <div className="composer-notice" role="status">{t('processingAttachments')}</div> : null}
        {snapshot.queuedInputs?.map(input => <QueuedInput key={`${snapshot.conversationId}:${input.id}`} input={input} onSave={(content, version) => client.editInput(input.id, version, content)} onCancel={() => client.cancelInput(input.id, input.version)} />)}
        {snapshot.pendingDelivery ? <div className="composer-notice" role="status">{t('queuedMessageNotice')}</div> : null}
        {error || (!connectionProblem && snapshot.error) ? <div className="composer-error" role="alert"><AlertIcon />{error || snapshot.error}</div> : null}
        {pageContexts.length || attachments.length ? <div className="composer-contexts">
          {pageContexts.map(pageContext => (
            <div key={pageContext.context.sourceId} className={`context-chip${pageContext.stale ? ' stale' : ''}`}>
              {pageContext.context.selection ? <SelectionIcon /> : <PageIcon />}
              <span>
                <strong>{pageContext.source === 'tab_mention' ? t('tab') : pageContext.context.selection ? t('selection') : t('page')}</strong>
                {' · '}{new URL(pageContext.context.url).hostname} · {pageContext.context.title}
              </span>
              <button type="button" onClick={() => setPreview({ title: pageContext.context.title, text: `${pageContext.context.url}\n\n${pageContext.context.selection ?? pageContext.context.text ?? ''}` })}>{t('preview')}</button>
              {pageContext.context.truncated ? <small>{t('truncated')}</small> : null}
              {pageContext.stale ? <button type="button" disabled={processing} onClick={() => void refreshPageContext(pageContext)}>{t('refresh')}</button> : null}
              <button type="button" className="chip-remove" aria-label={t('removePageContext')} onClick={() => updateDraft(current => ({ ...current, pages: current.pages.filter(page => page.context.sourceId !== pageContext.context.sourceId) }))}><CloseIcon /></button>
            </div>
          ))}
          {attachments.map((attachment, index) => (
            <div className="attachment-chip" key={`${attachment.name}-${index}`}>
              {attachment.type === 'image' ? <button type="button" className="attachment-thumbnail" aria-label={t('preview')} onClick={() => setPreview({ title: attachment.name, image: `data:${attachment.mimeType};base64,${attachment.data}` })}><img src={`data:${attachment.mimeType};base64,${attachment.data}`} alt={attachment.name} /></button> : <FileIcon />}
              <span><strong>{attachment.type === 'image' ? t('image') : t('file')}</strong> · {attachment.name} · {formatFileSize(attachment.size)}</span>
              <button type="button" className="chip-remove" aria-label={t('removeAttachment', attachment.name)} onClick={() => setAttachments((current) => current.filter((_, candidate) => candidate !== index))}><CloseIcon /></button>
            </div>
          ))}
        </div> : null}
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
        {commandRange ? <div className="tab-mention-menu" role="listbox" aria-label={t('commandsAndSkills')}>
          {commandsLoading ? <div className="message-skeleton" aria-label={t('loadingCommands')}><span /><span /><span /></div> : commandItems.map((item, index) => <button key={item.id} type="button" role="option" aria-selected={index === commandIndex} disabled={item.disabled} title={item.disabled ? t('skillUnavailable') : item.description} className={index === commandIndex ? 'selected' : ''} onMouseDown={event => { event.preventDefault(); chooseCommand(item); }}><span>{item.name}</span><small>{item.description}{item.disabled ? ` · ${t('skillUnavailable')}` : ''}</small></button>)}
          {!commandsLoading && !commandItems.length ? <div className="tab-mention-empty">{t('noMatchingCommands')}</div> : null}
        </div> : null}
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
                  if (commandItems.length) setCommandIndex(current => (current + (event.key === 'ArrowDown' ? 1 : -1) + commandItems.length) % commandItems.length);
                  return;
                }
                if (event.key === 'Escape') { event.preventDefault(); setCommandsOpen(false); return; }
                if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); if (commandItems[commandIndex]) chooseCommand(commandItems[commandIndex]); return; }
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
                  const history = walk ?? { items: snapshot.messages.filter(message => message.role === 'user' && messageText(message).trim()).map(messageText).reverse(), index: -1, draft };
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
              <button ref={toolsTrigger} type="button" className={`composer-icon-button${toolsOpen ? ' active' : ''}`} aria-label={t('addContext')} aria-expanded={toolsOpen} onClick={() => setToolsOpen((open) => !open)}><PlusIcon /></button>
              {toolsOpen ? <div className="tools-menu" ref={toolsMenu}>
                <div className="tools-menu-section">
                  <span className="tools-menu-label">{t('addToMessage')}</span>
                  <button type="button" onClick={() => { setToolsOpen(false); void attachPage('page'); }}><PageIcon /><span><strong>{t('currentPage')}</strong><small>{t('sharePageContent')}</small></span></button>
                  <button type="button" onClick={() => { setToolsOpen(false); void attachPage('selection'); }}><SelectionIcon /><span><strong>{t('selectedText')}</strong><small>{t('shareSelection')}</small></span></button>
                  <button type="button" onClick={() => { setToolsOpen(false); void addScreenshot(); }}><CameraIcon /><span><strong>{t('screenshot')}</strong><small>{t('captureVisibleTab')}</small></span></button>
                  <button type="button" onClick={() => { setToolsOpen(false); fileInput.current?.click(); }}><FileIcon /><span><strong>{t('file')}</strong><small>{t('supportedFileTypes')}</small></span></button>
                </div>
                <div className="tools-menu-section tab-access-section">
                  <span className="tools-menu-label">{t('liveTabAccess')}</span>
                  {snapshot.tabBinding ? (
                    <button type="button" className="active-access" onClick={() => { setToolsOpen(false); void runControlAction(() => client.unbindActiveTab()); }}>
                      {snapshot.tabBinding.mode === 'act' ? <CursorIcon /> : <EyeIcon />}
                      <span><strong>{snapshot.tabBinding.mode === 'act' ? t('controlEnabled') : t('readEnabled')}</strong><small>{t('stopAccess')}</small></span><CloseIcon />
                    </button>
                  ) : <>
                    <button type="button" onClick={() => { setToolsOpen(false); void runControlAction(() => client.bindActiveTab('read')); }}><EyeIcon /><span><strong>{t('readThisTab')}</strong><small>{t('keepPageAvailable')}</small></span></button>
                    <button type="button" onClick={() => { setToolsOpen(false); void runControlAction(() => client.bindActiveTab('act')); }}><CursorIcon /><span><strong>{t('controlThisTab')}</strong><small>{t('controlSafeguards')}</small></span></button>
                  </>}
                </div>
              </div> : null}
            </div>
            <div className="composer-state">
              <span className={`mini-status ${snapshot.endpointReady ? 'online' : ''}`} />
              <span className="composer-state-label">{snapshot.stopping ? t('stopping') : snapshot.submitting ? t('sending') : snapshot.pendingDelivery ? t('queued') : connectionText}</span>
              {snapshot.tabBinding ? <span className="access-pill">{snapshot.tabBinding.mode === 'act' ? <CursorIcon /> : <EyeIcon />}{snapshot.tabBinding.mode === 'act' ? t('control') : t('read')}</span> : null}
            </div>
          </div>
          <div className="composer-toolbar-end">
            <ModelControls key={draftKey} models={snapshot.models} config={snapshot.modelConfig} disabled={sending || processing || voiceBusy || snapshot.submitting || snapshot.sessionLoading || Boolean(snapshot.runId)} onModel={model => updateModelConfig(async () => {
              if (!client.currentConversationId) {
                const payload = drafts.get(draftKey);
                await client.createSession();
                drafts.update(keyForSession(client.currentConversationId!), () => payload);
                drafts.update(draftKey, () => EMPTY_DRAFT);
              }
              await client.updateModel(model);
            })} onThinking={level => updateModelConfig(() => client.updateThinking(level))} />
            <VoiceInput key={`voice:${draftKey}`} disabled={sending || processing || snapshot.submitting || snapshot.sessionLoading || !draftReady || !snapshot.endpointReady} onBusy={setVoiceBusy} onTranscript={text => updateDraft(current => ({ ...current, text: current.text.trim() ? `${current.text} ${text}` : text }))} />
            {snapshot.runId && (draft.trim() || attachments.length) ? <button type="button" className="composer-icon-button" disabled={!canSend} title={t('interruptSend')} aria-label={t('interruptSend')} onClick={event => void submit(event, true)}><SendIcon /></button> : null}
            {snapshot.runId ? (
              <button type="button" className="send-button stop-button" aria-label={t('stopResponse')} title={snapshot.stopping ? t('stoppingResponse') : t('stopResponse')} disabled={snapshot.stopping} onClick={() => void runControlAction(() => client.abort())}><StopIcon /></button>
            ) : null}
              <button className="send-button" type="submit" aria-label={snapshot.runId ? t('queueMessage') : t('sendMessage')} title={snapshot.runId ? t('queueMessage') : t('sendMessage')} disabled={!canSend || (!draft.trim() && attachments.length === 0) || Boolean(tabMention) || Boolean(commandRange)}><SendIcon /></button>
          </div>
        </div>
      </form>
    </section>
  );
}
