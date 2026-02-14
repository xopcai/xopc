import { html, LitElement } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import './components/MessageEditor';
import './components/MessageList';
import './components/StreamingMessageContainer';
import { t, initI18n } from './utils/i18n';
import type { Attachment } from './utils/attachment-utils';
import type { MessageEditor } from './components/MessageEditor';

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
  @property({ type: Boolean }) enableAttachments = true;
  @property({ type: Boolean }) enableModelSelector = true;

  @query('message-editor') private _messageEditor!: MessageEditor;

  @state() private _connectionState: ConnectionState = 'disconnected';
  @state() private _error: string | null = null;
  @state() private _messages: Message[] = [];
  @state() private _isStreaming = false;
  @state() private _streamingContent = '';
  @state() private _streamingMessage: Message | null = null;
  @state() private _reconnectCount = 0;
  @state() private _reconnectDelay = 0;

  /** SSE event source for server-pushed events */
  private _eventSource?: EventSource;
  /** AbortController for the current agent POST request */
  private _agentAbort?: AbortController;
  private _reconnectTimer?: number;
  private _shouldReconnect = true;
  private _isSending = false;

  // Configurable reconnection settings
  private get _maxReconnectAttempts(): number {
    return this.config?.maxReconnectAttempts ?? 10;
  }

  private get _baseReconnectDelay(): number {
    return this.config?.reconnectDelay ?? 1000;
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
  }

  override updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);
    if (changedProperties.has('config') && this.config && this._connectionState === 'disconnected') {
      this.connect();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._shouldReconnect = false;
    this._clearReconnectTimer();
    this.disconnect();
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

      this._eventSource.addEventListener('connected', () => {
        this._connectionState = 'connected';
        this._error = null;
        this._reconnectCount = 0;
        this._reconnectDelay = 0;
        this._clearReconnectTimer();
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

      this._eventSource.onerror = () => {
        if (this._connectionState === 'connected' || this._connectionState === 'connecting') {
          this._connectionState = 'disconnected';

          if (this._isStreaming) {
            this._isStreaming = false;
            this._isSending = false;
            this._streamingContent = '';
            this._streamingMessage = null;
          }

          if (this._shouldReconnect && this._autoReconnect) {
            if (this._reconnectCount < this._maxReconnectAttempts) {
              this._scheduleReconnect();
            } else {
              this._error = t('errors.connectionError');
              this._connectionState = 'error';
            }
          }
          this.requestUpdate();
        }
      };
    } catch (err) {
      console.error('[GatewayChat] Failed to create EventSource:', err);
      this._connectionState = 'error';
      this._error = t('errors.connectionError');
      this.requestUpdate();
    }
  }

  private _scheduleReconnect(): void {
    if (!this._shouldReconnect || !this._autoReconnect) return;

    this._reconnectCount++;
    this._connectionState = 'reconnecting';

    this._reconnectDelay = Math.min(
      this._baseReconnectDelay * Math.pow(2, this._reconnectCount - 1),
      30000,
    );

    const updateCountdown = () => {
      if (this._reconnectDelay > 0 && this._connectionState === 'reconnecting') {
        this._reconnectDelay -= 1000;
        this.requestUpdate();
        if (this._reconnectDelay > 0) {
          setTimeout(updateCountdown, 1000);
        }
      }
    };
    updateCountdown();

    this._reconnectTimer = window.setTimeout(() => {
      if (this._shouldReconnect) this.connect();
    }, this._reconnectDelay);

    this.requestUpdate();
  }

  private _clearReconnectTimer(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = undefined;
    }
  }

  disconnect(): void {
    this._shouldReconnect = false;
    this._clearReconnectTimer();
    this._eventSource?.close();
    this._eventSource = undefined;
    this._agentAbort?.abort();
    this._agentAbort = undefined;
    this._connectionState = 'disconnected';
  }

  reconnect(): void {
    this._shouldReconnect = true;
    this._reconnectCount = 0;
    this._clearReconnectTimer();
    this.disconnect();
    setTimeout(() => this.connect(), 100);
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

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep incomplete line

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            currentData += line.slice(5).trim();
          } else if (line === '') {
            // End of SSE event
            if (currentData) {
              this._handleSSEEvent(currentEvent, currentData);
            }
            currentEvent = '';
            currentData = '';
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const lines = buffer.split('\n');
        let currentEvent = '';
        let currentData = '';
        for (const line of lines) {
          if (line.startsWith('event:')) currentEvent = line.slice(6).trim();
          else if (line.startsWith('data:')) currentData += line.slice(5).trim();
          else if (line === '' && currentData) {
            this._handleSSEEvent(currentEvent, currentData);
            currentEvent = '';
            currentData = '';
          }
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

      <div class="chat-messages">
        <div class="chat-messages-inner">
          ${this._renderMessages()}
        </div>
      </div>

      <div class="chat-input-container">
        <div class="chat-input-inner">
          ${this._renderInput()}
        </div>
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
          <span>${t('chat.reconnecting', { seconds: Math.ceil(this._reconnectDelay / 1000) })}</span>
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
    };
    return icons[name] || '';
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
