// Session Detail Drawer Component

import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons';
import type { SessionDetail } from '../utils/session-api';

export interface SessionDetailEventDetail {
  action: 'close' | 'archive' | 'unarchive' | 'pin' | 'unpin' | 'delete' | 'export';
}

@customElement('session-detail-drawer')
export class SessionDetailDrawer extends LitElement {
  @property({ attribute: false }) session: SessionDetail | null = null;
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) loading = false;

  @state() private _searchQuery = '';
  @state() private _searchResults: number[] = [];
  @state() private _currentResultIndex = -1;

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  private _emit(action: SessionDetailEventDetail['action']): void {
    this.dispatchEvent(new CustomEvent<SessionDetailEventDetail>('detail-action', {
      detail: { action },
      bubbles: true,
      composed: true,
    }));
  }

  private _handleClose(): void {
    this._emit('close');
  }

  private _handleBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) {
      this._handleClose();
    }
  }

  private _handleSearch(e: InputEvent): void {
    const target = e.target as HTMLInputElement;
    this._searchQuery = target.value;
    this._performSearch();
  }

  private _performSearch(): void {
    if (!this.session || !this._searchQuery.trim()) {
      this._searchResults = [];
      this._currentResultIndex = -1;
      return;
    }

    const query = this._searchQuery.toLowerCase();
    const results: number[] = [];

    this.session.messages.forEach((msg, index) => {
      if (msg.content.toLowerCase().includes(query)) {
        results.push(index);
      }
    });

    this._searchResults = results;
    this._currentResultIndex = results.length > 0 ? 0 : -1;
  }

  private _navigateSearch(direction: 'prev' | 'next'): void {
    if (this._searchResults.length === 0) return;

    if (direction === 'next') {
      this._currentResultIndex = (this._currentResultIndex + 1) % this._searchResults.length;
    } else {
      this._currentResultIndex = (this._currentResultIndex - 1 + this._searchResults.length) % this._searchResults.length;
    }

    // Scroll to result
    const resultIndex = this._searchResults[this._currentResultIndex];
    const element = this.querySelector(`[data-message-index="${resultIndex}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  private _highlightText(text: string): unknown {
    if (!this._searchQuery.trim()) return text;

    const query = this._searchQuery;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));

    return parts.map((part, i) => {
      if (part.toLowerCase() === query.toLowerCase()) {
        return html`<mark class="search-highlight">${part}</mark>`;
      }
      return part;
    });
  }

  private _formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleString();
  }

  override render(): unknown {
    if (!this.open) return '';

    return html`
      <div class="drawer-backdrop" @click=${this._handleBackdropClick}>
        <div class="drawer drawer--${this.open ? 'open' : 'closed'}">
          ${this._renderHeader()}
          ${this._renderSearch()}
          ${this._renderContent()}
          ${this._renderActions()}
        </div>
      </div>
    `;
  }

  private _renderHeader(): unknown {
    if (!this.session) return '';

    const isArchived = this.session.status === 'archived';
    const isPinned = this.session.status === 'pinned';

    return html`
      <div class="drawer-header">
        <div class="drawer-header__info">
          <div class="drawer-header__title">
            ${this.session.name || this.session.key}
            ${isPinned ? html`<span class="pin-badge">${getIcon('pin')}</span>` : ''}
            ${isArchived ? html`<span class="archive-badge">Archived</span>` : ''}
          </div>
          <div class="drawer-header__meta">
            <span>${this.session.sourceChannel}</span>
            <span>•</span>
            <span>${this.session.messageCount} messages</span>
            <span>•</span>
            <span>${this._formatDate(this.session.updatedAt)}</span>
          </div>
        </div>
        <button class="btn-icon" @click=${this._handleClose} title="Close">
          ${getIcon('x')}
        </button>
      </div>
    `;
  }

  private _renderSearch(): unknown {
    if (!this.session) return '';

    return html`
      <div class="drawer-search">
        <div class="search-input-wrapper">
          ${getIcon('search')}
          <input
            type="text"
            placeholder="Search in session..."
            .value=${this._searchQuery}
            @input=${this._handleSearch}
          />
          ${this._searchQuery ? html`
            <button class="btn-icon btn-icon--sm" @click=${() => { this._searchQuery = ''; this._performSearch(); }}>
              ${getIcon('x')}
            </button>
          ` : ''}
        </div>
        
        ${this._searchResults.length > 0 ? html`
          <div class="search-nav">
            <span class="search-count">${this._currentResultIndex + 1} / ${this._searchResults.length}</span>
            <button class="btn-icon btn-icon--sm" @click=${() => this._navigateSearch('prev')} title="Previous">
              ${getIcon('chevronUp')}
            </button>
            <button class="btn-icon btn-icon--sm" @click=${() => this._navigateSearch('next')} title="Next">
              ${getIcon('chevronDown')}
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  private _renderContent(): unknown {
    if (this.loading) {
      return html`
        <div class="drawer-content drawer-content--loading">
          <div class="spinner"></div>
          <span>Loading...</span>
        </div>
      `;
    }

    if (!this.session) {
      return html`
        <div class="drawer-content drawer-content--empty">
          <span>No session selected</span>
        </div>
      `;
    }

    return html`
      <div class="drawer-content">
        ${this.session.messages.map((msg, index) => {
          const isSearchResult = this._searchResults.includes(index);
          const isCurrentResult = this._searchResults[this._currentResultIndex] === index;

          return html`
            <div 
              class="message ${msg.role} ${isSearchResult ? 'message--highlight' : ''} ${isCurrentResult ? 'message--current' : ''}"
              data-message-index="${index}"
            >
              <div class="message__header">
                <span class="message__role">${msg.role}</span>
                ${msg.timestamp ? html`<span class="message__time">${this._formatDate(msg.timestamp)}</span>` : ''}
              </div>
              <div class="message__content">${this._highlightText(msg.content)}</div>
            </div>
          `;
        })}
      </div>
    `;
  }

  private _renderActions(): unknown {
    if (!this.session) return '';

    const isArchived = this.session.status === 'archived';
    const isPinned = this.session.status === 'pinned';

    return html`
      <div class="drawer-actions">
        ${isArchived ? html`
          <button class="btn btn--secondary" @click=${() => this._emit('unarchive')}>
            ${getIcon('archiveRestore')} Unarchive
          </button>
        ` : html`
          <button class="btn btn--secondary" @click=${() => this._emit('archive')}>
            ${getIcon('archive')} Archive
          </button>
        `}

        ${isPinned ? html`
          <button class="btn btn--secondary" @click=${() => this._emit('unpin')}>
            ${getIcon('pinOff')} Unpin
          </button>
        ` : html`
          <button class="btn btn--secondary" @click=${() => this._emit('pin')}>
            ${getIcon('pin')} Pin
          </button>
        `}

        <button class="btn btn--secondary" @click=${() => this._emit('export')}>
          ${getIcon('download')} Export
        </button>

        <button class="btn btn--danger" @click=${() => this._emit('delete')}>
          ${getIcon('trash')} Delete
        </button>
      </div>
    `;
  }
}

export default SessionDetailDrawer;
