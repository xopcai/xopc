import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import {
  BrowserChatClient,
  type BrowserChatSnapshot,
} from './chat-client';
import {
  activeTabId,
  captureTabPage,
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

const EMPTY: BrowserChatSnapshot = {
  connection: 'idle',
  endpointReady: false,
  sessions: [],
  messages: [],
  streamingText: '',
  models: [],
};

export function ChatPanel() {
  const client = useMemo(() => new BrowserChatClient(), []);
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState('');
  const [clarificationAnswer, setClarificationAnswer] = useState('');
  const [clarificationSubmitting, setClarificationSubmitting] = useState(false);
  const [pageContext, setPageContext] = useState<AttachedPageContext>();
  const [attachments, setAttachments] = useState<BrowserAttachment[]>([]);
  const [tabMention, setTabMention] = useState<TabMention>();
  const [mentionTabs, setMentionTabs] = useState<MentionableTab[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mentionRequest = useRef(0);
  const bindingRef = useRef(snapshot.tabBinding);
  bindingRef.current = snapshot.tabBinding;

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
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [snapshot.messages, snapshot.streamingText]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() && attachments.length === 0) return;
    const sending = draft;
    const sendingAttachments = attachments;
    setDraft('');
    setAttachments([]);
    setError('');
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

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    try {
      const remaining = MAX_BROWSER_ATTACHMENTS - attachments.length;
      if (files.length > remaining) throw new Error(`Attach up to ${MAX_BROWSER_ATTACHMENTS} files`);
      const added = await Promise.all([...files].map(fileToBrowserAttachment));
      setAttachments((current) => [...current, ...added]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
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

  async function attachPage(mode: CaptureMode) {
    setError('');
    try {
      const tabId = await activeTabId();
      if (tabId === undefined) throw new Error('No active web page');
      setPageContext({
        context: await captureTabPage(tabId, mode),
        tabId,
        source: mode === 'selection' ? 'current_selection' : 'current_page',
      });
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
        pageContext.context.url,
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
      const context = await captureTabWithPermission(tab.id, tab.url, 'page');
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

  return (
    <section className="chat">
      <div className="chat-toolbar">
        <button className="session-trigger" onClick={() => setMenuOpen((open) => !open)}>
          {snapshot.sessions.find((session) => session.key === snapshot.sessionKey)?.title ?? 'New chat'}
          <span aria-hidden>⌄</span>
        </button>
        <button className="icon-button" title="New chat" onClick={() => void client.createSession()}>＋</button>
      </div>
      {menuOpen ? (
        <div className="session-menu">
          <input value={search} onChange={(event) => void runSearch(event.target.value)} placeholder="Search recent chats" autoFocus />
          <div className="session-list">
            {snapshot.sessions.map((session) => (
              <button key={session.key} onClick={() => {
                setMenuOpen(false);
                void client.openSession(session.key);
              }}>
                <span>{session.title}</span>
                <small>{session.updatedAt ? new Date(session.updatedAt).toLocaleDateString() : ''}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="messages" ref={viewport}>
        {!snapshot.messages.length && !snapshot.streamingText ? (
          <div className="empty-chat"><div className="mark">✦</div><p>How can I help?</p></div>
        ) : null}
        {snapshot.messages.map((message) => (
          <article key={message.id} className={`message ${message.role}`}>
            <div className="message-role">{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'xopc' : 'System'}</div>
            {message.sourceContexts?.map((source, index) => (
              <div className="source-badge" key={`${source.title}-${index}`} title={source.url}>
                {source.kind === 'browser_page' ? 'Page' : 'Note'} · {source.title}{source.truncated ? ' · truncated' : ''}
              </div>
            ))}
            <div className="message-content">{message.text}</div>
          </article>
        ))}
        {snapshot.streamingText ? (
          <article className="message assistant streaming">
            <div className="message-role">xopc</div>
            <div className="message-content">{snapshot.streamingText}<span className="caret" /></div>
          </article>
        ) : null}
      </div>
      <form className="composer" onSubmit={submit}>
        {snapshot.browserApproval ? (
          <section className="clarification browser-approval" aria-label="Browser approval">
            <strong>Browser action needs approval · {snapshot.browserApproval.risk.replace('_', ' ')}</strong>
            <p>{snapshot.browserApproval.summary}</p>
            <button type="button" onClick={() => void client.respondToBrowserApproval('approved')}>Allow once</button>
            <button type="button" onClick={() => void client.respondToBrowserApproval('denied')}>Deny</button>
          </section>
        ) : null}
        {snapshot.clarification ? (
          <section className="clarification" aria-label="Agent question">
            <strong>{snapshot.clarification.kind === 'approval' ? 'Approval required' : 'More information needed'}</strong>
            <p>{snapshot.clarification.question}</p>
            {snapshot.clarification.choices?.map((choice) => (
              <button
                key={choice}
                type="button"
                disabled={clarificationSubmitting}
                onClick={() => void respondToClarification('answer', choice)}
              >{choice}</button>
            ))}
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
              >Reply</button>
            </div>
            <div className="clarification-actions">
              <button type="button" disabled={clarificationSubmitting} onClick={() => void respondToClarification('agent_decide')}>Let xopc decide</button>
              <button type="button" disabled={clarificationSubmitting} onClick={() => void respondToClarification('cancel')}>Cancel task</button>
            </div>
          </section>
        ) : null}
        {error || snapshot.error ? <div className="composer-error">{error || snapshot.error}</div> : null}
        {pageContext ? (
          <div className={`context-chip${pageContext.stale ? ' stale' : ''}`}>
            <span>
              {pageContext.source === 'tab_mention' ? 'Tab' : pageContext.context.selection ? 'Selection' : 'Page'}
              {' · '}{new URL(pageContext.context.url).hostname} · {pageContext.context.title}
            </span>
            {pageContext.stale ? <button type="button" onClick={() => void refreshPageContext()}>Refresh</button> : null}
            <button type="button" aria-label="Remove page context" onClick={() => setPageContext(undefined)}>×</button>
          </div>
        ) : null}
        {attachments.map((attachment, index) => (
          <div className="attachment-chip" key={`${attachment.name}-${index}`}>
            <span>{attachment.type === 'image' ? 'Image' : 'File'} · {attachment.name}</span>
            <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => setAttachments((current) => current.filter((_, candidate) => candidate !== index))}>×</button>
          </div>
        ))}
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
        <textarea
          ref={textarea}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            void updateTabMention(event.target.value, event.target.selectionStart);
          }}
          onSelect={(event) => void updateTabMention(event.currentTarget.value, event.currentTarget.selectionStart)}
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
          placeholder="Ask anything"
          rows={3}
        />
        <div className="composer-row">
          <div className="composer-tools">
            <button type="button" title="Attach current page" onClick={() => void attachPage('page')}>＋ Page</button>
            <button type="button" title="Attach selected text" onClick={() => void attachPage('selection')}>Selection</button>
            <button type="button" title="Attach a screenshot" onClick={() => void addScreenshot()}>Screenshot</button>
            <button type="button" title="Attach a file" onClick={() => fileInput.current?.click()}>File</button>
            {snapshot.tabBinding ? (
              <button type="button" title="Stop controlling this tab" onClick={() => void runControlAction(() => client.unbindActiveTab())}>
                {snapshot.tabBinding.mode === 'act' ? 'Control on' : 'Read on'} ×
              </button>
            ) : (
              <>
                <button type="button" title="Allow this chat to read the current tab" onClick={() => void runControlAction(() => client.bindActiveTab('read'))}>Read tab</button>
                <button type="button" title="Allow this chat to act in the current tab" onClick={() => void runControlAction(() => client.bindActiveTab('act'))}>Control tab</button>
              </>
            )}
            <span className="connection-label">{snapshot.endpointReady ? 'ready' : snapshot.connection}</span>
          </div>
          {snapshot.modelConfig ? (
            <div className="model-controls">
              <select
                aria-label="Model"
                title="Session model"
                value={snapshot.modelConfig.model}
                disabled={snapshot.modelConfig.fixedModel || Boolean(snapshot.runId)}
                onChange={(event) => void runControlAction(() => client.updateModel(event.target.value))}
              >
                {snapshot.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
              {thinkingOptions.length ? (
                <select
                  aria-label="Thinking level"
                  title="Thinking level"
                  value={snapshot.modelConfig.thinkingLevel}
                  disabled={Boolean(snapshot.runId)}
                  onChange={(event) => void runControlAction(() => client.updateThinking(event.target.value))}
                >
                  {thinkingOptions.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              ) : null}
            </div>
          ) : null}
          {snapshot.runId ? (
            <button type="button" className="stop-button" onClick={() => void client.abort()}>Stop</button>
          ) : (
            <button className="send-button" type="submit" disabled={(!draft.trim() && attachments.length === 0) || !snapshot.endpointReady || Boolean(tabMention)}>↑</button>
          )}
        </div>
      </form>
    </section>
  );
}
