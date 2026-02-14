// Subagents Manager Page Component

import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons';
import { SessionAPIClient, type SessionMetadata } from '../utils/session-api';
import { t } from '../utils/i18n';

export interface SubagentsConfig {
  url: string;
  token?: string;
}

@customElement('subagents-manager')
export class SubagentsManager extends LitElement {
  @property({ attribute: false }) config?: SubagentsConfig;

  @state() private _subagents: SessionMetadata[] = [];
  @state() private _loading = false;
  @state() private _error: string | null = null;
  @state() private _selectedSubagent: SessionMetadata | null = null;

  private _api?: SessionAPIClient;
  private _initialized = false;

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._tryInitialize();
  }

  override willUpdate(changedProperties: Map<string, unknown>): void {
    super.willUpdate(changedProperties);
    if (changedProperties.has('config')) {
      this._tryInitialize();
    }
  }

  private _tryInitialize(): void {
    if (this._initialized || !this.config?.url) {
      return;
    }
    const httpUrl = this.config.url.replace(/\/+$/, '');
    this._api = new SessionAPIClient(httpUrl, this.config.token);
    this._initialized = true;
    this._loadSubagents();
  }

  private async _loadSubagents(): Promise<void> {
    if (!this._api || this._loading) return;

    this._loading = true;
    this._error = null;

    try {
      const result = await this._api.listSubagents({ limit: 50 });
      this._subagents = result.items;
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Failed to load subagents';
      console.error('[SubagentsManager] Load error:', err);
    } finally {
      this._loading = false;
    }
  }

  private _formatDate(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  }

  private _formatKey(key: string): string {
    // Extract readable parts from key like "subagent:searcher:1234567890:abc123"
    const parts = key.split(':');
    if (parts.length >= 3) {
      return parts[1]; // Return the subagent name
    }
    return key;
  }

  private _handleSelect(subagent: SessionMetadata): void {
    this._selectedSubagent = subagent;
  }

  private _handleCloseDetail(): void {
    this._selectedSubagent = null;
  }

  override render(): unknown {
    return html`
      <div class="subagents-manager">
        ${this._renderHeader()}
        ${this._error ? html`<div class="error-banner">${this._error}</div>` : ''}
        ${this._selectedSubagent ? this._renderDetail() : this._renderList()}
      </div>
    `;
  }

  private _renderHeader(): unknown {
    return html`
      <div class="subagents-manager__header">
        <h1 class="page-title">${getIcon('bot')} ${t('nav.subagents')}</h1>
        <button class="btn btn-secondary" @click=${() => this._loadSubagents()} ?disabled=${this._loading}>
          ${this._loading ? html`<span class="spinner spinner--small"></span>` : getIcon('refreshCw')}
          ${t('subagents.refresh')}
        </button>
      </div>
    `;
  }

  private _renderList(): unknown {
    if (this._loading && this._subagents.length === 0) {
      return this._renderLoading();
    }

    if (this._subagents.length === 0) {
      return html`
        <div class="subagents-manager__empty">
          <div class="empty-state">
            <div class="empty-state__icon">${getIcon('bot')}</div>
            <div class="empty-state__title">${t('subagents.empty')}</div>
            <div class="empty-state__description">${t('subagents.emptyDescription')}</div>
          </div>
        </div>
      `;
    }

    return html`
      <div class="subagents-list">
        ${this._subagents.map(subagent => html`
          <div class="subagent-card" @click=${() => this._handleSelect(subagent)}>
            <div class="subagent-card__icon">
              ${getIcon('bot')}
            </div>
            <div class="subagent-card__info">
              <div class="subagent-card__name">${this._formatKey(subagent.key)}</div>
              <div class="subagent-card__meta">
                <span class="meta-item">
                  ${getIcon('messageSquare')}
                  ${subagent.messageCount} ${t('subagents.messages')}
                </span>
                <span class="meta-divider">·</span>
                <span class="meta-item">${this._formatDate(subagent.updatedAt)}</span>
              </div>
            </div>
            <div class="subagent-card__arrow">
              ${getIcon('chevronRight')}
            </div>
          </div>
        `)}
      </div>
    `;
  }

  private _renderLoading(): unknown {
    return html`
      <div class="subagents-manager__loading">
        <div class="skeleton-list">
          ${Array.from({ length: 6 }).map(() => html`
            <div class="skeleton-card">
              <div class="skeleton skeleton--icon"></div>
              <div class="skeleton skeleton--content">
                <div class="skeleton skeleton--title"></div>
                <div class="skeleton skeleton--meta"></div>
              </div>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  private _renderDetail(): unknown {
    if (!this._selectedSubagent) return nothing;

    const subagent = this._selectedSubagent;

    return html`
      <div class="subagent-detail">
        <div class="subagent-detail__header">
          <button class="btn btn-ghost" @click=${() => this._handleCloseDetail()}>
            ${getIcon('arrowLeft')}
            ${t('subagents.back')}
          </button>
        </div>

        <div class="subagent-detail__content">
          <div class="subagent-detail__title">
            <div class="subagent-detail__icon">${getIcon('bot')}</div>
            <h2>${this._formatKey(subagent.key)}</h2>
          </div>

          <div class="detail-section">
            <h3 class="section-title">${t('subagents.details')}</h3>

            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-item__label">${t('subagents.sessionKey')}</span>
                <code class="detail-item__value detail-item__value--code">${subagent.key}</code>
              </div>

              <div class="detail-item">
                <span class="detail-item__label">${t('subagents.status')}</span>
                <span class="detail-item__value">
                  <span class="status-badge status-badge--${subagent.status}">${subagent.status}</span>
                </span>
              </div>

              <div class="detail-item">
                <span class="detail-item__label">${t('subagents.messages')}</span>
                <span class="detail-item__value">${subagent.messageCount}</span>
              </div>

              <div class="detail-item">
                <span class="detail-item__label">${t('subagents.tokens')}</span>
                <span class="detail-item__value">${subagent.estimatedTokens.toLocaleString()}</span>
              </div>

              <div class="detail-item">
                <span class="detail-item__label">${t('subagents.created')}</span>
                <span class="detail-item__value">${this._formatDate(subagent.createdAt)}</span>
              </div>

              <div class="detail-item">
                <span class="detail-item__label">${t('subagents.updated')}</span>
                <span class="detail-item__value">${this._formatDate(subagent.updatedAt)}</span>
              </div>
            </div>
          </div>

          ${subagent.tags.length > 0 ? html`
            <div class="detail-section">
              <h3 class="section-title">${t('subagents.tags')}</h3>
              <div class="tags-list">
                ${subagent.tags.map(tag => html`
                  <span class="tag">${tag}</span>
                `)}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }
}
