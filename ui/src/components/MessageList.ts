import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

interface Attachment {
  id?: string;
  name?: string;
  type?: string;
  mimeType?: string;
  size?: number;
  content?: string;
  data?: string;
}

interface MessageContent {
  type: string;
  text?: string;
  source?: { data?: string };
  name?: string;
  input?: any;
  function?: { name?: string; arguments?: any };
  content?: any;
  is_error?: boolean;
  error?: boolean;
}

interface Message {
  role: string;
  content: MessageContent[];
  attachments?: Attachment[];
  usage?: any;
  timestamp?: number;
}

@customElement('message-list')
export class MessageList extends LitElement {
  @property({ attribute: false }) messages: Message[] = [];
  @property({ attribute: false }) tools: Map<string, any> = new Map();
  @property({ attribute: false }) pendingToolCalls: Set<string> = new Set();
  @property({ type: Boolean }) isStreaming = false;

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override render(): unknown {
    if (!this.messages || this.messages.length === 0) {
      return this.renderEmptyState();
    }

    return html`
      <div class="flex flex-col gap-4 pb-4">
        ${this.messages.map((message) => this.renderMessage(message))}
      </div>
    `;
  }

  private renderEmptyState(): unknown {
    return html`
      <div class="empty-state">
        <div class="icon">💬</div>
        <div class="title">No messages yet</div>
        <div class="description">Start a conversation by typing a message below</div>
      </div>
    `;
  }

  private renderMessage(message: Message): unknown {
    const isUser = message.role === 'user' || message.role === 'user-with-attachments';
    const isAssistant = message.role === 'assistant';
    const isTool = message.role === 'tool' || message.role === 'tool_result';

    // Get attachments from message
    const attachments = message.attachments || (message as any).attachment;

    return html`
      <div class="flex gap-3 message-item ${isUser ? 'flex-row-reverse' : ''}">
        <div class="avatar ${isUser ? 'user' : isAssistant ? 'assistant' : 'tool'}">
          ${isUser ? 'U' : isAssistant ? 'AI' : 'T'}
        </div>
        
        <div class="flex flex-col gap-1 max-w-[85%]">
          <div class="flex items-center gap-2 text-xs text-muted">
            <span class="font-medium">${isUser ? 'You' : isAssistant ? 'Assistant' : 'Tool'}</span>
            <span>·</span>
            <span>${this._formatTime(message.timestamp)}</span>
          </div>
          
          <div class="message-bubble rounded-xl p-3 ${isUser ? 'bg-accent-light' : 'bg-secondary'}">
            ${this.renderContent(message)}
            
            ${attachments && attachments.length > 0 ? this.renderAttachments(attachments) : ''}
          </div>
          
          ${isAssistant && message.usage ? this.renderUsage(message.usage) : ''}
        </div>
      </div>
    `;
  }

  private renderContent(message: Message): unknown {
    const content = message.content || [];
    
    if (!content || content.length === 0) {
      return null;
    }
    
    return html`
      <div class="markdown-content">
        ${content.map((block: MessageContent) => this.renderContentBlock(block))}
      </div>
    `;
  }

  private renderContentBlock(block: MessageContent): unknown {
    if (block.type === 'text') {
      return html`<p class="whitespace-pre-wrap">${this._escapeHtml(block.text || '')}</p>`;
    }
    
    if (block.type === 'image') {
      const src = block.source?.data || '';
      return html`
        <div class="mt-2">
          <img 
            src="${src}" 
            alt="User image" 
            class="max-w-full rounded-lg cursor-pointer"
            style="max-height: 300px; object-fit: contain;"
            @click=${() => this._openImage(src)}
          />
        </div>
      `;
    }
    
    if (block.type === 'tool_use') {
      return this.renderToolUse(block);
    }
    
    if (block.type === 'tool_result') {
      return this.renderToolResult(block);
    }
    
    return '';
  }

  private renderToolUse(block: MessageContent): unknown {
    const name = block.name || block.function?.name;
    const input = block.input || block.function?.arguments || {};
    
    const inputStr = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    
    return html`
      <div class="tool-call">
        <div class="name">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
          <span>${name}</span>
        </div>
        <pre class="input">${inputStr}</pre>
      </div>
    `;
  }

  private renderToolResult(block: MessageContent): unknown {
    let result = block.content || block.result;
    const isError = block.is_error || block.error;
    
    if (result == null) {
      return html`<div class="text-muted italic">No result</div>`;
    }
    
    let resultStr: string;
    if (typeof result === 'string') {
      // Try to parse JSON for better display
      try {
        const parsed = JSON.parse(result);
        resultStr = JSON.stringify(parsed, null, 2);
      } catch {
        resultStr = result;
      }
    } else {
      resultStr = JSON.stringify(result, null, 2);
    }
    
    return html`
      <div class="tool-result ${isError ? 'error' : 'success'}">
        <pre class="content ${isError ? 'text-red-600' : ''}">${resultStr}</pre>
      </div>
    `;
  }

  private renderAttachments(attachments: Attachment[]): unknown {
    const images: Attachment[] = [];
    const documents: Attachment[] = [];
    
    attachments.forEach(att => {
      const mimeType = att.mimeType || att.type || '';
      if (mimeType.startsWith('image/')) {
        images.push(att);
      } else {
        documents.push(att);
      }
    });
    
    return html`
      ${images.length > 0 ? this.renderImageGallery(images) : ''}
      ${documents.length > 0 ? this.renderDocumentList(documents) : ''}
    `;
  }

  private renderImageGallery(images: Attachment[]): unknown {
    const count = images.length;
    let galleryClass = 'single';
    if (count === 2) galleryClass = 'double';
    else if (count === 3) galleryClass = 'triple';
    else if (count >= 4) galleryClass = 'quad';
    
    return html`
      <div class="image-gallery ${galleryClass}">
        ${images.map((img) => {
          const src = img.content || img.data || '';
          return html`
            <img 
              src="${src}" 
              alt="${img.name || 'Image'}"
              @click=${() => this._openImage(src)}
            />
          `;
        })}
      </div>
    `;
  }

  private renderDocumentList(documents: Attachment[]): unknown {
    return html`
      <div class="flex flex-col gap-2 mt-2">
        ${documents.map((doc) => this.renderDocumentPreview(doc))}
      </div>
    `;
  }

  private renderDocumentPreview(doc: Attachment): unknown {
    const name = doc.name || 'Document';
    const size = doc.size ? this._formatFileSize(doc.size) : '';
    const mimeType = doc.mimeType || doc.type || '';
    
    // Get icon based on mime type
    const icon = this._getDocumentIcon(mimeType);
    
    return html`
      <div class="document-preview" @click=${() => this._downloadFile(doc)}>
        <div class="icon">
          ${icon}
        </div>
        <div class="info">
          <div class="name">${name}</div>
          <div class="meta">${size || mimeType || 'File'}</div>
        </div>
      </div>
    `;
  }

  private renderUsage(usage: any): unknown {
    const parts: string[] = [];
    if (usage.input) parts.push(`In: ${this._formatTokens(usage.input)}`);
    if (usage.output) parts.push(`Out: ${this._formatTokens(usage.output)}`);
    if (usage.cacheRead) parts.push(`Cache: ${this._formatTokens(usage.cacheRead)}`);
    if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
    
    if (parts.length > 0) {
      return html`
        <div class="usage-info">
          ${parts.map(part => html`<span class="item">${part}</span>`)}
        </div>
      `;
    }
    return '';
  }

  private _formatTime(timestamp?: number): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private _formatTokens(tokens?: number): string {
    if (!tokens) return '0';
    if (tokens >= 1000) {
      return (tokens / 1000).toFixed(1) + 'K';
    }
    return tokens.toString();
  }

  private _formatFileSize(bytes?: number): string {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let size = bytes;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  private _getDocumentIcon(mimeType: string): unknown {
    if (mimeType.includes('pdf')) {
      return html`
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10,9 9,9 8,9"/>
        </svg>
      `;
    }
    
    if (mimeType.includes('word') || mimeType.includes('document')) {
      return html`
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      `;
    }
    
    if (mimeType.includes('sheet') || mimeType.includes('excel')) {
      return html`
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
          <line x1="8" y1="13" x2="16" y2="13"/>
          <line x1="8" y1="17" x2="16" y2="17"/>
          <line x1="12" y1="9" x2="12" y2="21"/>
        </svg>
      `;
    }
    
    // Default file icon
    return html`
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14,2 14,8 20,8"/>
      </svg>
    `;
  }

  private _openImage(src: string): void {
    if (!src) return;
    window.open(src, '_blank');
  }

  private _downloadFile(doc: Attachment): void {
    const content = doc.content || doc.data;
    if (!content) return;
    
    const link = document.createElement('a');
    link.href = content;
    link.download = doc.name || 'file';
    link.click();
  }

  private _escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
