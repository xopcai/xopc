import { html, LitElement } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import './components/MessageEditor.js';
import './components/MessageList.js';
import './components/Messages.js';
import './components/StreamingMessageContainer.js';
import { i18n, setLanguage, translations } from './utils/i18n.js';
import type { Attachment } from './utils/attachment-utils.js';
import type { MessageEditor } from './components/MessageEditor.js';

export type GatewayClientConfig = {
  url: string;
  token?: string;
};

export interface GatewayEvent {
  type: 'event';
  event: string;
  payload: unknown;
}

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

interface Message {
  role: 'user' | 'assistant';
  content: Array<{ type: string; text?: string }>;
  attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>;
  timestamp: number;
}

@customElement('xopcbot-gateway-chat')
export class XopcbotGatewayChat extends LitElement {
  @property({ attribute: false }) config?: GatewayClientConfig;
  @property({ type: Boolean }) enableAttachments = true;
  @property({ type: Boolean }) enableModelSelector = true;
  @property({ type: Boolean }) enableThinkingSelector = true;

  @query('message-editor') private _messageEditor!: MessageEditor;

  @state() private _connected = false;
  @state() private _error: string | null = null;
  @state() private _messages: Message[] = [];
  @state() private _isStreaming = false;
  @state() private _streamingContent = '';
  @state() private _streamingMessage: Message | null = null;

  private _ws?: WebSocket;
  private _pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.style.display = 'flex';
    this.style.flexDirection = 'column';
    this.style.height = '100%';
    this.style.minHeight = '0';
  }

  override updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);
    if (changedProperties.has('config') && this.config && !this._connected) {
      this.connect();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.disconnect();
  }

  connect(): void {
    if (!this.config) return;

    const url = new URL(this.config.url);
    if (this.config.token) {
      url.searchParams.set('token', this.config.token);
    }

    console.log('[GatewayChat] Connecting to:', url.toString());
    
    this._ws = new WebSocket(url.toString());
    
    this._ws.onopen = () => {
      console.log('[GatewayChat] Connected!');
      this._connected = true;
      this._error = null;
      this.requestUpdate();
    };
    
    this._ws.onclose = (e) => {
      console.log('[GatewayChat] Closed:', e.code, e.reason);
      this._connected = false;
      if (e.code !== 1000) {
        this._error = `Disconnected (${e.code})`;
      }
      this.requestUpdate();
    };
    
    this._ws.onerror = (e) => {
      console.error('[GatewayChat] Error:', e);
      this._error = 'Connection error';
      this.requestUpdate();
    };
    
    this._ws.onmessage = (e) => {
      this._handleMessage(JSON.parse(e.data));
    };
  }

  disconnect(): void {
    this._ws?.close();
    this._ws = undefined;
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
        } else {
          pending.reject(new Error(frame.error?.message || 'Request failed'));
        }
      }
      return;
    }

    // Handle event
    if (frame.type === 'event') {
      this._handleEvent(frame.event, frame.payload);
    }
  }

  private _handleEvent(event: string, payload: unknown): void {
    if (event === 'agent') {
      const data = payload as { type?: string; content?: string; status?: string };
      
      if (data.type === 'status') {
        // Agent started
        this._isStreaming = true;
      } else if (data.type === 'token' && data.content) {
        this._updateStreamingMessage(data.content);
      } else if (data.status === 'ok' || data.status === 'complete') {
        this._finalizeMessage();
      }
    }
    this.requestUpdate();
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
  }

  private _finalizeMessage(): void {
    // Add completed streaming message to main messages
    if (this._streamingMessage) {
      this._messages = [...this._messages, this._streamingMessage];
      this._streamingMessage = null;
    }
    this._isStreaming = false;
    this._streamingContent = '';
  }

  private _sendRaw(request: GatewayRequest): void {
    if (this._ws?.readyState !== WebSocket.OPEN) return;
    this._ws.send(JSON.stringify(request));
  }

  private _request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const request: GatewayRequest = { type: 'req', id, method, params };
      
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, 30000);

      this._pendingRequests.set(id, { resolve, reject, timeout });
      this._sendRaw(request);
    });
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

    // Send to gateway
    try {
      await this._request('agent', {
        message: content,
        channel: 'gateway',
        chatId: 'default',
      });
    } catch (error) {
      this._error = error instanceof Error ? error.message : 'Failed to send message';
      this.requestUpdate();
    } finally {
      this._isSending = false;
    }
  }

  abort(): void {
    // Gateway doesn't support abort yet
    this._isStreaming = false;
    this._streamingContent = '';
  }

  override render(): unknown {
    return html`
      <div class="flex flex-col h-full bg-primary text-primary">
        ${this._renderStatus()}
        
        <div class="flex-1 overflow-y-auto min-h-0">
          <div class="max-w-3xl mx-auto p-4 pb-0">
            ${this._renderMessages()}
          </div>
        </div>

        <div class="shrink-0">
          <div class="max-w-3xl mx-auto px-2 pb-4">
            ${this._renderInput()}
          </div>
        </div>
      </div>
    `;
  }

  private _renderStatus(): unknown {
    if (this._error) {
      return html`
        <div class="bg-red-500 text-white px-4 py-2 text-sm flex items-center gap-2">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>${this._error}</span>
          <button class="underline ml-auto" @click=${() => this.connect()}>Retry</button>
        </div>
      `;
    }
    if (!this._connected) {
      return html`
        <div class="bg-yellow-500 text-white px-4 py-2 text-sm flex items-center gap-2">
          <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          <span>Connecting...</span>
        </div>
      `;
    }
    return null;
  }

  private _renderMessages(): unknown {
    if (!this._messages.length && !this._isStreaming) {
      return html`
        <div class="empty-state" style="padding-top: 30vh;">
          <div class="icon" style="font-size: 4rem; margin-bottom: 1rem;">🤖</div>
          <div class="title" style="font-size: 1.25rem; font-weight: 600;">Welcome to xopcbot</div>
          <div class="description" style="color: var(--text-muted); margin-top: 0.5rem;">
            Send a message to get started
          </div>
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
      <div class="flex gap-3 message-item ${isUser ? 'flex-row-reverse' : ''}">
        <div class="avatar ${isUser ? 'user' : 'assistant'}">
          ${isUser ? 'U' : 'AI'}
        </div>
        
        <div class="flex flex-col gap-1 max-w-[85%]">
          <div class="flex items-center gap-2 text-xs text-muted">
            <span class="font-medium">${isUser ? 'You' : 'Assistant'}</span>
            <span>·</span>
            <span>${this._formatTime(message.timestamp)}</span>
          </div>
          
          <div class="rounded-xl p-3 ${isUser ? 'bg-accent-light' : 'bg-secondary'}">
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
      <div class="flex gap-3 message-item">
        <div class="avatar assistant">
          AI
        </div>
        
        <div class="flex flex-col gap-1 max-w-[85%]">
          <div class="flex items-center gap-2 text-xs text-muted">
            <span class="font-medium">Assistant</span>
            <span>·</span>
            <span class="text-accent animate-pulse">thinking...</span>
          </div>
          
          <div class="rounded-xl p-3 bg-secondary">
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
