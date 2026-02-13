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

@customElement('xopcbot-gateway-chat')
export class XopcbotGatewayChat extends LitElement {
  @property({ attribute: false }) config?: GatewayClientConfig;
  @property({ type: Boolean }) enableAttachments = true;
  @property({ type: Boolean }) enableModelSelector = true;
  @property({ type: Boolean }) enableThinkingSelector = true;

  @query('message-editor') private _messageEditor!: MessageEditor;

  @state() private _connected = false;
  @state() private _error: string | null = null;
  @state() private _messages: Array<{
    role: 'user' | 'assistant';
    content: Array<{ type: string; text?: string }>;
    attachments?: Array<{ type: string; mimeType?: string; data?: string }>;
    timestamp: number;
  }> = [];
  @state() private _isStreaming = false;
  @state() private _streamingContent = '';

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

    if (this.config) {
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
    const lastMsg = this._messages[this._messages.length - 1];
    if (lastMsg?.role === 'assistant') {
      const textBlock = lastMsg.content.find(b => b.type === 'text');
      if (textBlock) {
        textBlock.text = (textBlock.text || '') + content;
      } else {
        lastMsg.content.push({ type: 'text', text: content });
      }
    } else {
      this._messages = [
        ...this._messages,
        {
          role: 'assistant',
          content: [{ type: 'text', text: content }],
          timestamp: Date.now(),
        },
      ];
    }
    this._isStreaming = true;
    this._streamingContent = content;
  }

  private _finalizeMessage(): void {
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

  async sendMessage(content: string, attachments?: Array<{ type: string; mimeType?: string; data?: string }>): Promise<void> {
    if (!content.trim() && !attachments?.length) return;

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
    }
  }

  abort(): void {
    // Gateway doesn't support abort yet
    this._isStreaming = false;
    this._streamingContent = '';
  }

  override render(): unknown {
    return html`
      <div class="flex flex-col h-full bg-background text-foreground">
        ${this._renderStatus()}
        
        <div class="flex-1 overflow-y-auto">
          <div class="max-w-3xl mx-auto p-4 pb-0">
            ${this._renderMessages()}
          </div>
        </div>

        <div class="shrink-0">
          <div class="max-w-3xl mx-auto px-2 pb-2">
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
          <span>${this._error}</span>
          <button class="underline" @click=${() => this.connect()}>Retry</button>
        </div>
      `;
    }
    if (!this._connected) {
      return html`
        <div class="bg-yellow-500 text-white px-4 py-2 text-sm flex items-center gap-2">
          <span>Connecting...</span>
        </div>
      `;
    }
    return null;
  }

  private _renderMessages(): unknown {
    return html`
      <div class="flex flex-col gap-4">
        ${this._messages.map(msg => this._renderMessage(msg))}
        ${this._isStreaming ? this._renderStreamingIndicator() : ''}
      </div>
    `;
  }

  private _renderMessage(message: {
    role: 'user' | 'assistant';
    content: Array<{ type: string; text?: string }>;
    attachments?: Array<{ type: string; mimeType?: string; data?: string }>;
    timestamp: number;
  }): unknown {
    const isUser = message.role === 'user';

    // Skip empty messages
    const hasContent = message.content?.some((block) => block.text);
    if (!hasContent && !message.attachments?.length) return null;

    return html`
      <div class="flex gap-3 message-item ${isUser ? 'flex-row-reverse' : ''}">
        <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-green-500 text-white'
        }">
          ${isUser ? '👤' : '🤖'}
        </div>
        
        <div class="flex flex-col gap-1 max-w-[80%]">
          <div class="text-xs text-muted-foreground">
            ${isUser ? 'You' : 'Assistant'} · ${new Date(message.timestamp).toLocaleTimeString()}
          </div>
          
          <div class="rounded-lg p-3 ${isUser ? 'bg-primary/10' : 'bg-muted'}">
            ${this._renderMessageContent(message.content)}
            ${message.attachments?.length ? this._renderAttachments(message.attachments) : ''}
          </div>
        </div>
      </div>
    `;
  }

  private _renderMessageContent(content: Array<{ type: string; text?: string }>): unknown {
    if (!content || content.length === 0) return null;
    
    return html`
      <div class="prose prose-sm dark:prose-invert">
        ${content.map((block) => {
          if (block.type === 'text' && block.text) {
            return html`<p class="whitespace-pre-wrap">${block.text}</p>`;
          }
          return '';
        })}
      </div>
    `;
  }

  private _renderAttachments(attachments: Array<{ type: string; mimeType?: string; data?: string }>): unknown {
    return html`
      <div class="mt-2 flex flex-wrap gap-2">
        ${attachments.map((att) => {
          if (att.type === 'image' || att.mimeType?.startsWith('image/')) {
            return html`<img src="${att.data}" alt="Attachment" class="max-w-[200px] rounded" />`;
          }
          return html`<div class="text-xs bg-muted px-2 py-1 rounded">${att.name || 'File'}</div>`;
        })}
      </div>
    `;
  }

  private _renderStreamingIndicator(): unknown {
    return html`
      <div class="flex gap-3 message-item">
        <div class="w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center">
          🤖
        </div>
        <div class="rounded-lg p-3 bg-muted">
          <span class="animate-pulse">▌</span>
        </div>
      </div>
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
      mimeType: att.type,
      data: att.content,
      name: att.name,
    }));
    this.sendMessage(input, attachmentData);
  };
}
