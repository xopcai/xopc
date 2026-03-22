import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../../utils/i18n';
import type { Message, MessageContent, ThinkingContent, ToolUseContent } from './types';
import './AttachmentRenderer';
import './UsageBadge';
import '../MarkdownRenderer';
import '../ThinkingBlock';
import { renderToolToHtml } from '../../tools/index.js';
import { stringToToolResultMessage } from '../../tools/result-adapter.js';

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

        <div class="flex flex-col gap-1 max-w-[85%] min-w-0">
          <div class="flex items-center gap-2 text-xs text-muted">
            <span class="font-medium">${roleLabel}</span>
            <span>·</span>
            <span>${this._formatTime(this.message.timestamp)}</span>
            ${this._renderStatusIndicator()}
          </div>

          <div class="message-bubble ${isUser ? 'user bg-primary-light' : 'bg-secondary'}">
            ${this._renderContent(this.message.content)}
            ${this._renderLegacyThinking()}
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

  /** Older sessions only had top-level `thinking`; new stream uses `content` thinking blocks. */
  private _renderLegacyThinking(): unknown {
    if (this.message.content.some((b): b is ThinkingContent => b.type === 'thinking')) {
      return null;
    }
    const thinking = this.message.thinking;
    if (!thinking && !this.message.thinkingStreaming) {
      return null;
    }

    return html`
      <thinking-block
        .content=${thinking || ''}
        .isStreaming=${this.message.thinkingStreaming || false}
      ></thinking-block>
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

      case 'thinking':
        return html`
          <thinking-block
            .content=${block.text || ''}
            .isStreaming=${block.streaming || false}
          ></thinking-block>
        `;

      case 'tool_use':
        return this._renderToolBlock(block);

      default:
        return null;
    }
    return null;
  }

  private _renderToolBlock(block: ToolUseContent): unknown {
    const isStreaming = block.status === 'running';
    const result = !isStreaming
      ? stringToToolResultMessage(block.result, block.status === 'error')
      : undefined;
    return renderToolToHtml(block.name, block.input, result, isStreaming);
  }

  private _formatTime(timestamp?: number): string {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private _renderStatusIndicator(): unknown {
    if (this.progress) {
      const emoji = this._getStageEmoji(this.progress.stage);
      return html`
        <span class="text-accent animate-pulse" title="${this.progress.detail || ''}">
          ${emoji} ${this.progress.message}
        </span>
      `;
    }

    if (this.isStreaming) {
      const streamingThinking =
        this.message?.thinkingStreaming ||
        this.message?.content?.some((b) => b.type === 'thinking' && b.streaming);
      if (streamingThinking) {
        return null;
      }
      return html`<span class="text-primary animate-pulse">${t('chat.thinking')}</span>`;
    }

    return null;
  }

  private _getStageEmoji(stage: string): string {
    const emojiMap: Record<string, string> = {
      thinking: '🤔',
      searching: '🔍',
      reading: '📖',
      writing: '✍️',
      executing: '⚙️',
      analyzing: '📊',
      idle: '💬',
    };
    return emojiMap[stage] || '💬';
  }
}
