import { html, LitElement } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import '../components/MessageEditor.js';
import '../components/ModelSelector.js';
import '../components/MessageList/index.js';
import { t, initI18n } from '../utils/i18n.js';
import { getLanguage } from '../utils/storage.js';
import type { Attachment } from '../utils/attachment-utils.js';
import type { MessageEditor, ThinkingLevel } from '../components/MessageEditor.js';
import type { ChatRoute } from '../navigation.js';
import type { GatewayClientConfig, ProgressState, ConnectionState, SessionInfo } from './types.js';
import { ChatConnection } from './connection.js';
import { SessionManager } from './session.js';
import { MessageSender, pendingAgentRunStorageKey } from './messaging.js';
import type { Message } from '../messages/types.js';
import { modelSupportsReasoning } from '../utils/model-capabilities.js';
import {
  appendThinkingDelta,
  appendTextDelta,
  appendToolStart,
  cloneMessageForRender,
  completeTool,
  ensureAssistantMessage,
  finalizeStreamingThinking,
  startThinkingSegment,
} from '../messages/streaming.js';

export type { GatewayClientConfig, Message, ProgressState, ConnectionState, SessionInfo } from './types.js';

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
  @state() private _sessionModel = '';
  @state() private _modelSupportsThinking = false;

  private _thinkingSupportGen = 0;
  private _conn?: ChatConnection;
  private _sessionMgr?: SessionManager;
  private _sender?: MessageSender;
  private _isSending = false;
  private _lastScrollTop = 0;
  private _lastClientHeight = 0;
  private _routeHandled = false;
  private _lastLoadedKey: string | null = null;
  private _loadingSession = false;

  createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.classList.add('chat-shell');
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

  private _initServices() {
    if (!this.config) return;
    this._sessionMgr = new SessionManager(this.config);
    this._sender = new MessageSender(this.config);
    this._conn = new ChatConnection(this.config, {
      onConnected: () => {
        this._connState = 'connected';
        this._error = null;
        this._reconnectCount = 0;
        this._loadSessions(false);
        this.requestUpdate();
      },
      onReconnecting: () => {
        this._connState = 'reconnecting';
        this.requestUpdate();
      },
      onDisconnected: () => {
        this._connState = 'disconnected';
        this.requestUpdate();
      },
      onError: (msg) => {
        this._error = msg;
        this._connState = 'error';
        this.requestUpdate();
      },
      onEvent: (evt, data) => {
        try {
          const detail = JSON.parse(data);
          this.dispatchEvent(new CustomEvent(evt.replace('.', '-'), { detail }));
        } catch {
          /* ignore */
        }
      },
    });
  }

  connect() {
    if (!this._conn) this._initServices();
    this._connState = 'connecting';
    this.requestUpdate();
    this._conn?.connect();
  }

  disconnect() {
    this._conn?.disconnect();
    this._connState = 'disconnected';
  }

  reconnect() {
    this._conn?.reconnect();
    this._connState = 'connecting';
    this.requestUpdate();
  }

  private async _refreshModelThinkingSupport(modelId: string): Promise<void> {
    const gen = ++this._thinkingSupportGen;
    if (!modelId.trim()) {
      if (gen === this._thinkingSupportGen) {
        this._modelSupportsThinking = false;
        this.requestUpdate();
      }
      return;
    }
    const supports = await modelSupportsReasoning(modelId, this.config?.token);
    if (gen !== this._thinkingSupportGen) return;
    this._modelSupportsThinking = supports;
    this.requestUpdate();
  }

  private async _handleRouteChange() {
    const route = this.route;
    if (!route) return;

    const keyFromUrl = this._sessionMgr?.parseSessionFromHash() ?? null;

    if (route.type === 'recent') {
      if (keyFromUrl) {
        await this._loadSessionById(keyFromUrl);
        return;
      }
      await this._loadSessions(true);
      return;
    }
    if (route.type === 'new') {
      await this._createSession();
      return;
    }
    if (route.type === 'session') {
      if (route.sessionKey === this._lastLoadedKey) {
        return;
      }
      await this._loadSessionById(route.sessionKey);
    }
  }

  private async _loadSessions(autoLoad: boolean) {
    if (!this._sessionMgr) return;
    try {
      this._sessions = await this._sessionMgr.loadSessions();
      if (!autoLoad) return;

      const withMsgs = this._sessions.filter((s: SessionInfo) => (s.messageCount ?? 0) > 0);
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

  private _notifySessionRoute(sessionKey: string) {
    this.dispatchEvent(
      new CustomEvent<ChatRoute>('route-change', {
        detail: { type: 'session', sessionKey },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async _loadSessionById(key: string, offset = 0) {
    if (!this._sessionMgr) return;
    if (offset === 0 && key === this._sessionKey && (this._isSending || this._streaming)) {
      return;
    }
    if (offset === 0) this._loadingSession = false;
    if (this._loadingSession) return;
    this._loadingSession = true;

    try {
      const { messages, hasMore } = await this._sessionMgr.loadSession(key, offset);
      this._sessionKey = key;
      this._hasMore = hasMore;

      if (offset > 0) {
        const existing = new Set(this._messages.map((m) => m.timestamp));
        this._messages = [...messages.filter((m) => !existing.has(m.timestamp)), ...this._messages];
      } else {
        this._messages = messages;
        this._lastLoadedKey = key;
        this._notifySessionRoute(key);
        try {
          const cfg = await this._sessionMgr.loadSessionAgentConfig(key);
          this._thinkingLevel = cfg.thinkingLevel as ThinkingLevel;
          this._sessionModel = cfg.model || '';
        } catch {
          /* keep pill; gateway may be older */
        }
        void this._refreshModelThinkingSupport(this._sessionModel);
      }
      this._atBottom = true;
      this.requestUpdate();
      if (offset === 0) this._scrollToBottom(false);
      if (offset === 0) this._tryResumeAgentRun(key);
    } catch (_err: unknown) {
      if (offset === 0) await this._fallbackToRecent();
    } finally {
      this._loadingSession = false;
    }
  }

  private async _onSessionModelChange(modelId: string) {
    if (!this._sessionKey || !this.config) return;
    try {
      const { apiUrl, authHeaders } = await import('./helpers.js');
      const res = await fetch(
        apiUrl(`/api/sessions/${encodeURIComponent(this._sessionKey)}/agent-config`),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeaders(this.config.token) },
          body: JSON.stringify({ model: modelId }),
        },
      );
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error || `HTTP ${res.status}`);
      }
      this._sessionModel = modelId;
      void this._refreshModelThinkingSupport(modelId);
      this._error = null;
      this.requestUpdate();
    } catch (err) {
      console.error('[ChatPanel] Failed to set session model:', err);
      this._error = err instanceof Error ? err.message : t('errors.modelSwitchFailed');
      this.requestUpdate();
    }
  }

  private async _fallbackToRecent() {
    await this._loadSessions(false);
    const target =
      this._sessions.find((s: SessionInfo) => (s.messageCount ?? 0) > 0) ?? this._sessions[0];
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
    const empty = this._sessions.find((s: SessionInfo) => (s.messageCount ?? 0) === 0);
    if (empty) {
      this._sessionKey = empty.key;
      this._messages = [];
      this._lastLoadedKey = empty.key;
      this._sessionMgr.updateUrl(empty.key);
      this._notifySessionRoute(empty.key);
      try {
        const cfg = await this._sessionMgr.loadSessionAgentConfig(empty.key);
        this._thinkingLevel = cfg.thinkingLevel as ThinkingLevel;
        this._sessionModel = cfg.model || '';
      } catch {
        /* ignore */
      }
      void this._refreshModelThinkingSupport(this._sessionModel);
      return;
    }
    try {
      const session = await this._sessionMgr.createSession();
      this._sessionKey = session.key;
      this._messages = [];
      this._sessions = [session, ...this._sessions];
      this._lastLoadedKey = session.key;
      this._sessionMgr.updateUrl(session.key);
      this._notifySessionRoute(session.key);
      try {
        const cfg = await this._sessionMgr.loadSessionAgentConfig(session.key);
        this._thinkingLevel = cfg.thinkingLevel as ThinkingLevel;
        this._sessionModel = cfg.model || '';
      } catch {
        /* ignore */
      }
      void this._refreshModelThinkingSupport(this._sessionModel);
      this.requestUpdate();
      this._scrollToBottom();
    } catch (err) {
      console.error('[ChatPanel] createSession failed:', err);
    }
  }

  private get _displayMessages(): Message[] {
    const list = [...this._messages];
    if (this._streamingMsg) {
      list.push(this._streamingMsg);
    }
    return list;
  }

  async sendMessage(
    content: string,
    attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>,
    thinkingLevel?: string,
  ) {
    if (this._isSending || this._streaming) return;
    if (!content.trim() && !attachments?.length) return;
    if (!this._sender) return;

    this._isSending = true;
    this._messages = [
      ...this._messages,
      {
        role: 'user',
        content: content ? [{ type: 'text', text: content }] : [],
        attachments,
        timestamp: Date.now(),
      },
    ];
    this._atBottom = true;
    this.requestUpdate();
    this._scrollToBottom();
    await this.updateComplete;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const effectiveThinking = this._modelSupportsThinking
      ? (thinkingLevel ?? this._thinkingLevel)
      : 'off';

    try {
      await this._sender.send(content, this._sessionKey || 'default', attachments, effectiveThinking, {
        onStreamStart: () => {
          this._streaming = true;
          const msg = ensureAssistantMessage(this._streamingMsg, Date.now());
          this._streamingMsg = cloneMessageForRender(msg);
          this.requestUpdate();
          if (this._atBottom) this._scrollToBottom();
        },
        onToken: (delta) => this._appendToken(delta),
        onThinking: (c, isDelta) => this._updateThinking(c, isDelta),
        onThinkingEnd: () => {
          if (this._streamingMsg) {
            const msg = ensureAssistantMessage(this._streamingMsg, Date.now());
            finalizeStreamingThinking(msg.content);
            this._streamingMsg = cloneMessageForRender(msg);
            this.requestUpdate();
          }
        },
        onToolStart: (toolName, args) => {
          const msg = ensureAssistantMessage(this._streamingMsg, Date.now());
          appendToolStart(msg.content, toolName, args);
          this._streamingMsg = cloneMessageForRender(msg);
          this._streaming = true;
          this.requestUpdate();
        },
        onToolEnd: (toolName, isError, result) => {
          const msg = ensureAssistantMessage(this._streamingMsg, Date.now());
          completeTool(msg.content, toolName, isError, result);
          this._streamingMsg = cloneMessageForRender(msg);
          this.requestUpdate();
        },
        onProgress: (p) => {
          this._progress = p;
          this.requestUpdate();
          if (this._atBottom) this._scrollToBottom();
        },
        onResult: () => this._finalizeMessage(),
        onError: (msg) => {
          this._error = msg;
          this._streaming = false;
          this._isSending = false;
          this._streamingMsg = null;
          this._progress = null;
          this.requestUpdate();
        },
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
    this._progress = null;
    this.requestUpdate();
  }

  private _tryResumeAgentRun(chatId: string): void {
    if (!this._sender || this._isSending || this._streaming) return;
    let stored: { runId: string } | null = null;
    try {
      const raw = sessionStorage.getItem(pendingAgentRunStorageKey(chatId));
      if (raw) stored = JSON.parse(raw);
    } catch { /* ignore */ }
    if (!stored?.runId) return;

    const { runId } = stored;
    this._isSending = true;
    this._streaming = true;
    this.requestUpdate();

    this._sender.resume(runId, chatId, {
      onStreamStart: () => {
        const msg = ensureAssistantMessage(this._streamingMsg, Date.now());
        this._streamingMsg = cloneMessageForRender(msg);
        this.requestUpdate();
        if (this._atBottom) this._scrollToBottom();
      },
      onToken: (delta) => this._appendToken(delta),
      onThinking: (c, isDelta) => this._updateThinking(c, isDelta),
      onThinkingEnd: () => {
        if (this._streamingMsg) {
          const msg = ensureAssistantMessage(this._streamingMsg, Date.now());
          finalizeStreamingThinking(msg.content);
          this._streamingMsg = cloneMessageForRender(msg);
          this.requestUpdate();
        }
      },
      onToolStart: (toolName, args) => {
        const msg = ensureAssistantMessage(this._streamingMsg, Date.now());
        appendToolStart(msg.content, toolName, args);
        this._streamingMsg = cloneMessageForRender(msg);
        this._streaming = true;
        this.requestUpdate();
      },
      onToolEnd: (toolName, isError, result) => {
        const msg = ensureAssistantMessage(this._streamingMsg, Date.now());
        completeTool(msg.content, toolName, isError, result);
        this._streamingMsg = cloneMessageForRender(msg);
        this.requestUpdate();
      },
      onProgress: (p) => {
        this._progress = p;
        this.requestUpdate();
        if (this._atBottom) this._scrollToBottom();
      },
      onResult: () => this._finalizeMessage(),
      onError: (msg) => {
        this._error = msg;
        this._streaming = false;
        this._isSending = false;
        this._streamingMsg = null;
        this._progress = null;
        this.requestUpdate();
      },
    }).catch((err) => {
      if ((err as Error).name !== 'AbortError') {
        console.error('[ChatPanel] resume failed:', err);
      }
      this._streaming = false;
      this._isSending = false;
      this._streamingMsg = null;
      this._progress = null;
      this.requestUpdate();
    });
  }

  private _appendToken(delta: string) {
    const msg = ensureAssistantMessage(this._streamingMsg, Date.now());
    appendTextDelta(msg.content, delta);
    this._streamingMsg = cloneMessageForRender(msg);
    this._streaming = true;
    this.requestUpdate();
    if (this._atBottom) this._scrollToBottom();
  }

  private _updateThinking(content: string, isDelta: boolean) {
    const msg = ensureAssistantMessage(this._streamingMsg, Date.now());
    if (!isDelta && content === '') {
      startThinkingSegment(msg.content);
    } else {
      appendThinkingDelta(msg.content, content, isDelta);
    }
    this._streamingMsg = cloneMessageForRender(msg);
    this.requestUpdate();
    if (this._atBottom) this._scrollToBottom();
  }

  private _finalizeMessage() {
    if (this._streamingMsg) {
      const msg = ensureAssistantMessage(this._streamingMsg, Date.now());
      finalizeStreamingThinking(msg.content);
      this._messages = [...this._messages, cloneMessageForRender(msg)];
      this._streamingMsg = null;
    }
    this._streaming = false;
    this._progress = null;
    this._isSending = false;
    this.requestUpdate();
    if (this._atBottom) this._scrollToBottom();
  }

  private _onScroll = () => {
    if (!this._messagesEl) return;
    const { scrollTop, scrollHeight, clientHeight } = this._messagesEl;
    const fromBottom = scrollHeight - scrollTop - clientHeight;
    if (clientHeight < this._lastClientHeight) {
      this._lastClientHeight = clientHeight;
      return;
    }
    if (scrollTop !== 0 && scrollTop < this._lastScrollTop && fromBottom > 50) this._atBottom = false;
    else if (fromBottom < 10) this._atBottom = true;
    this._lastScrollTop = scrollTop;
    this._lastClientHeight = clientHeight;
    if (scrollTop < 100 && !this._atBottom && this._hasMore && !this._loadingMore) this._loadMore();
  };

  /**
   * Scroll the message pane to the bottom after nested list/bubbles finish layout.
   * ChatPanel.updateComplete alone can run before child Lit elements have measured height.
   */
  private _scrollToBottom(smooth = true) {
    void this._scrollToBottomAfterLayout(smooth);
  }

  private async _scrollToBottomAfterLayout(smooth: boolean) {
    try {
      await this.updateComplete;
      const list = this.querySelector('message-list');
      if (list && 'updateComplete' in list) {
        await (list as LitElement).updateComplete;
      }
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));

      const el = this._messagesEl;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });

      const before = el.scrollHeight;
      requestAnimationFrame(() => {
        if (!this._messagesEl) return;
        if (this._messagesEl.scrollHeight > before) {
          this._messagesEl.scrollTo({
            top: this._messagesEl.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto',
          });
        }
      });
    } catch {
      /* ignore */
    }
  }

  private async _loadMore() {
    if (!this._sessionKey || this._loadingMore || !this._hasMore) return;
    this._loadingMore = true;
    try {
      await this._loadSessionById(this._sessionKey, this._messages.length);
    } finally {
      this._loadingMore = false;
    }
  }

  get connectionState() {
    return this._connState;
  }
  get messages() {
    return this._messages;
  }
  clearMessages() {
    this._messages = [];
    this.requestUpdate();
  }

  public async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.config) throw new Error('Not configured');
    const { apiUrl, authHeaders } = await import('./helpers.js');
    const res = await fetch(apiUrl(path), {
      method,
      headers: authHeaders(this.config.token),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error?.message || `HTTP ${res.status}`);
    }
    return res.json();
  }

  override render() {
    return html`
      <div class="chat-layout">
        <div class="chat-top">
          ${this._renderStatus()}
          ${this._renderHeader()}
        </div>
        <div class="chat-messages">
          <div class="chat-messages-inner">${this._renderMessages()}</div>
        </div>
        <div class="chat-input-container">
          <div class="chat-input-inner">${this._renderInput()}</div>
        </div>
      </div>
      ${!this._atBottom
        ? html`
            <button
              type="button"
              class="scroll-to-bottom-btn chat-scroll-fab"
              @click=${() => this._scrollToBottom()}
              title="Scroll to bottom"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          `
        : ''}
    `;
  }

  private _renderHeader() {
    const showModelPicker = this.enableModelSelector && !!this._sessionKey;
    return html`
      <div class="chat-header">
        <div class="chat-header-title">
          <span class="chat-header-brand">${t('chat.title') || 'XopcBot'}</span>
          ${this._sessionKey
            ? html`<span class="chat-header-session-id" title=${this._sessionKey}>${this._sessionKey}</span>`
            : ''}
        </div>
        ${showModelPicker
          ? html`
              <div class="chat-header-model-picker" title=${t('chat.currentModel')}>
                <model-selector
                  .compact=${true}
                  .value=${this._sessionModel || ''}
                  .label=${''}
                  .placeholder=${t('chat.modelPlaceholder')}
                  .filter=${'configured'}
                  .token=${this.config?.token}
                  .disabled=${this._streaming}
                  @change=${(e: CustomEvent<{ modelId: string }>) => {
                    const id = e.detail?.modelId;
                    if (id && id !== this._sessionModel) {
                      void this._onSessionModelChange(id);
                    }
                  }}
                ></model-selector>
              </div>
            `
          : ''}
        <button class="new-session-btn" @click=${() => this._createSession()}>
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>${t('chat.newSession') || 'New Chat'}</span>
        </button>
      </div>
    `;
  }

  private _renderStatus() {
    if (this._connState === 'error' && this._error) {
      return html`
        <div class="status-bar error">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>${this._error}</span>
          <button type="button" class="chat-status-retry" @click=${() => this.reconnect()}>${t('chat.retry')}</button>
        </div>
      `;
    }
    if (this._connState === 'reconnecting' || this._connState === 'connecting') {
      return html`
        <div class="status-bar warning">
          <span class="status-bar__spinner" aria-hidden="true"></span>
          <span>${this._connState === 'reconnecting' ? t('chat.reconnecting') : t('chat.connecting')}</span>
        </div>
      `;
    }
    return null;
  }

  private _renderMessages() {
    const list = this._displayMessages;
    const streamingLast = this._streaming && !!this._streamingMsg;

    if (!list.length && !this._streaming) {
      return html`
        <div class="chat-empty-state">
          <div class="chat-empty-state__icon" aria-hidden="true">🤖</div>
          <div class="chat-empty-state__title">${t('chat.welcomeTitle')}</div>
          <div class="chat-empty-state__description">${t('chat.welcomeDescription')}</div>
        </div>
      `;
    }

    return html`
      <message-list
        .messages=${list}
        .isStreaming=${streamingLast}
        .progress=${streamingLast ? this._progress : null}
        .useVirtualScroll=${false}
      ></message-list>
    `;
  }

  private _renderInput() {
    return html`
      <message-editor
        .isStreaming=${this._streaming}
        .showAttachmentButton=${this.enableAttachments}
        .showModelSelector=${false}
        .showThinkingSelector=${this._modelSupportsThinking}
        .thinkingLevel=${this._thinkingLevel}
        .onSend=${(input: string, attachments: Attachment[], level?: string) => {
          if (level) this._thinkingLevel = level as ThinkingLevel;
          const data = attachments?.map((a) => ({
            type: a.type || 'file',
            mimeType: a.mimeType,
            data: a.content,
            name: a.name,
            size: a.size,
          }));
          this.sendMessage(input, data, level);
        }}
        .onThinkingChange=${(level: string) => {
          this._thinkingLevel = level as ThinkingLevel;
        }}
        .onAbort=${() => this.abort()}
      ></message-editor>
    `;
  }
}

