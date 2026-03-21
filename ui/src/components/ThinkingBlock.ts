/**
 * Thinking Block Component
 * 
 * Displays the model's thinking/reasoning process in real-time.
 * Supports expandable/collapsible display with shimmer animation during streaming.
 */

import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('thinking-block')
export class ThinkingBlock extends LitElement {
  @property() content = '';
  @property({ type: Boolean }) isStreaming = false;
  @state() private isExpanded = false;

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  private toggleExpanded() {
    this.isExpanded = !this.isExpanded;
  }

  override render() {
    if (!this.content && !this.isStreaming) {
      return null;
    }

    // While streaming, always show body text (collapsed-only header hid reasoning from users).
    const showBody = this.isExpanded || this.isStreaming;

    const shimmerClasses = this.isStreaming
      ? 'animate-shimmer bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground bg-[length:200%_100%] bg-clip-text text-transparent'
      : '';

    const bodyText = this.content.trimStart();
    const placeholder = this.isStreaming && !bodyText ? '…' : bodyText;

    return html`
      <div class="thinking-block">
        <div
          class="thinking-header cursor-pointer select-none flex items-center gap-2 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          @click=${this.toggleExpanded}
        >
          <span class="transition-transform inline-block ${showBody ? 'rotate-90' : ''}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </span>
          <span class="${shimmerClasses}">${this.isStreaming ? 'Thinking...' : 'Reasoning'}</span>
        </div>
        ${showBody
          ? html`<div
              class="thinking-content pl-6 py-2 text-sm text-muted-foreground whitespace-pre-wrap font-mono"
            >${placeholder}</div>`
          : ''}
      </div>
    `;
  }
}

/**
 * Thinking message content type
 */
export interface ThinkingContent {
  type: 'thinking';
  content: string;
  isStreaming?: boolean;
}
