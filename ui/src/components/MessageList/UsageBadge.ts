import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { MessageContent } from './types';

@customElement('usage-badge')
export class UsageBadge extends LitElement {
  @property({ attribute: false }) usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cost?: number;
  };

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override render(): unknown {
    if (!this.usage) return null;

    const parts: string[] = [];
    
    if (this.usage.totalTokens !== undefined) {
      parts.push(`${this.usage.totalTokens} tokens`);
    } else if (this.usage.inputTokens !== undefined && this.usage.outputTokens !== undefined) {
      parts.push(`${this.usage.inputTokens + this.usage.outputTokens} tokens`);
    }
    
    if (this.usage.cost !== undefined && this.usage.cost > 0) {
      parts.push(`$${this.usage.cost.toFixed(4)}`);
    }

    if (parts.length === 0) return null;

    return html`
      <span class="usage-badge">
        ${parts.join(' · ')}
      </span>
    `;
  }
}
