import { html, LitElement } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import './components/MessageEditor';
import './components/MessageList';
import './components/StreamingMessageContainer';
import { t, initI18n } from './utils/i18n';
import type { Attachment } from './utils/attachment-utils';
import type { MessageEditor } from './components/MessageEditor';
import type { ChatRoute } from './navigation';

// ---------- Types ----------

export type ChatPayload = {
  type?: 'status' | 'token' | 'error';
  content?: string;
  status?: 'ok' | 'complete' | 'error';
  runId?: string;
  sessionKey?: string;
  message?: unknown;
  errorMessage?: string;
};

export type ErrorPayload = {
  code: string;
  message: string;
};

export type GatewayClientConfig = {
  /** Base HTTP URL, e.g. "http://localhost:3000" */
  url: string;
  token?: string;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
};

interface Message {
  role: 'user' | 'assistant';
  content: Array<{ type: string; text?: string }>;
  attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>;
  timestamp: number;
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

// ---------- Helpers ----------

/** Build an HTTP URL from the config (strip trailing slashes, ensure /api prefix). */
function apiUrl(base: string, path: string): string {
  const clean = base.replace(/\/+$/, '');
  return `${clean}${path}`;
}

function authHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

// ---------- Component ----------

@customElement('xopcbot-gateway-chat')
export class XopcbotGatewayChat extends LitElement {
  @property({ attribute: false }) config?: GatewayClientConfig;
  @property({ attribute: false }) route?: ChatRoute;
  @property({ type: Boolean }) enableAttachments = true;
  @property({ type: Boolean }) enableModelSelector = true;

  @query('message-editor') private _messageEditor!: MessageEditor;
  @query('.chat-messages') private _chatMessages!: HTMLElement;

  @state() private _connectionState: ConnectionState = 'disconnected';
  @state() private _error: string | null = null;
  @state() private _messages: Message[] = [];
  @state() private _isStreaming = false;
  @state() private _streamingContent = '';
  @state() private _streamingMessage: Message | null = null;
  @state() private _reconnectCount = 0;
  @state() private _isAtBottom = true;
  @state() private _currentSessionKey: string | null = null;
  @state() private _sessions: Array<{ key: string; name?: string; updatedAt: string }> = [];
  @state() private _hasMoreMessages = true; // For pagination
  @state() private _isLoadingMore = false;

  /** SSE event source for server-pushed events */
  private _eventSource?: EventSource;
  /** AbortController for the current agent POST request */
  private _agentAbort?: AbortController;
  private _shouldReconnect = true;
  private _isSending = false;
  private _lastLoadedSessionKey: string | null = null;

  // Configurable reconnection settings
  private get _maxReconnectAttempts(): number {
    return this.config?.maxReconnectAttempts ?? 10;
  }

  private get _autoReconnect(): boolean {
    return this.config?.autoReconnect ?? true;
  }

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override async connectedCallback(): Promise<void> {
    super.connectedCallback();
    this.classList.add('chat-container');
    await initI18n('en');
    this.addEventListener('scroll', this._handleScroll as EventListener);
  }

  override updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);
    
    // Connect when config changes and disconnected
    if (changedProperties.has('config') && this.config && this._connectionState === 'disconnected') {
      this.connect();
    }
    
    // Reload session when route changes
    if (changedProperties.has('route') && this.route) {
      this._handleRouteChange();
    }
  }

  /**
   * Handle route changes - load appropriate session
   */
  private async _handleRouteChange(): Promise<void> {
    const route = this.route;
    if (!route) return;
    
    // Get target session key from route
    let targetSessionKey: string | null = null;
    
    switch (route.type) {
      case 'recent':
        // Will load recent in _loadSessions
        break;
      case 'session':
        targetSessionKey = route.sessionKey;
        break;
      case 'new':
        await this._createNewSession();
        return;
    }
    
    // If we have a target session, load it directly
    if (targetSessionKey) {
      if (targetSessionKey !== this._lastLoadedSessionKey) {
        await this._loadSession(targetSessionKey, 0); // Load with offset 0
        this._lastLoadedSessionKey = targetSessionKey;
      }
    } else {
      // Load recent sessions - this will load the most recent one
      await this._loadSessions();
    }
  }

  /**
   * Load session with pagination support
   */
  private async _loadSession(sessionKey: string, offset = 0): Promise<void> {
    if (!this.config) return;

    console.log('[GatewayChat] Loading session:', sessionKey, 'offset:', offset);

    try {
      const url = apiUrl(this.config.url, `/api/sessions/${encodeURIComponent(sessionKey)}?offset=${offset}&limit=50`);
      const headers = authHeaders(this.config.token);
      const res = await fetch(url, { headers });
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const data = await res.json();
      const session = data.session;
      
      this._currentSessionKey = sessionKey;
      
      // Convert session messages to UI format
      const messages = session.messages || [];
      const newMessages = messages
        .filter((msg: any) => msg.role === 'user' || msg.role === 'assistant')
        .map((msg: any) => ({
          role: msg.role,
          content: typeof msg.content === 'string' 
            ? [{ type: 'text', text: msg.content }] 
            : (msg.content || []),
          attachments: msg.attachments,
          timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
        }));
      
      // Handle pagination - prepend if loading older messages
      if (offset > 0) {
        this._messages = [...newMessages, ...this._messages];
      } else {
        this._messages = newMessages;
      }
      
      // Check if there are more messages to load
      this._hasMoreMessages = messages.length >= 50;
      
      // Scroll to bottom only on initial load
      if (offset === 0) {
        this._scrollToBottom();
      }
      this.requestUpdate();
    } catch (err) {
      console.error('[GatewayChat] Failed to load session:', err);
    }
  }

  /**
   * Load more messages when user scrolls to top
   */
  private async _loadMoreMessages(): Promise<void> {
    if (!this._currentSessionKey || this._isLoadingMore || !this._hasMoreMessages) return;
    
    this._isLoadingMore = true;
    const offset = this._messages.length;
    
    try {
      await this._loadSession(this._currentSessionKey, offset);
    } finally {
      this._isLoadingMore = false;
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._shouldReconnect = false;
    this.disconnect();
    this.removeEventListener('scroll', this._handleScroll as EventListener);
  }

  // ========== Scroll handling ==========

  private _handleScroll = (): void => {
    if (!this._chatMessages) return;
    const { scrollTop, scrollHeight, clientHeight } = this._chatMessages;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    
    // Update bottom state
    if (atBottom !== this._isAtBottom) {
      this._isAtBottom = atBottom;
    }
    
    // Load more when scrolling to top
    if (scrollTop < 100 && !this._isAtBottom && this._hasMoreMessages && !this._isLoadingMore) {
      this._loadMoreMessages();
    }
  };

  private _scrollToBottom(): void {
    if (this._chatMessages) {
      this._chatMessages.scrollTop = this._chatMessages.scrollHeight;
    }
  }

  // ========== Connection (SSE for server-push) ==========

  connect(): void {
    if (!this.config || this._connectionState === 'connecting') return;

    this._connectionState = 'connecting';
    this._error = null;
    this.requestUpdate();

    try {
      const eventsUrl = apiUrl(this.config.url, '/api/events');
      const url = new URL(eventsUrl);
      if (this.config.token) url.searchParams.set('token', this.config.token);

      this._eventSource = new EventSource(url.toString());

      // EventSource fires onopen when the connection is established
      this._eventSource.onopen = () => {
        this._connectionState = 'connected';
        this._error = null;
        this._reconnectCount = 0;
        this.requestUpdate();
        // Load sessions after connection is established
        this._loadSessions();
      };

      // Also listen for our custom 'connected' event from the server
      this._eventSource.addEventListener('connected', () => {
        this._connectionState = 'connected';
        this._error = null;
        this.requestUpdate();
      });

      this._eventSource.addEventListener('config.reload', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this.dispatchEvent(new CustomEvent('config-reload', { detail: data }));
        } catch { /* ignore */ }
      });

      this._eventSource.addEventListener('channels.status', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this.dispatchEvent(new CustomEvent('channels-status', { detail: data }));
        } catch { /* ignore */ }
      });

      this._eventSource.addEventListener('message.sent', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this.dispatchEvent(new CustomEvent('message-sent', { detail: data }));
        } catch { /* ignore */ }
      });

      // EventSource auto-reconnects on error. Handle permanent disconnection.
      // readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED
      this._eventSource.onerror = () => {
        if (this._eventSource?.readyState === EventSource.CLOSED) {
          // Permanently closed - EventSource has given up auto-reconnect
          this._connectionState = 'disconnected';
          this._handlePermanentDisconnect();
        } else {
          // CONNECTING - EventSource is auto-reconnecting
          this._connectionState = 'reconnecting';
        }
        this.requestUpdate();
      };
    } catch (err) {
      console.error('[GatewayChat] Failed to create EventSource:', err);
      this._connectionState = 'error';
      this._error = t('errors.connectionError');
      this.requestUpdate();
    }
  }

  private _handlePermanentDisconnect(): void {
    // Reset streaming state if interrupted
    if (this._isStreaming) {
      this._isStreaming = false;
      this._isSending = false;
      this._streamingContent = '';
      this._streamingMessage = null;
    }

    // Auto-reconnect with exponential backoff (EventSource handles it)
    if (this._shouldReconnect && this._autoReconnect) {
      this._reconnectCount++;
      if (this._reconnectCount > this._maxReconnectAttempts) {
        this._error = t('errors.connectionError');
        this._connectionState = 'error';
      }
      // EventSource will auto-reconnect, no manual timer needed
    }
  }

  disconnect(): void {
    this._shouldReconnect = false;
    this._eventSource?.close();
    this._eventSource = undefined;
    this._agentAbort?.abort();
    this._agentAbort = undefined;
    this._connectionState = 'disconnected';
  }

  reconnect(): void {
    this._shouldReconnect = true;
    this._reconnectCount = 0;
    this.disconnect();
    setTimeout(() => this.connect(), 100);
  }

  // ========== Session management ==========

  private async _loadSessions(): Promise<void> {
    if (!this.config) {
      console.warn('[GatewayChat] No config, skipping session load');
      return;
    }

    console.log('[GatewayChat] Loading sessions from', this.config.url);

    try {
      const url = apiUrl(this.config.url, '/api/sessions?limit=20');
      const headers = authHeaders(this.config.token);
      console.log('[GatewayChat] Fetching sessions with token:', !!this.config.token);
      const res = await fetch(url, { headers });
      
      console.log('[GatewayChat] Sessions response status:', res.status);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const data = await res.json();
      console.log('[GatewayChat] Sessions data:', data);
      const sessions = data.items || [];
      
      // Filter gateway sessions and sort by updatedAt (newest first)
      const gatewaySessions = sessions
        .filter((s: any) => s.key.startsWith('gateway:'))
        .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      console.log('[GatewayChat] Gateway sessions:', gatewaySessions);
      
      this._sessions = gatewaySessions;
      
      // Load the most recent session if exists
      if (gatewaySessions.length > 0) {
        const recentKey = gatewaySessions[0].key;
        await this._loadSession(recentKey, 0);
        this._lastLoadedSessionKey = recentKey;
        
        // Update URL to reflect current session
        this._updateUrlWithSession(recentKey);
      } else {
        // No sessions, create a new one
        await this._createNewSession();
      }
    } catch (err) {
      console.error('[GatewayChat] Failed to load sessions:', err);
    }
  }

  /**
   * Update URL hash with session key
   */
  private _updateUrlWithSession(sessionKey: string): void {
    const newHash = `#/chat/${encodeURIComponent(sessionKey)}`;
    if (location.hash !== newHash) {
      history.replaceState(null, '', newHash);
    }
  }

  async _createNewSession(): Promise<void> {
    if (!this.config) return;

    try {
      const url = apiUrl(this.config.url, '/api/sessions');
      const headers = {
        ...authHeaders(this.config.token),
        'Content-Type': 'application/json',
      };
      
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel: 'gateway' }),
      });
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const data = await res.json();
      const session = data.session;
      
      this._currentSessionKey = session.key;
      this._messages = [];
      
      // Add to sessions list
      this._sessions = [{
        key: session.key,
        name: session.name,
        updatedAt: session.updatedAt,
      }, ...this._sessions];
      
      this._currentSessionKey = session.key;
      this._lastLoadedSessionKey = session.key;
      
      // Update URL to reflect new session
      this._updateUrlWithSession(session.key);
      
      this._scrollToBottom();
      this.requestUpdate();
    } catch (err) {
      console.error('[GatewayChat] Failed to create new session:', err);
    }
  }

  // ========== Agent messaging (POST + SSE response) ==========

  async sendMessage(
    content: string,
    attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>,
  ): Promise<void> {
    if (this._isSending || this._isStreaming) return;
    if (!content.trim() && !attachments?.length) return;
    if (!this.config) return;

    this._isSending = true;

    // Add user message to UI
    this._messages = [
      ...this._messages,
      {
        role: 'user',
        content: content ? [{ type: 'text', text: content }] : [],
        attachments,
        timestamp: Date.now(),
      },
    ];
    this._scrollToBottom();
    this.requestUpdate();

    try {
      this._agentAbort = new AbortController();
      const url = apiUrl(this.config.url, '/api/agent');
      const headers = {
        ...authHeaders(this.config.token),
        Accept: 'text/event-stream',
      };

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: content,
          channel: 'gateway',
          chatId: 'default',
          attachments,
        }),
        signal: this._agentAbort.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || `HTTP ${res.status}`);
      }

      const contentType = res.headers.get('Content-Type') || '';

      if (contentType.includes('text/event-stream') && res.body) {
        // --- SSE stream ---
        await this._consumeSSEStream(res.body);
      } else {
        // --- JSON fallback ---
        const json = await res.json();
        if (json.ok && json.payload?.content) {
          this._updateStreamingMessage(json.payload.content);
          this._finalizeMessage();
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return; // user aborted
      this._error = error instanceof Error ? error.message : t('errors.sendFailed');
      this._isStreaming = false;
      this._isSending = false;
      this._streamingMessage = null;
      this.requestUpdate();
    } finally {
      this._agentAbort = undefined;
      this._isSending = false;
    }
  }

  /** Consume a fetch ReadableStream as SSE events. */
  private async _consumeSSEStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    // State for multi-line data handling
    let currentEventType = '';
    let currentEventData = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += value;

        // Process complete lines
        while (buffer.includes('\n')) {
          const newlineIndex = buffer.indexOf('\n');
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.startsWith('event:')) {
            currentEventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            // Append data (support multi-line data)
            currentEventData += (currentEventData ? '\n' : '') + line.slice(5).trim();
          } else if (line === '') {
            // Empty line = event boundary
            if (currentEventData) {
              this._handleSSEEvent(currentEventType || 'message', currentEventData);
              currentEventType = '';
              currentEventData = '';
            }
          }
          // Ignore other lines (id:, retry:, etc.)
        }
      }

      // Process remaining buffer (last event may not have trailing newline)
      if (buffer.trim() || currentEventData) {
        if (buffer.trim()) {
          const lines = buffer.split('\n');
          for (const line of lines) {
            if (line.startsWith('event:')) {
              currentEventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              currentEventData += (currentEventData ? '\n' : '') + line.slice(5).trim();
            } else if (line === '' && currentEventData) {
              this._handleSSEEvent(currentEventType || 'message', currentEventData);
              currentEventType = '';
              currentEventData = '';
            }
          }
        }
        // If we still have unprocessed data, emit it
        if (currentEventData) {
          this._handleSSEEvent(currentEventType || 'message', currentEventData);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private _handleSSEEvent(event: string, data: string): void {
    try {
      const parsed = JSON.parse(data);

      switch (event) {
        case 'status':
          this._isStreaming = true;
          this.requestUpdate();
          break;

        case 'token':
          if (parsed.content) {
            this._updateStreamingMessage(parsed.content);
          }
          break;

        case 'error':
          this._error = parsed.content || parsed.error?.message || t('errors.sendFailed');
          this._isStreaming = false;
          this._isSending = false;
          this._streamingMessage = null;
          this.requestUpdate();
          break;

        case 'result':
          this._finalizeMessage();
          break;

        default:
          // Unknown event type — treat as token if it has content
          if (parsed.content) {
            this._updateStreamingMessage(parsed.content);
          }
          break;
      }
    } catch {
      // Ignore parse errors
    }
  }

  // ========== Streaming message helpers ==========

  private _updateStreamingMessage(content: string): void {
    if (this._streamingMessage) {
      const textBlock = this._streamingMessage.content.find(b => b.type === 'text');
      if (textBlock) {
        textBlock.text = (textBlock.text || '') + content;
      } else {
        this._streamingMessage.content.push({ type: 'text', text: content });
      }
    } else {
      this._streamingMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: content }],
        timestamp: Date.now(),
      };
    }
    this._isStreaming = true;
    this._streamingContent = content;
    this.requestUpdate();
  }

  private _finalizeMessage(): void {
    if (this._streamingMessage) {
      this._messages = [...this._messages, this._streamingMessage];
      this._streamingMessage = null;
    }
    this._isStreaming = false;
    this._streamingContent = '';
    this._isSending = false;
    
    // Auto-scroll to bottom if user is at bottom
    if (this._isAtBottom) {
      this._scrollToBottom();
    }
    this.requestUpdate();
  }

  // ========== Public HTTP API ==========

  /** Generic REST request helper for external components. */
  public async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.config) throw new Error('Not configured');

    const url = apiUrl(this.config.url, path);
    const res = await fetch(url, {
      method,
      headers: authHeaders(this.config.token),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  abort(): void {
    this._agentAbort?.abort();
    this._agentAbort = undefined;
    this._isStreaming = false;
    this._isSending = false;
    this._streamingContent = '';
    this._streamingMessage = null;
    this.requestUpdate();
  }

  // Public getters
  public get connectionState(): ConnectionState {
    return this._connectionState;
  }

  public get messages(): Message[] {
    return this._messages;
  }

  public clearMessages(): void {
    this._messages = [];
    this.requestUpdate();
  }

  // ========== Render ==========

  override render(): unknown {
    return html`
      ${this._renderStatus()}
      ${this._renderHeader()}

      <div class="chat-messages">
        <div class="chat-messages-inner">
          ${this._renderMessages()}
        </div>
        ${!this._isAtBottom ? this._renderScrollToBottomButton() : ''}
      </div>

      <div class="chat-input-container">
        <div class="chat-input-inner">
          ${this._renderInput()}
        </div>
      </div>
    `;
  }

  private _renderHeader(): unknown {
    return html`
      <div class="chat-header">
        <div class="chat-header-title">
          <span class="font-semibold">${t('chat.title') || 'XopcBot'}</span>
          ${this._currentSessionKey ? html`
            <span class="text-xs text-muted ml-2">${this._sessions.find(s => s.key === this._currentSessionKey)?.name || this._currentSessionKey}</span>
          ` : ''}
        </div>
        <button class="new-session-btn" @click=${() => this._createNewSession()}>
          ${this._renderIcon('plus')}
          <span>${t('chat.newSession') || 'New Chat'}</span>
        </button>
      </div>
    `;
  }

  private _renderStatus(): unknown {
    if (this._connectionState === 'error' && this._error) {
      return html`
        <div class="status-bar error">
          ${this._renderIcon('alertCircle')}
          <span>${this._error}</span>
          <button class="underline ml-auto" @click=${() => this.reconnect()}>${t('chat.retry')}</button>
        </div>
      `;
    }
    
    if (this._connectionState === 'reconnecting') {
      return html`
        <div class="status-bar warning">
          <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          <span>${t('chat.reconnecting')}</span>
        </div>
      `;
    }
    
    if (this._connectionState === 'connecting') {
      return html`
        <div class="status-bar warning">
          <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          <span>${t('chat.connecting')}</span>
        </div>
      `;
    }
    
    return null;
  }

  private _renderIcon(name: string): unknown {
    const icons: Record<string, unknown> = {
      alertCircle: html`
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      `,
      chevronDown: html`
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      `,
      plus: html`
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      `,
    };
    return icons[name] || '';
  }

  private _renderScrollToBottomButton(): unknown {
    return html`
      <button 
        class="scroll-to-bottom-btn"
        @click=${this._scrollToBottom}
        title="Scroll to bottom"
      >
        ${this._renderIcon('chevronDown')}
      </button>
    `;
  }

  private _renderMessages(): unknown {
    if (!this._messages.length && !this._isStreaming) {
      return html`
        <div class="empty-state" style="padding-top: 30vh;">
          <div class="icon">🤖</div>
          <div class="title">${t('chat.welcomeTitle')}</div>
          <div class="description">${t('chat.welcomeDescription')}</div>
        </div>
      `;
    }

    return html`
      <div class="flex flex-col gap-4">
        ${this._messages.map(msg => this._renderMessage(msg))}
        ${this._isStreaming && this._streamingMessage ? this._renderStreamingMessage() : ''}
      </div>
    `;
  }

  private _renderMessage(message: Message): unknown {
    const isUser = message.role === 'user';
    const hasContent = message.content?.some((block) => block.text);
    if (!hasContent && !message.attachments?.length) return null;

    return html`
      <div class="message-item ${isUser ? 'flex-row-reverse' : ''}">
        <div class="avatar ${isUser ? 'user' : 'assistant'}">
          ${isUser ? t('chat.you').charAt(0) : 'X'}
        </div>
        
        <div class="flex flex-col gap-1 max-w-[calc(100%-3rem)]">
          <div class="flex items-center gap-2 text-xs text-muted ${isUser ? 'flex-row-reverse' : ''}">
            <span class="font-medium">${isUser ? t('chat.you') : t('chat.assistant')}</span>
            <span>·</span>
            <span>${this._formatTime(message.timestamp)}</span>
          </div>
          
          <div class="message-bubble ${isUser ? 'user' : 'assistant'}">
            ${this._renderMessageContent(message.content)}
            ${message.attachments?.length ? this._renderAttachments(message.attachments) : ''}
          </div>
        </div>
      </div>
    `;
  }

  private _renderStreamingMessage(): unknown {
    const content = this._streamingMessage?.content || [];
    
    return html`
      <div class="message-item">
        <div class="avatar assistant">X</div>
        <div class="flex flex-col gap-1 max-w-[calc(100%-3rem)]">
          <div class="flex items-center gap-2 text-xs text-muted">
            <span class="font-medium">${t('chat.assistant')}</span>
            <span>·</span>
            <span class="text-primary animate-pulse">${t('chat.thinking')}</span>
          </div>
          <div class="message-bubble assistant">
            <div class="markdown-content">
              ${content.map((block) => {
                if (block.type === 'text' && block.text) {
                  return html`<p class="whitespace-pre-wrap">${block.text}<span class="streaming-cursor"></span></p>`;
                }
                return '';
              })}
              ${!content.length ? html`<span class="streaming-cursor"></span>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private _renderMessageContent(content: Array<{ type: string; text?: string }>): unknown {
    if (!content || content.length === 0) return null;
    return html`
      <div class="markdown-content">
        ${content.map((block) => {
          if (block.type === 'text' && block.text) {
            return html`<p class="whitespace-pre-wrap">${block.text}</p>`;
          }
          return '';
        })}
      </div>
    `;
  }

  private _renderAttachments(attachments: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>): unknown {
    const images = attachments.filter(att => att.type === 'image' || att.mimeType?.startsWith('image/'));
    const documents = attachments.filter(att => att.type !== 'image' && !att.mimeType?.startsWith('image/'));
    
    return html`
      <div class="flex flex-col gap-2 mt-2">
        ${images.length > 0 ? this._renderImageGallery(images) : ''}
        ${documents.length > 0 ? this._renderDocumentList(documents) : ''}
      </div>
    `;
  }

  private _renderImageGallery(images: Array<{ data?: string; name?: string }>): unknown {
    const count = images.length;
    let galleryClass = 'single';
    if (count === 2) galleryClass = 'double';
    else if (count === 3) galleryClass = 'triple';
    else if (count >= 4) galleryClass = 'quad';
    
    return html`
      <div class="image-gallery ${galleryClass}">
        ${images.map((img) => html`<img src="${img.data}" alt="${img.name || 'Image'}" />`)}
      </div>
    `;
  }

  private _renderDocumentList(documents: Array<{ mimeType?: string; name?: string; size?: number }>): unknown {
    return html`
      <div class="flex flex-col gap-2">
        ${documents.map((doc) => this._renderDocumentPreview(doc))}
      </div>
    `;
  }

  private _renderDocumentPreview(doc: { mimeType?: string; name?: string; size?: number }): unknown {
    const name = doc.name || 'Document';
    const size = doc.size ? this._formatFileSize(doc.size) : '';
    
    return html`
      <div class="document-preview">
        <div class="icon">${this._getDocumentIcon(doc.mimeType || '')}</div>
        <div class="info">
          <div class="name">${name}</div>
          <div class="meta">${size || doc.mimeType || 'File'}</div>
        </div>
      </div>
    `;
  }

  private _getDocumentIcon(mimeType: string): unknown {
    const color = mimeType.includes('pdf') ? '#ef4444'
      : (mimeType.includes('word') || mimeType.includes('document')) ? '#2563eb'
      : (mimeType.includes('sheet') || mimeType.includes('excel')) ? '#16a34a'
      : 'currentColor';

    return html`
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14,2 14,8 20,8"/>
      </svg>
    `;
  }

  private _renderInput(): unknown {
    return html`
      <message-editor
        .isStreaming=${this._isStreaming}
        .showAttachmentButton=${this.enableAttachments}
        .showModelSelector=${this.enableModelSelector}
        .onSend=${(input: string, attachments: Attachment[]) => this._handleSend(input, attachments)}
        .onAbort=${() => this.abort()}
      ></message-editor>
    `;
  }

  private _handleSend = (input: string, attachments: Attachment[]): void => {
    const attachmentData = attachments?.map(att => ({
      type: att.type || 'file',
      mimeType: att.mimeType,
      data: att.content,
      name: att.name,
      size: att.size,
    }));
    this.sendMessage(input, attachmentData);
  };

  private _formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private _formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let size = bytes;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}
