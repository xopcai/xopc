import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../../utils/i18n';
import type { Message, MessageContent } from './types';
import './AttachmentRenderer';
import './UsageBadge';
import '../MarkdownRenderer';

@customElement('message-bubble')
export class MessageBubble extends LitElement {
  @property({ attribute: false }) message!: Message;
  @property({ type: Boolean }) isStreaming = false;
  @property({ attribute: false }) progress: { stage: string; message: string; detail?: string } | null = null;

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override render(): unknown {
    const isUser = this.message.role === 'user' || this.message.role === 'user-with-attachments';
    const isAssistant = this.message.role === 'assistant';

    const roleLabel = isUser ? t('chat.you') : isAssistant ? t('chat.assistant') : t('chat.tool');
    const avatarLetter = roleLabel.charAt(0);

    return html`
      <div class="message-item ${isUser ? 'flex-row-reverse' : ''}">
        <div class="avatar ${isUser ? 'user' : isAssistant ? 'assistant' : 'tool'}">
          ${avatarLetter}
        </div>

        <div class="flex flex-col gap-1 max-w-[85%]">
          <div class="flex items-center gap-2 text-xs text-muted">
            <span class="font-medium">${roleLabel}</span>
            <span>·</span>
            <span>${this._formatTime(this.message.timestamp)}</span>
            ${this._renderStatusIndicator()}
          </div>

          <div class="message-bubble ${isUser ? 'bg-primary-light' : 'bg-secondary'}">
            ${this._renderContent(this.message.content)}
            ${this.message.attachments?.length ? html`
              <attachment-renderer .attachments=${this.message.attachments}></attachment-renderer>
            ` : ''}
          </div>

          ${isAssistant && this.message.usage ? html`
            <usage-badge .usage=${this.message.usage}></usage-badge>
          ` : ''}
        </div>
      </div>
    `;
  }

  private _renderContent(content: MessageContent[]): unknown {
    if (!content || content.length === 0) {
      return this.isStreaming ? html`<span class="streaming-cursor"></span>` : null;
    }

    return html`
      <div class="markdown-content">
        ${content.map((block) => this._renderContentBlock(block))}
        ${this.isStreaming ? html`<span class="streaming-cursor"></span>` : ''}
      </div>
    `;
  }

  private _renderContentBlock(block: MessageContent): unknown {
    switch (block.type) {
      case 'text':
        if (block.text) {
          return html`<markdown-renderer .content=${block.text}></markdown-renderer>`;
        }
        break;
        
      case 'image':
        if (block.source?.data) {
          return html`<img src="${block.source.data}" class="rounded-lg max-w-full" />`;
        }
        break;
        
      case 'tool_use':
      case 'tool_result':
        return this._renderToolCall(block);
        
      default:
        // Handle unknown content types gracefully
        if (block.text) {
          return html`<p class="whitespace-pre-wrap">${block.text}</p>`;
        }
    }
    return null;
  }

  private _renderToolCall(block: MessageContent): unknown {
    const isError = block.is_error || block.error;
    const name = block.name || block.function?.name || 'Tool';
    const input = block.input || block.function?.arguments;

    return html`
      <div class="tool-call ${isError ? 'tool-call--error' : ''}">
        <div class="tool-call-header">
          <span>🔧 ${name}</span>
          ${isError ? html`<span class="text-red-500 text-xs">Error</span>` : ''}
        </div>
        ${input ? html`
          <pre class="tool-call-content">${JSON.stringify(input, null, 2)}</pre>
        ` : ''}
        ${block.content ? html`
          <div class="tool-call-result">${JSON.stringify(block.content)}</div>
        ` : ''}
      </div>
    `;
  }

  private _formatTime(timestamp?: number): string {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  private _renderStatusIndicator(): unknown {
    // Show progress info if available
    if (this.progress) {
      const emoji = this._getStageEmoji(this.progress.stage);
      return html`
        <span class="text-accent animate-pulse" title="${this.progress.detail || ''}">
          ${emoji} ${this.progress.message}
        </span>
      `;
    }
    
    // Fallback to old thinking indicator
    if (this.isStreaming) {
      return html`<span class="text-primary animate-pulse">${t('chat.thinking')}</span>`;
    }
    
    return null;
  }

  private _getStageEmoji(stage: string): string {
    const emojiMap: Record<string, string> = {
      'thinking': '🤔',
      'searching': '🔍',
      'reading': '📖',
      'writing': '✍️',
      'executing': '⚙️',
      'analyzing': '📊',
      'idle': '💬',
    };
    return emojiMap[stage] || '💬';
  }
}
