import { html, LitElement } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import './components/MessageEditor';
import './components/MessageList';
import './components/StreamingMessageContainer';
import { t, initI18n } from './utils/i18n';
import type { Attachment } from './utils/attachment-utils';
import type { MessageEditor } from './components/MessageEditor';

// Type-safe Gateway Events using discriminated unions
export type ChatPayload = {
  type?: 'status' | 'token' | 'error';
  content?: string;
  status?: 'ok' | 'complete' | 'error';
  runId?: string;
  sessionKey?: string;
  message?: unknown;
  errorMessage?: string;
};

export type ConfigPayload = {
  raw: string;
  config: unknown;
  valid: boolean;
  issues?: Array<{ path: string; message: string }>;
};

export type ErrorPayload = {
  code: string;
  message: string;
};

export type GatewayEvent =
  | { type: 'event'; event: 'chat'; payload: ChatPayload }
  | { type: 'event'; event: 'config'; payload: ConfigPayload }
  | { type: 'event'; event: 'error'; payload: ErrorPayload }
  | { type: 'event'; event: string; payload: unknown };

export interface GatewayResponse<T = unknown> {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface GatewayRequest {
  type: 'req';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export type GatewayClientConfig = {
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

@customElement('xopcbot-gateway-chat')
export class XopcbotGatewayChat extends LitElement {
  @property({ attribute: false }) config?: GatewayClientConfig;
  @property({ type: Boolean }) enableAttachments = true;
  @property({ type: Boolean }) enableModelSelector = true;
  @property({ type: Boolean }) enableThinkingSelector = true;

  @query('message-editor') private _messageEditor!: MessageEditor;

  @state() private _connectionState: ConnectionState = 'disconnected';
  @state() private _error: string | null = null;
  @state() private _messages: Message[] = [];
  @state() private _isStreaming = false;
  @state() private _streamingContent = '';
  @state() private _streamingMessage: Message | null = null;
  @state() private _reconnectCount = 0;
  @state() private _reconnectDelay = 0;

  private _ws?: WebSocket;
  private _pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();
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
    
    // Initialize i18n
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

  // WebSocket Connection with Reconnection
  connect(): void {
    if (!this.config || this._connectionState === 'connecting') return;

    const url = new URL(this.config.url);
    if (this.config.token) {
      url.searchParams.set('token', this.config.token);
    }

    this._connectionState = 'connecting';
    this._error = null;
    this.requestUpdate();
    
    try {
      this._ws = new WebSocket(url.toString());
      
      this._ws.onopen = () => {
        this._connectionState = 'connected';
        this._error = null;
        this._reconnectCount = 0;
        this._reconnectDelay = 0;
        this._clearReconnectTimer();
        this.requestUpdate();
      };
      
      this._ws.onclose = (e) => {
        const wasConnected = this._connectionState === 'connected';
        this._connectionState = 'disconnected';

        // Reset streaming states on disconnect
        if (this._isStreaming) {
          this._isStreaming = false;
          this._isSending = false;
          this._streamingContent = '';
          this._streamingMessage = null;
        }

        if (e.code !== 1000 && e.code !== 1001 && this._shouldReconnect && this._autoReconnect) {
          if (wasConnected || this._reconnectCount < this._maxReconnectAttempts) {
            this._scheduleReconnect();
          } else {
            this._error = t('errors.connectionError');
            this._connectionState = 'error';
          }
        }
        this.requestUpdate();
      };
      
      this._ws.onerror = () => {
        this._error = t('errors.connectionError');
        this.requestUpdate();
      };
      
      this._ws.onmessage = (e) => {
        try {
          const frame = JSON.parse(e.data) as GatewayResponse | GatewayEvent;
          this._handleMessage(frame);
        } catch (err) {
          // Ignore parse errors
        }
      };
    } catch (err) {
      console.error('[GatewayChat] Failed to create WebSocket:', err);
      this._connectionState = 'error';
      this._error = t('errors.connectionError');
      this.requestUpdate();
    }
  }

  // Exponential backoff reconnection
  private _scheduleReconnect(): void {
    if (!this._shouldReconnect || !this._autoReconnect) return;

    this._reconnectCount++;
    this._connectionState = 'reconnecting';

    // Exponential backoff: 1s, 2s, 4s, 8s... max 30s
    this._reconnectDelay = Math.min(
      this._baseReconnectDelay * Math.pow(2, this._reconnectCount - 1),
      30000
    );

    // Update countdown every second
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
      if (this._shouldReconnect) {
        this.connect();
      }
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
    this._ws?.close(1000, 'Client disconnect');
    this._ws = undefined;
    this._connectionState = 'disconnected';
  }

  // Manual reconnect
  reconnect(): void {
    this._shouldReconnect = true;
    this._reconnectCount = 0;
    this._clearReconnectTimer();
    this.disconnect();
    setTimeout(() => this.connect(), 100);
  }

  private _handleMessage(frame: GatewayResponse | GatewayEvent): void {
    // Handle response
    if (frame.type === 'res') {
      const pending = this._pendingRequests.get(frame.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this._pendingRequests.delete(frame.id);
        if (frame.ok) {
          pending.resolve(frame.payload);
          // If still streaming when response arrives, finalize the message
          // This handles cases where server sends 'res' without 'status: complete'
          if (this._isStreaming) {
            this._finalizeMessage();
          }
        } else {
          pending.reject(new Error(frame.error?.message || 'Request failed'));
          // Reset streaming state on error response
          this._isStreaming = false;
          this._isSending = false;
          this._streamingMessage = null;
          this.requestUpdate();
        }
      }
      return;
    }

    // Handle event with type safety
    if (frame.type === 'event') {
      this._handleEvent(frame as GatewayEvent);
    }
  }

  private _handleEvent(event: GatewayEvent): void {
    switch (event.event) {
      case 'agent':
      case 'chat':
        this._handleChatEvent(event.payload as ChatPayload);
        break;
      case 'config':
        // Handle config event
        break;
      case 'error':
        const errorPayload = event.payload as ErrorPayload;
        this._error = errorPayload.message;
        break;
    }
    this.requestUpdate();
  }

  private _handleChatEvent(data: ChatPayload): void {
    if (data.type === 'status') {
      // Agent started
      this._isStreaming = true;
    } else if (data.type === 'token' && data.content) {
      this._updateStreamingMessage(data.content);
    } else if (data.status === 'ok' || data.status === 'complete') {
      this._finalizeMessage();
    } else if (data.status === 'error') {
      this._error = data.errorMessage || t('errors.sendFailed');
      // Reset all states on error
      this._isStreaming = false;
      this._isSending = false;
      this._streamingMessage = null;
      this.requestUpdate();
    }
  }

  private _updateStreamingMessage(content: string): void {
    if (this._streamingMessage) {
      // Update existing streaming message
      const textBlock = this._streamingMessage.content.find(b => b.type === 'text');
      if (textBlock) {
        textBlock.text = (textBlock.text || '') + content;
      } else {
        this._streamingMessage.content.push({ type: 'text', text: content });
      }
    } else {
      // Create new streaming message
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
    // Add completed streaming message to main messages
    if (this._streamingMessage) {
      this._messages = [...this._messages, this._streamingMessage];
      this._streamingMessage = null;
    }
    this._isStreaming = false;
    this._streamingContent = '';
    this._isSending = false;
    this.requestUpdate();
  }

  private _sendRaw(request: GatewayRequest): void {
    if (this._ws?.readyState !== WebSocket.OPEN) return;
    this._ws.send(JSON.stringify(request));
  }

  private _request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise<unknown>((resolve, reject) => {
      const id = crypto.randomUUID();
      const request: GatewayRequest = { type: 'req', id, method, params };

      const timeout = setTimeout(() => {
        this._pendingRequests.delete(id);
        reject(new Error(t('errors.requestTimeout')));
      }, 30000);

      this._pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
      this._sendRaw(request);
    }) as Promise<T>;
  }

  async sendMessage(content: string, attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>): Promise<void> {
    // Prevent double-sending
    if (this._isSending || this._isStreaming) return;
    if (!content.trim() && !attachments?.length) return;

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

    // Send to gateway
    try {
      await this._request('agent', {
        message: content,
        channel: 'gateway',
        chatId: 'default',
      });
    } catch (error) {
      this._error = error instanceof Error ? error.message : t('errors.sendFailed');
      this.requestUpdate();
    } finally {
      this._isSending = false;
    }
  }

  abort(): void {
    // Gateway doesn't support abort yet
    this._isStreaming = false;
    this._isSending = false;
    this._streamingContent = '';
    this._streamingMessage = null;
    this.requestUpdate();
  }

  // Public API
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
    // Simple inline icon rendering
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

    // Skip empty messages
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
        <div class="avatar assistant">
          X
        </div>
        
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
        ${images.map((img) => html`
          <img src="${img.data}" alt="${img.name || 'Image'}" />
        `)}
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
        <div class="icon">
          ${this._getDocumentIcon(doc.mimeType || '')}
        </div>
        <div class="info">
          <div class="name">${name}</div>
          <div class="meta">${size || doc.mimeType || 'File'}</div>
        </div>
      </div>
    `;
  }

  private _getDocumentIcon(mimeType: string): unknown {
    if (mimeType.includes('pdf')) {
      return html`
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
        </svg>
      `;
    }
    if (mimeType.includes('word') || mimeType.includes('document')) {
      return html`
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
        </svg>
      `;
    }
    if (mimeType.includes('sheet') || mimeType.includes('excel')) {
      return html`
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
        </svg>
      `;
    }
    return html`
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
        .showThinkingSelector=${this.enableThinkingSelector}
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
