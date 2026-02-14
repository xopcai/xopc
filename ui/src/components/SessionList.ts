// Session List Component

import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { t } from '../utils/i18n';
import { getIcon } from '../utils/icons';
import './SessionCard';
import type { SessionMetadata } from '../utils/session-api';
import type { SessionCardEventDetail } from './SessionCard';

export interface SessionListEventDetail {
  action: 'select' | 'rename' | 'delete' | 'archive' | 'unarchive' | 'pin' | 'unpin' | 'export';
  key: string;
}

@customElement('session-list')
export class SessionList extends LitElement {
  @property({ attribute: false }) sessions: SessionMetadata[] = [];
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) hasMore = false;
  @property({ type: String }) selectedKey: string | null = null;

  @state() private _viewMode: 'grid' | 'list' = 'grid';

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  private _emit(action: SessionListEventDetail['action'], key: string): void {
    this.dispatchEvent(new CustomEvent<SessionListEventDetail>('list-action', {
      detail: { action, key },
      bubbles: true,
      composed: true,
    }));
  }

  private _handleCardAction(e: CustomEvent<SessionCardEventDetail>): void {
    const { action, key } = e.detail;
    if (action === 'click') {
      this._emit('select', key);
    } else {
      this._emit(action as SessionListEventDetail['action'], key);
    }
  }

  private _loadMore(): void {
    this.dispatchEvent(new CustomEvent('load-more', {
      bubbles: true,
      composed: true,
    }));
  }

  override render(): unknown {
    if (this.loading && this.sessions.length === 0) {
      return this._renderLoading();
    }

    if (this.sessions.length === 0) {
      return this._renderEmpty();
    }

    return html`
      <div class="session-list">
        ${this._renderToolbar()}
        
        <div class="session-list__content session-list__content--${this._viewMode}">
          ${this.sessions.map(session => html`
            <session-card
              .session=${session}
              .selected=${session.key === this.selectedKey}
              @session-action=${this._handleCardAction}
            ></session-card>
          `)}
        </div>

        ${this.hasMore ? html`
          <div class="session-list__load-more">
            <button class="btn btn--secondary" @click=${this._loadMore}>
              ${getIcon('chevronDown')}
              Load More
            </button>
          </div>
        ` : ''}

        ${this.loading ? html`
          <div class="session-list__loading-overlay">
            <div class="spinner"></div>
          </div>
        ` : ''}
      </div>
    `;
  }

  private _renderToolbar(): unknown {
    return html`
      <div class="session-list__toolbar">
        <div class="session-list__count">
          ${this.sessions.length} sessions
        </div>
        
        <div class="session-list__view-toggle">
          <button 
            class="btn-icon ${this._viewMode === 'grid' ? 'btn-icon--active' : ''}"
            title="Grid view"
            @click=${() => this._viewMode = 'grid'}
          >${getIcon('grid')}</button>
          <button 
            class="btn-icon ${this._viewMode === 'list' ? 'btn-icon--active' : ''}"
            title="List view"
            @click=${() => this._viewMode = 'list'}
          >${getIcon('list')}</button>
        </div>
      </div>
    `;
  }

  private _renderLoading(): unknown {
    return html`
      <div class="session-list session-list--loading">
        <div class="session-list__skeleton">
          ${Array.from({ length: 6 }).map(() => html`
            <div class="skeleton-card">
              <div class="skeleton skeleton--header"></div>
              <div class="skeleton skeleton--title"></div>
              <div class="skeleton skeleton--stats"></div>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  private _renderEmpty(): unknown {
    return html`
      <div class="session-list session-list--empty">
        <div class="empty-state">
          <div class="empty-state__icon">${getIcon('folderOpen')}</div>
          <div class="empty-state__title">No sessions found</div>
          <div class="empty-state__description">
            Start a conversation to create your first session.
          </div>
        </div>
      </div>
    `;
  }
}

export default SessionList;
