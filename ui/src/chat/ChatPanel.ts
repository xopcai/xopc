import { html, LitElement } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import '../components/MessageEditor.js';
import '../components/MessageList/index.js';
import '../components/MarkdownRenderer.js';
import { t, initI18n } from '../utils/i18n.js';
import { getLanguage } from '../utils/storage.js';
import type { Attachment } from '../utils/attachment-utils.js';
import type { MessageEditor, ThinkingLevel } from '../components/MessageEditor.js';
import type { ChatRoute } from '../navigation.js';
import type { GatewayClientConfig, Message, ProgressState, ConnectionState, ToolCall, SessionInfo } from './types.js';
import { ChatConnection } from './connection.js';
import { SessionManager } from './session.js';
import { MessageSender } from './messaging.js';
import { formatTime, formatFileSize } from './helpers.js';

export type { GatewayClientConfig, Message, ProgressState, ConnectionState, SessionInfo };

@customElement('chat-panel')
export class ChatPanel extends LitElement {
  @property({ attribute: false }) config?: GatewayClientConfig;
  @property({ attribute: false }) route?: ChatRoute;
  @property({ type: Boolean }) enableAttachments = true;
  @property({ type: Boolean }) enableModelSelector = true;

  @query('message-editor') private _editor!: MessageEditor;
  @query('.chat-messages') private _messagesEl!: HTMLElement;

  @state() private _connState: ConnectionState = 'disconnected';
  @state() private _error: string | null = null;
  @state() private _messages: Message[] = [];
  @state() private _streaming = false;
  @state() private _streamingMsg: Message | null = null;
  @state() private _progress: ProgressState | null = null;
  @state() private _reconnectCount = 0;
  @state() private _atBottom = true;
  @state() private _sessionKey: string | null = null;
  @state() private _sessions: SessionInfo[] = [];
  @state() private _hasMore = true;
  @state() private _loadingMore = false;
  @state() private _thinkingLevel: ThinkingLevel = 'medium';
  @state() private _toolCalls: ToolCall[] = [];

  private _conn?: ChatConnection;
  private _sessionMgr?: SessionManager;
  private _sender?: MessageSender;
  private _isSending = false;
  private _lastScrollTop = 0;
  private _lastClientHeight = 0;
  private _routeHandled = false;
  private _lastLoadedKey: string | null = null;
  private _loadingSession = false;

  createRenderRoot() { return this; }

  override connectedCallback() {
    super.connectedCallback();
    this.classList.add('chat-container');
    // Align with app / localStorage; do not force English (would override user locale).
    initI18n(getLanguage());
  }

  override firstUpdated() {
    this._messagesEl?.addEventListener('scroll', this._onScroll as EventListener);
    this._handleRouteChange();
    this._routeHandled = true;
  }

  override updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (changed.has('config') && this.config && this._connState === 'disconnected') {
      this._initServices();
      this.connect();
    }
    if (changed.has('route') && this.route && this._routeHandled) {
      this._handleRouteChange();
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._conn?.disconnect();
    this._messagesEl?.removeEventListener('scroll', this._onScroll as EventListener);
  }

  // ── Services ──────────────────────────────────────────────

  private _initServices() {
    if (!this.config) return;
    this._sessionMgr = new SessionManager(this.config);
    this._sender = new MessageSender(this.config);
    this._conn = new ChatConnection(this.config, {
      onConnected: () => { this._connState = 'connected'; this._error = null; this._reconnectCount = 0; this._loadSessions(false); this.requestUpdate(); },
      onReconnecting: () => { this._connState = 'reconnecting'; this.requestUpdate(); },
      onDisconnected: () => { this._connState = 'disconnected'; this.requestUpdate(); },
      onError: (msg) => { this._error = msg; this._connState = 'error'; this.requestUpdate(); },
      onEvent: (evt, data) => {
        try {
          const detail = JSON.parse(data);
          this.dispatchEvent(new CustomEvent(evt.replace('.', '-'), { detail }));
        } catch { /* ignore */ }
      },
    });
  }

  // ── Connection ────────────────────────────────────────────

  connect() {
    if (!this._conn) this._initServices();
    this._connState = 'connecting';
    this.requestUpdate();
    this._conn?.connect();
  }

  disconnect() { this._conn?.disconnect(); this._connState = 'disconnected'; }

  reconnect() { this._conn?.reconnect(); this._connState = 'connecting'; this.requestUpdate(); }

  // ── Route ─────────────────────────────────────────────────

  private async _handleRouteChange() {
    const route = this.route;
    if (!route) return;

    const keyFromUrl = this._sessionMgr?.parseSessionFromHash() ?? null;

    if (route.type === 'recent') {
      if (keyFromUrl) { await this._loadSessionById(keyFromUrl); return; }
      await this._loadSessions(true);
      return;
    }
    if (route.type === 'new') { await this._createSession(); return; }
    if (route.type === 'session') {
      this._lastLoadedKey = null;
      await this._loadSessionById(route.sessionKey);
    }
  }

  // ── Sessions ──────────────────────────────────────────────

  private async _loadSessions(autoLoad: boolean) {
    if (!this._sessionMgr) return;
    try {
      this._sessions = await this._sessionMgr.loadSessions();
      if (!autoLoad) return;

      const withMsgs = this._sessions.filter((s: any) => s.messageCount > 0);
      const target = withMsgs[0] ?? this._sessions[0];
      if (target) {
        await this._loadSessionById(target.key);
        const keyFromUrl = this._sessionMgr.parseSessionFromHash();
        if (!keyFromUrl) this._sessionMgr.updateUrl(target.key);
      } else {
        await this._createSession();
      }
    } catch (err) {
      console.error('[ChatPanel] loadSessions failed:', err);
    }
  }

  private async _loadSessionById(key: string, offset = 0) {
    if (!this._sessionMgr) return;
    if (offset === 0) this._loadingSession = false;
    if (this._loadingSession) return;
    this._loadingSession = true;

    try {
      const { messages, hasMore } = await this._sessionMgr.loadSession(key, offset);
      this._sessionKey = key;
      this._hasMore = hasMore;

      if (offset > 0) {
        const existing = new Set(this._messages.map(m => m.timestamp));
        this._messages = [...messages.filter(m => !existing.has(m.timestamp)), ...this._messages];
      } else {
        this._messages = messages;
        this._scrollToBottom(false);
      }
      this.requestUpdate();
    } catch (err: any) {
      if (offset === 0) await this._fallbackToRecent();
    } finally {
      this._loadingSession = false;
    }
  }

  private async _fallbackToRecent() {
    await this._loadSessions(false);
    const target = this._sessions.find((s: any) => s.messageCount > 0) ?? this._sessions[0];
    if (target) {
      this._sessionKey = target.key;
      this._messages = [];
      this._sessionMgr?.updateUrl(target.key);
      await this._loadSessionById(target.key);
    } else {
      await this._createSession();
    }
  }

  async _createSession() {
    if (!this._sessionMgr) return;
    await this._loadSessions(false);
    const empty = this._sessions.find((s: any) => s.messageCount === 0);
    if (empty) {
      this._sessionKey = empty.key;
      this._messages = [];
      this._lastLoadedKey = empty.key;
      this._sessionMgr.updateUrl(empty.key);
      return;
    }
    try {
      const session = await this._sessionMgr.createSession();
      this._sessionKey = session.key;
      this._messages = [];
      this._sessions = [session, ...this._sessions];
      this._lastLoadedKey = session.key;
      this._sessionMgr.updateUrl(session.key);
      this._scrollToBottom();
      this.requestUpdate();
    } catch (err) {
      console.error('[ChatPanel] createSession failed:', err);
    }
  }

  // ── Messaging ─────────────────────────────────────────────

  async sendMessage(content: string, attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>, thinkingLevel?: string) {
    if (this._isSending || this._streaming) return;
    if (!content.trim() && !attachments?.length) return;
    if (!this._sender) return;

    this._isSending = true;
    this._messages = [...this._messages, { role: 'user', content: content ? [{ type: 'text', text: content }] : [], attachments, timestamp: Date.now() }];
    this._atBottom = true;
    this._scrollToBottom();
    this.requestUpdate();

    try {
      await this._sender.send(content, this._sessionKey || 'default', attachments, thinkingLevel, {
        onStreamStart: () => { this._streaming = true; this.requestUpdate(); if (this._atBottom) this._scrollToBottom(); },
        onToken: (delta) => this._appendToken(delta),
        onThinking: (content, isDelta) => this._updateThinking(content, isDelta),
        onThinkingEnd: () => { if (this._streamingMsg) { this._streamingMsg.thinkingStreaming = false; } },
        onToolStart: (toolName, args) => { this._ensureStreamingMsg(); this._toolCalls = [...this._toolCalls, { toolName, args, status: 'running' }]; this.requestUpdate(); },
        onToolEnd: (toolName, isError, result) => {
          this._toolCalls = this._toolCalls.map(t => t.toolName === toolName ? { ...t, status: isError ? 'error' : 'done', result } : t);
          this.requestUpdate();
        },
        onProgress: (p) => { this._progress = p; this.requestUpdate(); if (this._atBottom) this._scrollToBottom(); },
        onResult: () => this._finalizeMessage(),
        onError: (msg) => { this._error = msg; this._streaming = false; this._isSending = false; this._streamingMsg = null; this._progress = null; this.requestUpdate(); },
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        this._error = err instanceof Error ? err.message : t('errors.sendFailed');
        this._streaming = false;
        this._streamingMsg = null;
        this.requestUpdate();
      }
    } finally {
      this._isSending = false;
    }
  }

  abort() {
    this._sender?.abort();
    this._streaming = false;
    this._isSending = false;
    this._streamingMsg = null;
    this._toolCalls = [];
    this.requestUpdate();
  }

  private _appendToken(delta: string) {
    if (this._streamingMsg) {
      const block = this._streamingMsg.content.find(b => b.type === 'text');
      if (block) block.text = (block.text || '') + delta;
      else this._streamingMsg.content.push({ type: 'text', text: delta });
    } else {
      this._streamingMsg = { role: 'assistant', content: [{ type: 'text', text: delta }], timestamp: Date.now() };
    }
    this._streaming = true;
    this.requestUpdate();
    if (this._atBottom) this._scrollToBottom();
  }

  private _updateThinking(content: string, isDelta: boolean) {
    if (!this._streamingMsg) {
      this._streamingMsg = { role: 'assistant', content: [], timestamp: Date.now(), thinking: '', thinkingStreaming: true };
    }
    this._streamingMsg.thinking = isDelta ? (this._streamingMsg.thinking || '') + content : content;
    this._streamingMsg.thinkingStreaming = true;
    this.requestUpdate();
    if (this._atBottom) this._scrollToBottom();
  }

  private _ensureStreamingMsg() {
    if (!this._streamingMsg) {
      this._streamingMsg = { role: 'assistant', content: [], timestamp: Date.now() };
      this._streaming = true;
    }
  }

  private _finalizeMessage() {
    if (this._streamingMsg) {
      this._streamingMsg.thinkingStreaming = false;
      this._messages = [...this._messages, this._streamingMsg];
      this._streamingMsg = null;
    }
    this._streaming = false;
    this._progress = null;
    this._isSending = false;
    this._toolCalls = [];
    if (this._atBottom) this._scrollToBottom();
    this.requestUpdate();
  }

  // ── Scroll ────────────────────────────────────────────────

  private _onScroll = () => {
    if (!this._messagesEl) return;
    const { scrollTop, scrollHeight, clientHeight } = this._messagesEl;
    const fromBottom = scrollHeight - scrollTop - clientHeight;
    if (clientHeight < this._lastClientHeight) { this._lastClientHeight = clientHeight; return; }
    if (scrollTop !== 0 && scrollTop < this._lastScrollTop && fromBottom > 50) this._atBottom = false;
    else if (fromBottom < 10) this._atBottom = true;
    this._lastScrollTop = scrollTop;
    this._lastClientHeight = clientHeight;
    if (scrollTop < 100 && !this._atBottom && this._hasMore && !this._loadingMore) this._loadMore();
  };

  private _scrollToBottom(smooth = true) {
    this.updateComplete.then(() => {
      this._messagesEl?.scrollTo({ top: this._messagesEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  }

  private async _loadMore() {
    if (!this._sessionKey || this._loadingMore || !this._hasMore) return;
    this._loadingMore = true;
    try { await this._loadSessionById(this._sessionKey, this._messages.length); }
    finally { this._loadingMore = false; }
  }

  // ── Public API ────────────────────────────────────────────

  get connectionState() { return this._connState; }
  get messages() { return this._messages; }
  clearMessages() { this._messages = []; this.requestUpdate(); }

  public async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.config) throw new Error('Not configured');
    const { apiUrl, authHeaders } = await import('./helpers.js');
    const res = await fetch(apiUrl(path), { method, headers: authHeaders(this.config.token), body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${res.status}`); }
    return res.json();
  }

  // ── Render ────────────────────────────────────────────────

  override render() {
    return html`
      ${this._renderStatus()}
      ${this._renderHeader()}
      <div class="chat-messages">
        <div class="chat-messages-inner">${this._renderMessages()}</div>
      </div>
      ${!this._atBottom ? html`
        <button class="scroll-to-bottom-btn" style="position:fixed;right:1.5rem;bottom:120px;width:48px;height:48px;border-radius:50%;background:#3b82f6;color:white;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:100;" @click=${() => this._scrollToBottom()} title="Scroll to bottom">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>` : ''}
      <div class="chat-input-container">
        <div class="chat-input-inner">${this._renderInput()}</div>
      </div>
    `;
  }

  private _renderHeader() {
    return html`
      <div class="chat-header">
        <div class="chat-header-title">
          <span class="font-semibold">${t('chat.title') || 'XopcBot'}</span>
          ${this._sessionKey ? html`<span class="text-xs text-muted ml-2">${this._sessions.find(s => s.key === this._sessionKey)?.name || this._sessionKey}</span>` : ''}
        </div>
        <button class="new-session-btn" @click=${() => this._createSession()}>
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>${t('chat.newSession') || 'New Chat'}</span>
        </button>
      </div>
    `;
  }

  private _renderStatus() {
    if (this._connState === 'error' && this._error) return html`
      <div class="status-bar error">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>${this._error}</span>
        <button class="underline ml-auto" @click=${() => this.reconnect()}>${t('chat.retry')}</button>
      </div>`;
    if (this._connState === 'reconnecting' || this._connState === 'connecting') return html`
      <div class="status-bar warning">
        <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
        <span>${this._connState === 'reconnecting' ? t('chat.reconnecting') : t('chat.connecting')}</span>
      </div>`;
    return null;
  }

  private _renderMessages() {
    if (!this._messages.length && !this._streaming) return html`
      <div class="empty-state" style="padding-top:30vh;">
        <div class="icon">🤖</div>
        <div class="title">${t('chat.welcomeTitle')}</div>
        <div class="description">${t('chat.welcomeDescription')}</div>
      </div>`;
    return html`
      <div class="flex flex-col gap-4">
        ${this._messages.map(m => this._renderMessage(m))}
        ${this._streaming && this._streamingMsg ? this._renderStreamingMessage() : ''}
      </div>`;
  }

  private _renderMessage(msg: Message) {
    const isUser = msg.role === 'user';
    if (!msg.content?.some(b => b.text) && !msg.attachments?.length) return null;
    return html`
      <div class="message-item ${isUser ? 'flex-row-reverse' : ''}">
        <div class="avatar ${isUser ? 'user' : 'assistant'}">${isUser ? t('chat.you').charAt(0) : 'X'}</div>
        <div class="flex flex-col gap-1 max-w-[calc(100%-3rem)]">
          <div class="flex items-center gap-2 text-xs text-muted ${isUser ? 'flex-row-reverse' : ''}">
            <span class="font-medium">${isUser ? t('chat.you') : t('chat.assistant')}</span>
            <span>·</span>
            <span>${formatTime(msg.timestamp)}</span>
          </div>
          <div class="message-bubble ${isUser ? 'user' : 'assistant'}">
            ${this._renderContent(msg.content)}
            ${msg.attachments?.length ? this._renderAttachments(msg.attachments) : ''}
          </div>
        </div>
      </div>`;
  }

  private _renderStreamingMessage() {
    const content = this._streamingMsg?.content || [];
    const hasText = content.some(b => b.type === 'text' && b.text);
    return html`
      <div class="message-item">
        <div class="avatar assistant">X</div>
        <div class="flex flex-col gap-1 max-w-[calc(100%-3rem)]">
          <div class="flex items-center gap-2 text-xs text-muted">
            <span class="font-medium">${t('chat.assistant')}</span><span>·</span>
            ${this._renderProgress()}
          </div>
          <div class="message-bubble assistant">
            ${this._renderThinkingBlock()}
            ${this._renderToolCalls()}
            <div class="markdown-content">
              ${content.map(b => b.type === 'text' && b.text ? html`<markdown-renderer .content=${b.text}></markdown-renderer><span class="streaming-cursor"></span>` : '')}
              ${!hasText && !this._toolCalls.length && !this._streamingMsg?.thinkingStreaming ? html`<span class="streaming-cursor"></span>` : ''}
            </div>
          </div>
        </div>
      </div>`;
  }

  private _renderThinkingBlock() {
    if (!this._streamingMsg?.thinking && !this._streamingMsg?.thinkingStreaming) return null;
    return html`
      <div class="thinking-block mb-2">
        <div class="flex items-center gap-2 text-xs text-muted mb-1"><span class="animate-pulse">💭</span><span>Thinking...</span></div>
        ${this._streamingMsg?.thinking ? html`<div class="text-sm text-muted italic">${this._streamingMsg.thinking}</div>` : ''}
      </div>`;
  }

  private _renderToolCalls() {
    if (!this._toolCalls.length) return null;
    return html`
      <div class="tool-calls flex flex-col gap-2 mb-2">
        ${this._toolCalls.map(t => html`
          <div class="tool-call-card bg-surface rounded-lg p-3 border border-border">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-lg">${t.status === 'running' ? '⚙️' : t.status === 'done' ? '✅' : '❌'}</span>
              <span class="font-medium text-sm">${t.toolName}</span>
              <span class="text-xs text-muted ml-auto">${t.status === 'running' ? 'Running...' : t.status === 'done' ? 'Done' : 'Error'}</span>
            </div>
            ${t.args ? html`<details class="text-xs"><summary class="cursor-pointer text-muted hover:text-primary">Arguments</summary><pre class="mt-1 p-2 bg-background rounded overflow-auto max-h-[120px]"><code>${JSON.stringify(t.args, null, 2)}</code></pre></details>` : ''}
            ${t.result ? html`<div class="mt-2 text-xs"><div class="text-muted">Result:</div><pre class="mt-1 p-2 bg-background rounded overflow-auto max-h-[80px] opacity-80"><code>${t.result}</code></pre></div>` : ''}
          </div>`)}
      </div>`;
  }

  private _renderProgress() {
    if (this._progress) {
      const emojis: Record<string, string> = { thinking: '🤔', searching: '🔍', reading: '📖', writing: '✍️', executing: '⚙️', analyzing: '📊', idle: '💬' };
      return html`<span class="text-accent animate-pulse">${emojis[this._progress.stage] || '💬'} ${this._progress.message}</span>`;
    }
    return html`<span class="text-primary animate-pulse">${t('chat.thinking')}</span>`;
  }

  private _renderContent(content: Array<{ type: string; text?: string }>) {
    if (!content?.length) return null;
    return html`<div class="markdown-content">${content.map(b => b.type === 'text' && b.text ? html`<markdown-renderer .content=${b.text}></markdown-renderer>` : '')}</div>`;
  }

  private _renderAttachments(attachments: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>) {
    const images = attachments.filter(a => a.type === 'image' || a.mimeType?.startsWith('image/'));
    const docs = attachments.filter(a => a.type !== 'image' && !a.mimeType?.startsWith('image/'));
    return html`
      <div class="flex flex-col gap-2 mt-2">
        ${images.length ? this._renderImages(images) : ''}
        ${docs.length ? html`<div class="flex flex-col gap-2">${docs.map(d => this._renderDoc(d))}</div>` : ''}
      </div>`;
  }

  private _renderImages(images: Array<{ data?: string; name?: string }>) {
    const cls = ['', 'single', 'double', 'triple', 'quad'][Math.min(images.length, 4)];
    return html`<div class="image-gallery ${cls}">${images.map(img => html`<img src="${img.data}" alt="${img.name || 'Image'}" />`)}</div>`;
  }

  private _renderDoc(doc: { mimeType?: string; name?: string; size?: number }) {
    const color = doc.mimeType?.includes('pdf') ? '#ef4444' : doc.mimeType?.includes('word') ? '#2563eb' : doc.mimeType?.includes('sheet') ? '#16a34a' : 'currentColor';
    return html`
      <div class="document-preview">
        <div class="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg></div>
        <div class="info"><div class="name">${doc.name || 'Document'}</div><div class="meta">${doc.size ? formatFileSize(doc.size) : doc.mimeType || 'File'}</div></div>
      </div>`;
  }

  private _renderInput() {
    return html`
      <message-editor
        .isStreaming=${this._streaming}
        .showAttachmentButton=${this.enableAttachments}
        .showModelSelector=${this.enableModelSelector}
        .showThinkingSelector=${true}
        .thinkingLevel=${this._thinkingLevel}
        .onSend=${(input: string, attachments: Attachment[], level?: string) => {
          if (level) this._thinkingLevel = level as ThinkingLevel;
          const data = attachments?.map(a => ({ type: a.type || 'file', mimeType: a.mimeType, data: a.content, name: a.name, size: a.size }));
          this.sendMessage(input, data, level);
        }}
        .onThinkingChange=${(level: string) => { this._thinkingLevel = level as ThinkingLevel; }}
        .onAbort=${() => this.abort()}
      ></message-editor>`;
  }
}
