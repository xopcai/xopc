import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  BrowserChatClient,
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
  streamingText: '',
  models: [],
};

function formatMessageTime(timestamp?: number): string {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

function formatSessionDate(timestamp?: string | number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return formatMessageTime(date.getTime());
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function formatFileSize(size?: number): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatPanel() {
  const client = useMemo(() => new BrowserChatClient(), []);
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [error, setError] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const [clarificationAnswer, setClarificationAnswer] = useState('');
  const [clarificationSubmitting, setClarificationSubmitting] = useState(false);
  const [pageContext, setPageContext] = useState<AttachedPageContext>();
  const [attachments, setAttachments] = useState<BrowserAttachment[]>([]);
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
    const unsubscribe = client.subscribe(setSnapshot);
    void client.start().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      unsubscribe();
      client.stop();
    };
  }, [client]);

  useEffect(() => {
    void chrome.storage.session.get(PENDING_CONTEXT_KEY).then(async (stored) => {
      const pending = stored[PENDING_CONTEXT_KEY] as AttachedPageContext | undefined;
      if (pending?.context.kind === 'browser_page') setPageContext(pending);
      await chrome.storage.session.remove(PENDING_CONTEXT_KEY);
    });
    const onUpdated = (tabId: number, change: chrome.tabs.TabChangeInfo) => {
      if (change.url || change.status === 'loading') {
        setPageContext((current) => current?.tabId === tabId ? { ...current, stale: true } : current);
      }
    };
    const onRemoved = (tabId: number) => {
      setPageContext((current) => current?.tabId === tabId ? { ...current, stale: true } : current);
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
  }, [scrollToBottom, snapshot.messages, snapshot.streamingText]);

  useEffect(() => {
    followingTail.current = true;
    setAtBottom(true);
    const frame = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(frame);
  }, [scrollToBottom, snapshot.sessionKey]);

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() && attachments.length === 0) return;
    const sending = draft;
    const sendingAttachments = attachments;
    setDraft('');
    setAttachments([]);
    setError('');
    followingTail.current = true;
    setAtBottom(true);
    try {
      if (!snapshot.sessionKey) await client.createSession();
      if (pageContext?.stale) throw new Error('The attached page changed. Refresh or remove it before sending.');
      await client.send(sending, pageContext ? [pageContext.context] : [], sendingAttachments);
      setPageContext(undefined);
    } catch (cause) {
      setDraft(sending);
      setAttachments(sendingAttachments);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function addFiles(files: FileList | readonly File[] | null) {
    const incoming = Array.from(files ?? []);
    if (!incoming.length || attachmentTask.current) return;
    attachmentTask.current = true;
    setError('');
    try {
      const remaining = MAX_BROWSER_ATTACHMENTS - attachments.length;
      if (incoming.length > remaining) throw new Error(`Attach up to ${MAX_BROWSER_ATTACHMENTS} files`);
      const added = await Promise.all(incoming.map(fileToBrowserAttachment));
      setAttachments((current) => [...current, ...added]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      attachmentTask.current = false;
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function addScreenshot() {
    setError('');
    try {
      if (attachments.length >= MAX_BROWSER_ATTACHMENTS) throw new Error(`Attach up to ${MAX_BROWSER_ATTACHMENTS} files`);
      const screenshot = await captureVisibleScreenshot();
      setAttachments((current) => [...current, screenshot]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function runControlAction(action: () => Promise<void>) {
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const selectedModel = snapshot.models.find((model) => model.id === snapshot.modelConfig?.model);
  const thinkingOptions = selectedModel?.thinking?.options ?? [];

  async function attachPage(mode: CaptureMode): Promise<boolean> {
    setError('');
    try {
      const tabId = await activeTabId();
      if (tabId === undefined) throw new Error('No active web page');
      setPageContext({
        context: await captureTabWithPermission(tabId, mode),
        tabId,
        source: mode === 'selection' ? 'current_selection' : 'current_page',
      });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
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
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function refreshPageContext() {
    if (!pageContext) return;
    setError('');
    try {
      const mode = pageContext.context.selection ? 'selection' : 'page';
      const context = await captureTabWithPermission(
        pageContext.tabId,
        mode,
      );
      setPageContext({ ...pageContext, context, stale: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function updateTabMention(value: string, cursor: number) {
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
    if (!mention) return;
    mentionRequest.current += 1;
    setTabMention(undefined);
    setMentionTabs([]);
    setError('');
    try {
      const context = await captureTabWithPermission(tab.id, 'page');
      const nextDraft = removeTabMention(draft, mention);
      setPageContext({ context, tabId: tab.id, source: 'tab_mention' });
      setDraft(nextDraft);
      requestAnimationFrame(() => {
        textarea.current?.focus();
        textarea.current?.setSelectionRange(mention.start, mention.start);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
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

  const activeSession = snapshot.sessions.find((session) => session.key === snapshot.sessionKey);
  const connectionText = snapshot.endpointReady
    ? 'Ready'
    : snapshot.connection === 'connected'
      ? 'Waking up…'
      : snapshot.connection === 'connecting' || snapshot.connection === 'reconnecting'
        ? 'Connecting…'
        : 'Offline';
  const connectionProblem = !snapshot.endpointReady
    && (snapshot.connection === 'error' || snapshot.connection === 'disconnected');

  return (
    <section className="chat">
      <div className="chat-toolbar">
        <button ref={sessionTrigger} className="session-trigger" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          <span className="session-trigger-copy">
            <span className="session-title">{activeSession?.title ?? 'New chat'}</span>
            <span className="session-status"><span className={`mini-status ${snapshot.endpointReady ? 'online' : ''}`} />{connectionText}</span>
          </span>
          <ChevronDownIcon className="icon-sm" />
        </button>
        <button className="icon-button" type="button" aria-label="Start a new chat" title="New chat" disabled={snapshot.submitting} onClick={() => void runControlAction(() => client.createSession())}><PlusIcon /></button>
      </div>
      {menuOpen ? (
        <div className="session-menu" ref={sessionMenu}>
          <div className="session-menu-header">
            <strong>Recent chats</strong>
            <button type="button" aria-label="Close recent chats" onClick={() => setMenuOpen(false)}><CloseIcon /></button>
          </div>
          <label className="session-search">
            <SearchIcon />
            <input value={search} onChange={(event) => void runSearch(event.target.value)} placeholder="Search chats" autoFocus />
          </label>
          <div className="session-list">
            {snapshot.sessions.map((session) => (
              <button key={session.key} disabled={snapshot.submitting} className={session.key === snapshot.sessionKey ? 'active' : ''} onClick={() => {
                setMenuOpen(false);
                void runControlAction(() => client.openSession(session.key));
              }}>
                <span className="session-list-copy"><span>{session.title}</span><small>{formatSessionDate(session.updatedAt)}</small></span>
                {session.key === snapshot.sessionKey ? <CheckIcon /> : null}
              </button>
            ))}
            {!snapshot.sessions.length ? <div className="session-list-empty">No chats found</div> : null}
          </div>
        </div>
      ) : null}
      {connectionProblem ? (
        <div className="connection-banner" role="alert">
          <AlertIcon />
          <span>{snapshot.error || 'Gateway connection is offline.'}</span>
          <button type="button" onClick={() => void runControlAction(() => client.reconnect())}>Reconnect</button>
        </div>
      ) : null}
      <div className="messages-shell">
      <div className="messages" ref={viewport} onScroll={trackScrollPosition}>
        {snapshot.sessionLoading ? (
          <div className="message-skeleton" aria-label="Loading chat"><span /><span /><span /></div>
        ) : null}
        {!snapshot.sessionLoading && !snapshot.messages.length && !snapshot.streamingText ? (
          <div className="empty-chat">
            <div className="empty-mark"><SparkleIcon /></div>
            <h1>What can I help with?</h1>
            <p>Ask a question, bring in the current page, or let xopc help you complete a browser task.</p>
            <div className="quick-prompts">
              <button type="button" onClick={() => void startQuickPrompt('Summarize this page and highlight the key points.', 'page')}><PageIcon /><span>Summarize this page</span></button>
              <button type="button" onClick={() => void startQuickPrompt('Explain the selected text in plain language.', 'selection')}><SelectionIcon /><span>Explain selection</span></button>
              <button type="button" onClick={() => void startQuickPrompt('Help me complete the task on this page. Ask before taking any consequential action.')}><CursorIcon /><span>Help with a task</span></button>
            </div>
          </div>
        ) : null}
        {snapshot.messages.map((message) => (
          <article key={message.id} className={`message ${message.role}`}>
            <div className="message-heading">
              <span className="message-author">{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'xopc' : 'System'}</span>
              {formatMessageTime(message.timestamp) ? <time>{formatMessageTime(message.timestamp)}</time> : null}
            </div>
            <div className="message-body">
              {message.sourceContexts?.length ? <div className="message-sources">{message.sourceContexts.map((source, index) => (
                <span className="source-badge" key={`${source.title}-${index}`} title={source.url}>
                  {source.kind === 'browser_page' ? <PageIcon /> : <FileIcon />}
                  <span>{source.title}{source.truncated ? ' · truncated' : ''}</span>
                </span>
              ))}</div> : null}
              {message.attachments?.length ? <div className="message-attachments">{message.attachments.map((attachment, index) => (
                <span className="message-attachment" key={`${attachment.name}-${index}`} title={attachment.mimeType}>
                  {attachment.type === 'image' ? <CameraIcon /> : <FileIcon />}
                  <span><strong>{attachment.name}</strong>{formatFileSize(attachment.size) ? <small>{formatFileSize(attachment.size)}</small> : null}</span>
                </span>
              ))}</div> : null}
              {message.text ? message.role === 'assistant' ? <MarkdownContent>{message.text}</MarkdownContent> : <div className="plain-message-content">{message.text}</div> : null}
            </div>
            {message.role === 'assistant' ? (
              <div className="message-actions">
                <button type="button" aria-label="Copy response" title="Copy response" onClick={() => void copyMessage(message.id, message.text)}>
                  {copiedMessageId === message.id ? <CheckIcon /> : <CopyIcon />}
                  <span>{copiedMessageId === message.id ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            ) : null}
          </article>
        ))}
        {snapshot.streamingText ? (
          <article className="message assistant streaming">
            <div className="message-heading"><span className="message-author">xopc</span><span className="responding-label">Responding</span></div>
            <div className="message-body"><MarkdownContent streaming>{snapshot.streamingText}</MarkdownContent></div>
          </article>
        ) : null}
      </div>
      {!atBottom ? <button className="scroll-bottom-button" type="button" aria-label="Scroll to latest message" title="Scroll to latest message" onClick={() => scrollToBottom(true)}><ArrowDownIcon /></button> : null}
      </div>
      <form
        className={`composer${draggingFiles ? ' dragging' : ''}`}
        onSubmit={submit}
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
        {draggingFiles ? <div className="file-drop-overlay"><PaperclipIcon /><span>Drop files to attach</span></div> : null}
        {snapshot.browserApproval ? (
          <section className="request-card browser-approval" aria-label="Browser approval">
            <div className="request-card-title"><AlertIcon /><strong>Browser approval · {snapshot.browserApproval.risk.replace('_', ' ')}</strong></div>
            <p>{snapshot.browserApproval.summary}</p>
            <div className="request-actions">
              <button className="request-primary" type="button" onClick={() => void runControlAction(() => client.respondToBrowserApproval('approved'))}>Allow once</button>
              <button type="button" onClick={() => void runControlAction(() => client.respondToBrowserApproval('denied'))}>Deny</button>
            </div>
          </section>
        ) : null}
        {snapshot.clarification ? (
          <section className="request-card" aria-label="Agent question">
            <div className="request-card-title"><SparkleIcon /><strong>{snapshot.clarification.kind === 'approval' ? 'Approval required' : 'xopc needs your input'}</strong></div>
            <p>{snapshot.clarification.question}</p>
            {snapshot.clarification.choices?.length ? <div className="choice-list">{snapshot.clarification.choices.map((choice) => (
              <button key={choice} type="button" disabled={clarificationSubmitting} onClick={() => void respondToClarification('answer', choice)}>{choice}</button>
            ))}</div> : null}
            <div className="clarification-answer">
              <input
                value={clarificationAnswer}
                onChange={(event) => setClarificationAnswer(event.target.value)}
                placeholder={snapshot.clarification.suggestedAnswer ?? 'Type your answer'}
              />
              <button
                type="button"
                disabled={clarificationSubmitting || !clarificationAnswer.trim()}
                onClick={() => void respondToClarification('answer', clarificationAnswer.trim())}
              >Send</button>
            </div>
            <div className="clarification-actions">
              <button type="button" disabled={clarificationSubmitting} onClick={() => void respondToClarification('agent_decide')}>Let xopc decide</button>
              <button type="button" disabled={clarificationSubmitting} onClick={() => void respondToClarification('cancel')}>Cancel task</button>
            </div>
          </section>
        ) : null}
        {snapshot.pendingDelivery ? <div className="composer-notice" role="status">Connection interrupted. Your message is queued and will send after xopc reconnects.</div> : null}
        {error || (!connectionProblem && snapshot.error) ? <div className="composer-error" role="alert"><AlertIcon />{error || snapshot.error}</div> : null}
        {pageContext || attachments.length ? <div className="composer-contexts">
          {pageContext ? (
            <div className={`context-chip${pageContext.stale ? ' stale' : ''}`}>
              {pageContext.context.selection ? <SelectionIcon /> : <PageIcon />}
              <span>
                <strong>{pageContext.source === 'tab_mention' ? 'Tab' : pageContext.context.selection ? 'Selection' : 'Page'}</strong>
                {' · '}{new URL(pageContext.context.url).hostname} · {pageContext.context.title}
              </span>
              {pageContext.stale ? <button type="button" onClick={() => void refreshPageContext()}>Refresh</button> : null}
              <button type="button" className="chip-remove" aria-label="Remove page context" onClick={() => setPageContext(undefined)}><CloseIcon /></button>
            </div>
          ) : null}
          {attachments.map((attachment, index) => (
            <div className="attachment-chip" key={`${attachment.name}-${index}`}>
              {attachment.type === 'image' ? <CameraIcon /> : <FileIcon />}
              <span><strong>{attachment.type === 'image' ? 'Image' : 'File'}</strong> · {attachment.name}</span>
              <button type="button" className="chip-remove" aria-label={`Remove ${attachment.name}`} onClick={() => setAttachments((current) => current.filter((_, candidate) => candidate !== index))}><CloseIcon /></button>
            </div>
          ))}
        </div> : null}
        <input
          ref={fileInput}
          className="file-input"
          type="file"
          multiple
          accept="image/*,.pdf,text/plain,text/markdown,.json,.csv"
          onChange={(event) => void addFiles(event.target.files)}
        />
        {tabMention ? (
          <div className="tab-mention-menu" role="listbox" aria-label="Open tabs">
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
                <small>{tab.hostname}{tab.active ? ' · current' : ''}</small>
              </button>
            )) : <div className="tab-mention-empty">No matching tabs</div>}
          </div>
        ) : null}
        <div className="composer-input-row">
          <div className="tools-anchor">
            <button ref={toolsTrigger} type="button" className={`composer-icon-button${toolsOpen ? ' active' : ''}`} aria-label="Add context or attachment" aria-expanded={toolsOpen} onClick={() => setToolsOpen((open) => !open)}><PaperclipIcon /></button>
            {toolsOpen ? <div className="tools-menu" ref={toolsMenu}>
              <div className="tools-menu-section">
                <span className="tools-menu-label">Add to this message</span>
                <button type="button" onClick={() => { setToolsOpen(false); void attachPage('page'); }}><PageIcon /><span><strong>Current page</strong><small>Share readable page content</small></span></button>
                <button type="button" onClick={() => { setToolsOpen(false); void attachPage('selection'); }}><SelectionIcon /><span><strong>Selected text</strong><small>Share your current selection</small></span></button>
                <button type="button" onClick={() => { setToolsOpen(false); void addScreenshot(); }}><CameraIcon /><span><strong>Screenshot</strong><small>Capture the visible tab</small></span></button>
                <button type="button" onClick={() => { setToolsOpen(false); fileInput.current?.click(); }}><FileIcon /><span><strong>File</strong><small>Image, PDF, text, JSON, or CSV</small></span></button>
              </div>
              <div className="tools-menu-section tab-access-section">
                <span className="tools-menu-label">Live tab access</span>
                {snapshot.tabBinding ? (
                  <button type="button" className="active-access" onClick={() => { setToolsOpen(false); void runControlAction(() => client.unbindActiveTab()); }}>
                    {snapshot.tabBinding.mode === 'act' ? <CursorIcon /> : <EyeIcon />}
                    <span><strong>{snapshot.tabBinding.mode === 'act' ? 'Control enabled' : 'Read enabled'}</strong><small>Click to stop access</small></span><CloseIcon />
                  </button>
                ) : <>
                  <button type="button" onClick={() => { setToolsOpen(false); void runControlAction(() => client.bindActiveTab('read')); }}><EyeIcon /><span><strong>Read this tab</strong><small>Keep page content available</small></span></button>
                  <button type="button" onClick={() => { setToolsOpen(false); void runControlAction(() => client.bindActiveTab('act')); }}><CursorIcon /><span><strong>Control this tab</strong><small>Allow browser actions with safeguards</small></span></button>
                </>}
              </div>
            </div> : null}
          </div>
          <textarea
            ref={textarea}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              void updateTabMention(event.target.value, event.target.selectionStart);
            }}
            onSelect={(event) => void updateTabMention(event.currentTarget.value, event.currentTarget.selectionStart)}
            onPaste={(event) => {
              if (!event.clipboardData.files.length) return;
              event.preventDefault();
              void addFiles(event.clipboardData.files);
            }}
            onKeyDown={(event) => {
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
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            onBlur={() => {
              mentionRequest.current += 1;
              setTabMention(undefined);
              setMentionTabs([]);
            }}
            placeholder="Message xopc…  Use @ to mention a tab"
            disabled={snapshot.submitting}
            rows={1}
          />
          {snapshot.runId ? (
            <button type="button" className="send-button stop-button" aria-label="Stop response" title={snapshot.stopping ? 'Stopping response' : 'Stop response'} disabled={snapshot.stopping} onClick={() => void runControlAction(() => client.abort())}><StopIcon /></button>
          ) : (
            <button className="send-button" type="submit" aria-label="Send message" title="Send message" disabled={snapshot.submitting || snapshot.pendingDelivery || snapshot.sessionLoading || (!draft.trim() && attachments.length === 0) || !snapshot.endpointReady || Boolean(tabMention)}><SendIcon /></button>
          )}
        </div>
        <div className="composer-footer">
          <div className="composer-state">
            <span className={`mini-status ${snapshot.endpointReady ? 'online' : ''}`} />
            <span>{snapshot.stopping ? 'Stopping…' : snapshot.submitting ? 'Sending…' : snapshot.pendingDelivery ? 'Queued' : connectionText}</span>
            {snapshot.tabBinding ? <span className="access-pill">{snapshot.tabBinding.mode === 'act' ? <CursorIcon /> : <EyeIcon />}{snapshot.tabBinding.mode === 'act' ? 'Control' : 'Read'}</span> : null}
          </div>
          {snapshot.modelConfig ? (
            <div className="model-controls">
              <select aria-label="Model" title="Session model" value={snapshot.modelConfig.model} disabled={snapshot.modelConfig.fixedModel || Boolean(snapshot.runId)} onChange={(event) => void runControlAction(() => client.updateModel(event.target.value))}>
                {snapshot.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
              {thinkingOptions.length ? (
                <select aria-label="Thinking level" title="Thinking level" value={snapshot.modelConfig.thinkingLevel} disabled={Boolean(snapshot.runId)} onChange={(event) => void runControlAction(() => client.updateThinking(event.target.value))}>
                  {thinkingOptions.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              ) : null}
            </div>
          ) : null}
        </div>
      </form>
    </section>
  );
}
