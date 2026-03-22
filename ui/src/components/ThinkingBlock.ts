/**
 * Collapsible “Thoughts” card for model reasoning (Google AI Studio–style).
 */

import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ChevronDown, Sparkles } from 'lucide';
import { lucideIcon } from '../utils/lucide-icon.js';
import { t } from '../utils/i18n.js';

@customElement('thinking-block')
export class ThinkingBlock extends LitElement {
  @property() content = '';
  @property({ type: Boolean }) isStreaming = false;
  @state() private isExpanded = false;

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    if (changed.has('isStreaming')) {
      const prev = changed.get('isStreaming');
      if (prev === true && !this.isStreaming) {
        this.isExpanded = false;
      }
    }
  }

  private toggleExpanded(): void {
    if (this.isStreaming) return;
    this.isExpanded = !this.isExpanded;
  }

  override render() {
    if (!this.content && !this.isStreaming) {
      return null;
    }

    const showBody = this.isExpanded || this.isStreaming;
    const bodyText = this.content.trim();
    const placeholder = this.isStreaming && !bodyText ? '…' : bodyText;
    const shimmerClasses = this.isStreaming
      ? 'animate-shimmer bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground bg-[length:200%_100%] bg-clip-text text-transparent'
      : '';

    return html`
      <div class="thinking-block">
        <button
          type="button"
          class="thinking-block-header"
          @click=${this.toggleExpanded}
          ?disabled=${this.isStreaming}
          aria-expanded=${showBody}
        >
          <span class="thinking-block-icon">${lucideIcon(Sparkles, 'w-4 h-4')}</span>
          <span class="thinking-block-title">
            ${this.isStreaming
              ? html`<span class="${shimmerClasses}">${t('chat.thoughtsStreaming')}</span>`
              : t('chat.thoughts')}
          </span>
          ${!showBody && !this.isStreaming && bodyText
            ? html`<span class="thinking-block-hint">${t('chat.thoughtsExpandHint')}</span>`
            : ''}
          ${!this.isStreaming
            ? html`<span class="thinking-block-chevron ${showBody ? 'is-open' : ''}"
                >${lucideIcon(ChevronDown, 'w-4 h-4')}</span
              >`
            : ''}
        </button>
        ${showBody
          ? html`<div class="thinking-block-divider" role="presentation"></div>
              <div
                class="thinking-block-body ${this.isStreaming ? 'thinking-block-body--streaming' : ''}"
              >${placeholder}</div>`
          : ''}
      </div>
    `;
  }
}
