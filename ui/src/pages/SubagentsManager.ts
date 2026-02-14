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
      <div class="subagents-page">
        ${this._renderHeader()}
        
        ${this._selectedSubagent ? this._renderDetail() : this._renderList()}
      </div>
    `;
  }

  private _renderHeader(): unknown {
    return html`
      <div class="page-header">
        <h2>${t('nav.subagents')}</h2>
        <button class="btn btn-secondary" @click=${() => this._loadSubagents()}>
          ${getIcon('refresh')} ${t('cron.refresh')}
        </button>
      </div>
    `;
  }

  private _renderList(): unknown {
    if (this._error) {
      return html`
        <div class="error-state">
          <span class="error-icon">⚠️</span>
          <p>${this._error}</p>
          <button class="btn btn-primary" @click=${() => this._loadSubagents()}>
            ${t('cron.retry')}
          </button>
        </div>
      `;
    }

    if (this._loading) {
      return html`
        <div class="loading-state">
          <div class="spinner"></div>
          <p>${t('cron.loading')}</p>
        </div>
      `;
    }

    if (this._subagents.length === 0) {
      return html`
        <div class="empty-state">
          <span class="empty-icon">🤖</span>
          <p>${t('subagents.empty')}</p>
        </div>
      `;
    }

    return html`
      <div class="subagents-list">
        ${this._subagents.map(subagent => html`
          <div class="subagent-card" @click=${() => this._handleSelect(subagent)}>
            <div class="subagent-icon">🤖</div>
            <div class="subagent-info">
              <div class="subagent-name">${this._formatKey(subagent.key)}</div>
              <div class="subagent-meta">
                <span>${subagent.messageCount} 条消息</span>
                <span>·</span>
                <span>${this._formatDate(subagent.updatedAt)}</span>
              </div>
            </div>
            <div class="subagent-arrow">
              ${getIcon('chevronRight')}
            </div>
          </div>
        `)}
      </div>
    `;
  }

  private _renderDetail(): unknown {
    if (!this._selectedSubagent) return nothing;

    return html`
      <div class="detail-panel">
        <div class="detail-header">
          <button class="btn btn-ghost" @click=${() => this._handleCloseDetail()}>
            ${getIcon('arrowLeft')} ${t('sessions.back')}
          </button>
          <h3>${this._formatKey(this._selectedSubagent.key)}</h3>
        </div>
        
        <div class="detail-content">
          <div class="detail-row">
            <span class="label">${t('sessions.sessionKey')}</span>
            <span class="value code">${this._selectedSubagent.key}</span>
          </div>
          <div class="detail-row">
            <span class="label">${t('sessions.messages')}</span>
            <span class="value">${this._selectedSubagent.messageCount}</span>
          </div>
          <div class="detail-row">
            <span class="label">${t('sessions.created')}</span>
            <span class="value">${this._formatDate(this._selectedSubagent.createdAt)}</span>
          </div>
          <div class="detail-row">
            <span class="label">${t('sessions.updated')}</span>
            <span class="value">${this._formatDate(this._selectedSubagent.updatedAt)}</span>
          </div>
        </div>
      </div>
    `;
  }
}
