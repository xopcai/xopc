// Session Manager Page Component (精简版)

import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '../components/SessionList';
import '../components/SessionDetailDrawer';
import '../components/ConfirmDialog';
import { getIcon } from '../utils/icons';
import { SessionAPIClient, type SessionMetadata, type SessionDetail, type SessionStats } from '../utils/session-api';
import type { SessionListEventDetail } from '../components/SessionList';
import type { SessionDetailEventDetail } from '../components/SessionDetailDrawer';

export interface SessionManagerConfig {
  url: string;
  token?: string;
}

@customElement('session-manager')
export class SessionManager extends LitElement {
  @property({ attribute: false }) config?: SessionManagerConfig;

  @state() private _sessions: SessionMetadata[] = [];
  @state() private _loading = false;
  @state() private _hasMore = false;
  @state() private _stats: SessionStats | null = null;
  @state() private _searchQuery = '';
  @state() private _statusFilter: 'all' | 'active' | 'archived' | 'pinned' = 'all';
  @state() private _offset = 0;
  @state() private _error: string | null = null;

  // Detail drawer state
  @state() private _detailOpen = false;
  @state() private _detailSession: SessionDetail | null = null;
  @state() private _detailLoading = false;

  // Confirm dialog state
  @state() private _confirmOpen = false;
  @state() private _confirmTitle = '';
  @state() private _confirmMessage = '';
  @state() private _confirmKey: string | null = null;
  @state() private _confirmAction: 'delete' | null = null;

  private _api!: SessionAPIClient;
  private _limit = 20;

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.config?.url) {
      // Convert WebSocket URL to HTTP URL for REST API
      let httpUrl = this.config.url
        .replace(/^ws:/i, 'http:')
        .replace(/^wss:/i, 'https:')
        .replace(/\/ws$/i, '');
      this._api = new SessionAPIClient(httpUrl, this.config.token);
      this._loadSessions();
      this._loadStats();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // No WebSocket to disconnect anymore
  }

  private async _loadSessions(reset = false): Promise<void> {
    if (this._loading) return;

    this._loading = true;
    this._error = null;

    if (reset) {
      this._offset = 0;
      this._sessions = [];
    }

    try {
      const query = {
        limit: this._limit,
        offset: this._offset,
        sortBy: 'updatedAt' as const,
        sortOrder: 'desc' as const,
        ...(this._statusFilter !== 'all' && { status: this._statusFilter }),
        ...(this._searchQuery && { search: this._searchQuery }),
      };

      const result = await this._api.listSessions(query);
      
      if (reset) {
        this._sessions = result.items;
      } else {
        this._sessions = [...this._sessions, ...result.items];
      }
      
      this._hasMore = result.hasMore;
      this._offset = result.offset + result.items.length;
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Failed to load sessions';
      console.error('[SessionManager] Load error:', err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadStats(): Promise<void> {
    try {
      this._stats = await this._api.getStats();
    } catch (err) {
      console.error('[SessionManager] Stats error:', err);
    }
  }

  // ========== Detail Drawer ==========

  private async _openDetail(key: string): Promise<void> {
    this._detailOpen = true;
    this._detailLoading = true;

    try {
      const session = await this._api.getSession(key);
      this._detailSession = session;
    } catch (err) {
      console.error('[SessionManager] Load detail error:', err);
      this._detailOpen = false;
    } finally {
      this._detailLoading = false;
    }
  }

  private _closeDetail(): void {
    this._detailOpen = false;
    this._detailSession = null;
  }

  private _handleDetailAction(e: CustomEvent<SessionDetailEventDetail>): void {
    const { action } = e.detail;
    const key = this._detailSession?.key;
    if (!key) return;

    switch (action) {
      case 'close':
        this._closeDetail();
        break;
      case 'delete':
        this._showConfirm(key);
        break;
      case 'archive':
        this._archiveSession(key);
        break;
      case 'unarchive':
        this._unarchiveSession(key);
        break;
      case 'pin':
        this._pinSession(key);
        break;
      case 'unpin':
        this._unpinSession(key);
        break;
      case 'export':
        this._exportSession(key);
        break;
    }
  }

  // ========== Confirm Dialog ==========

  private _showConfirm(key: string): void {
    this._confirmKey = key;
    this._confirmAction = 'delete';
    this._confirmTitle = 'Delete Session';
    this._confirmMessage = `Are you sure you want to delete session "${key}"?\n\nThis action cannot be undone.`;
    this._confirmOpen = true;
  }

  private _handleConfirm(e: CustomEvent<{ confirmed: boolean }>): void {
    if (!e.detail.confirmed || !this._confirmKey) {
      this._confirmOpen = false;
      this._confirmKey = null;
      return;
    }

    this._deleteSession(this._confirmKey);
    this._confirmOpen = false;
    this._confirmKey = null;
  }

  // ========== Actions ==========

  private async _deleteSession(key: string): Promise<void> {
    try {
      await this._api.deleteSession(key);
      this._sessions = this._sessions.filter(s => s.key !== key);
      
      if (this._detailSession?.key === key) {
        this._closeDetail();
      }
      
      await this._loadStats();
    } catch (err) {
      alert('Failed to delete session: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private async _archiveSession(key: string): Promise<void> {
    try {
      await this._api.archiveSession(key);
      this._updateSessionStatus(key, 'archived');
      if (this._detailSession?.key === key) {
        this._detailSession = { ...this._detailSession, status: 'archived' };
      }
      await this._loadStats();
    } catch (err) {
      console.error('[SessionManager] Archive error:', err);
    }
  }

  private async _unarchiveSession(key: string): Promise<void> {
    try {
      await this._api.unarchiveSession(key);
      this._updateSessionStatus(key, 'active');
      if (this._detailSession?.key === key) {
        this._detailSession = { ...this._detailSession, status: 'active' };
      }
      await this._loadStats();
    } catch (err) {
      console.error('[SessionManager] Unarchive error:', err);
    }
  }

  private async _pinSession(key: string): Promise<void> {
    try {
      await this._api.pinSession(key);
      this._updateSessionStatus(key, 'pinned');
      if (this._detailSession?.key === key) {
        this._detailSession = { ...this._detailSession, status: 'pinned' };
      }
      await this._loadStats();
    } catch (err) {
      console.error('[SessionManager] Pin error:', err);
    }
  }

  private async _unpinSession(key: string): Promise<void> {
    try {
      await this._api.unpinSession(key);
      this._updateSessionStatus(key, 'active');
      if (this._detailSession?.key === key) {
        this._detailSession = { ...this._detailSession, status: 'active' };
      }
      await this._loadStats();
    } catch (err) {
      console.error('[SessionManager] Unpin error:', err);
    }
  }

  private async _exportSession(key: string): Promise<void> {
    try {
      const content = await this._api.exportSession(key, 'json');
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `session-${key.replace(/[^a-z0-9]/gi, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Failed to export session: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private _updateSessionStatus(key: string, status: SessionMetadata['status']): void {
    this._sessions = this._sessions.map(s => 
      s.key === key ? { ...s, status } : s
    );
  }

  // ========== List Handlers ==========

  private _handleListAction(e: CustomEvent<SessionListEventDetail>): void {
    const { action, key } = e.detail;
    
    switch (action) {
      case 'select':
        this._openDetail(key);
        break;
      case 'delete':
        this._showConfirm(key);
        break;
      case 'archive':
        this._archiveSession(key);
        break;
      case 'unarchive':
        this._unarchiveSession(key);
        break;
      case 'pin':
        this._pinSession(key);
        break;
      case 'unpin':
        this._unpinSession(key);
        break;
      case 'export':
        this._exportSession(key);
        break;
    }
  }

  private _handleSearch(e: InputEvent): void {
    const target = e.target as HTMLInputElement;
    this._searchQuery = target.value;
    this._debouncedSearch();
  }

  private _debouncedSearch = this._debounce(() => {
    this._loadSessions(true);
  }, 300);

  private _debounce(fn: () => void, ms: number): () => void {
    let timeout: ReturnType<typeof setTimeout>;
    return () => {
      clearTimeout(timeout);
      timeout = setTimeout(fn, ms);
    };
  }

  private _handleStatusFilter(status: typeof this._statusFilter): void {
    this._statusFilter = status;
    this._loadSessions(true);
  }

  private _handleLoadMore(): void {
    this._loadSessions();
  }

  // ========== Render ==========

  override render(): unknown {
    return html`
      <div class="session-manager">
        ${this._renderHeader()}
        ${this._renderFilters()}
        ${this._renderStats()}
        ${this._error ? html`<div class="error-banner">${this._error}</div>` : ''}
        
        <session-list
          .sessions=${this._sessions}
          .loading=${this._loading}
          .hasMore=${this._hasMore}
          @list-action=${this._handleListAction}
          @load-more=${this._handleLoadMore}
        ></session-list>
      </div>

      <session-detail-drawer
        .session=${this._detailSession}
        .open=${this._detailOpen}
        .loading=${this._detailLoading}
        @detail-action=${this._handleDetailAction}
      ></session-detail-drawer>

      <confirm-dialog
        .open=${this._confirmOpen}
        .title=${this._confirmTitle}
        .message=${this._confirmMessage}
        .confirmText="Delete"
        .cancelText="Cancel"
        .type="danger"
        @confirm=${this._handleConfirm}
      ></confirm-dialog>
    `;
  }

  private _renderHeader(): unknown {
    return html`
      <div class="session-manager__header">
        <h1 class="page-title">${getIcon('folderOpen')} Sessions</h1>
        <div class="search-box">
          ${getIcon('search')}
          <input
            type="text"
            placeholder="Search sessions..."
            .value=${this._searchQuery}
            @input=${this._handleSearch}
          />
        </div>
      </div>
    `;
  }

  private _renderFilters(): unknown {
    const filters = [
      { key: 'all', label: 'All', icon: 'layers' },
      { key: 'active', label: 'Active', icon: 'circle' },
      { key: 'pinned', label: 'Pinned', icon: 'pin' },
      { key: 'archived', label: 'Archived', icon: 'archive' },
    ] as const;

    return html`
      <div class="session-manager__filters">
        ${filters.map(f => html`
          <button
            class="filter-btn ${this._statusFilter === f.key ? 'filter-btn--active' : ''}"
            @click=${() => this._handleStatusFilter(f.key as typeof this._statusFilter)}
          >
            ${getIcon(f.icon)}
            ${f.label}
          </button>
        `)}
      </div>
    `;
  }

  private _renderStats(): unknown {
    if (!this._stats) return '';

    return html`
      <div class="session-manager__stats">
        <div class="stat-card">
          <div class="stat-value">${this._stats.totalSessions}</div>
          <div class="stat-label">Total</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${this._stats.activeSessions}</div>
          <div class="stat-label">Active</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${this._stats.pinnedSessions}</div>
          <div class="stat-label">Pinned</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${this._stats.archivedSessions}</div>
          <div class="stat-label">Archived</div>
        </div>
      </div>
    `;
  }
}

export default SessionManager;
