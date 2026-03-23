// Session Card Component

import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { getIcon } from '../utils/icons';
import { t } from '../utils/i18n';
import type { SessionMetadata } from '../utils/session-api';

export interface SessionCardEventDetail {
  action: 'click' | 'continue' | 'rename' | 'delete' | 'archive' | 'unarchive' | 'pin' | 'unpin' | 'export';
  key: string;
}

@customElement('session-card')
export class SessionCard extends LitElement {
  @property({ attribute: false }) session!: SessionMetadata;
  @property({ type: Boolean }) selected = false;

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  private _emit(action: SessionCardEventDetail['action']): void {
    this.dispatchEvent(new CustomEvent<SessionCardEventDetail>('session-action', {
      detail: { action, key: this.session.key },
      bubbles: true,
      composed: true,
    }));
  }

  private _formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  private _getChannelIcon(channel: string): string {
    const icons: Record<string, string> = {
      telegram: 'send',

      gateway: 'globe',
      cli: 'terminal',
    };
    return icons[channel] || 'messageSquare';
  }

  override render(): unknown {
    const displayName = this.session.name?.trim() || this.session.key;
    const showKeySubtitle = !!this.session.name?.trim();
    const isArchived = this.session.status === 'archived';
    const isPinned = this.session.status === 'pinned';

    return html`
      <div 
        class="session-card ${this.selected ? 'session-card--selected' : ''} ${isArchived ? 'session-card--archived' : ''}"
        @click=${() => this._emit('click')}
      >
        <div class="session-card__header">
          <div class="session-card__channel">
            <span class="channel-icon">${getIcon(this._getChannelIcon(this.session.sourceChannel))}</span>
            <span class="channel-name">${this.session.sourceChannel}</span>
          </div>
          <div class="session-card__meta">
            ${isPinned ? html`<span class="pin-badge" title=${t('sessions.pin')}>${getIcon('pin')}</span>` : ''}
            <span class="date">${this._formatDate(this.session.updatedAt)}</span>
          </div>
        </div>

        <div class="session-card__title-block">
          <div class="session-card__title">${displayName}</div>
          ${showKeySubtitle
            ? html`<div class="session-card__subtitle" title=${this.session.key}>${this.session.key}</div>`
            : ''}
        </div>

        <div class="session-card__stats">
          <span class="stat">
            ${getIcon('messageSquare')}
            ${this.session.messageCount}
          </span>
          <span class="stat">
            ${getIcon('zap')}
            ${this._formatTokens(this.session.estimatedTokens)}
          </span>
        </div>

        ${this.session.tags.length > 0 ? html`
          <div class="session-card__tags">
            ${this.session.tags.slice(0, 3).map(tag => html`
              <span class="tag">${tag}</span>
            `)}
            ${this.session.tags.length > 3 ? html`
              <span class="tag tag--more">+${this.session.tags.length - 3}</span>
            ` : ''}
          </div>
        ` : ''}

        <div class="session-card__actions" @click=${(e: Event) => e.stopPropagation()}>
          <button
            type="button"
            class="session-card__icon-btn"
            title=${t('sessions.continueChat')}
            @click=${() => this._emit('continue')}
          >${getIcon('messageSquare')}</button>

          ${isArchived ? html`
            <button 
              type="button"
              class="session-card__icon-btn" 
              title=${t('sessions.unarchive')}
              @click=${() => this._emit('unarchive')}
            >${getIcon('archiveRestore')}</button>
          ` : html`
            <button 
              type="button"
              class="session-card__icon-btn" 
              title=${t('sessions.archive')}
              @click=${() => this._emit('archive')}
            >${getIcon('archive')}</button>
          `}
          
          ${isPinned ? html`
            <button 
              type="button"
              class="session-card__icon-btn" 
              title=${t('sessions.unpin')}
              @click=${() => this._emit('unpin')}
            >${getIcon('pinOff')}</button>
          ` : html`
            <button 
              type="button"
              class="session-card__icon-btn" 
              title=${t('sessions.pin')}
              @click=${() => this._emit('pin')}
            >${getIcon('pin')}</button>
          `}
          
          <button 
            type="button"
            class="session-card__icon-btn" 
            title=${t('sessions.export')}
            @click=${() => this._emit('export')}
          >${getIcon('download')}</button>
          
          <button 
            type="button"
            class="session-card__icon-btn session-card__icon-btn--danger" 
            title=${t('sessions.delete')}
            @click=${() => this._emit('delete')}
          >${getIcon('trash')}</button>
        </div>
      </div>
    `;
  }

  private _formatTokens(tokens: number): string {
    if (tokens >= 1000) {
      return (tokens / 1000).toFixed(1) + 'k';
    }
    return tokens.toString();
  }
}

export default SessionCard;
