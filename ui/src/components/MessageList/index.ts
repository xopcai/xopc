import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../../utils/i18n';
import type { Message } from './types';
import './MessageBubble';

@customElement('message-list')
export class MessageList extends LitElement {
  @property({ attribute: false }) messages: Message[] = [];
  @property({ type: Boolean }) isStreaming = false;
  @property({ type: Boolean }) useVirtualScroll = false;

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override render(): unknown {
    if (!this.messages || this.messages.length === 0) {
      return this._renderEmptyState();
    }

    return html`
      <div class="flex flex-col gap-4 pb-4">
        ${this.messages.map((message, index) => html`
          <message-bubble 
            .message=${message}
            .isStreaming=${this.isStreaming && index === this.messages.length - 1}
          ></message-bubble>
        `)}
      </div>
    `;
  }

  private _renderEmptyState(): unknown {
    return html`
      <div class="empty-state">
        <div class="icon">💬</div>
        <div class="title">${t('chat.emptyState')}</div>
        <div class="description">${t('chat.emptyStateDescription')}</div>
      </div>
    `;
  }

  // Scroll to bottom
  scrollToBottom(): void {
    const container = this.closest('.overflow-y-auto');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  // Check if scrolled near bottom
  isNearBottom(threshold = 100): boolean {
    const container = this.closest('.overflow-y-auto');
    if (!container) return true;
    
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < threshold;
  }
}
