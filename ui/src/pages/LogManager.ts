// Log Manager Page Component

import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons';
import {
  LogAPIClient,
  type LogEntry,
  type LogStats,
  type LogFile,
  type LogLevel,
  LOG_LEVELS,
  LOG_LEVEL_COLORS,
} from '../utils/log-api';

export interface LogManagerConfig {
  url: string;
  token?: string;
}

@customElement('log-manager')
export class LogManager extends LitElement {
  @property({ attribute: false }) config?: LogManagerConfig;

  @state() private _logs: LogEntry[] = [];
  @state() private _loading = false;
  @state() private _hasMore = false;
  @state() private _stats: LogStats | null = null;
  @state() private _files: LogFile[] = [];
  @state() private _modules: string[] = [];

  // Filters
  @state() private _selectedLevels: Set<LogLevel> = new Set();
  @state() private _searchQuery = '';
  @state() private _selectedModule = '';
  @state() private _dateFrom = '';
  @state() private _dateTo = '';
  @state() private _offset = 0;
  @state() private _error: string | null = null;

  // Detail view
  @state() private _selectedLog: LogEntry | null = null;
  @state() private _autoRefresh = false;
  @state() private _refreshInterval?: number;

  private _api!: LogAPIClient;
  private _limit = 50;
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

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopAutoRefresh();
  }

  private _tryInitialize(): void {
    if (this._initialized || !this.config?.url) {
      return;
    }
    const httpUrl = this.config.url.replace(/\/+$/, '');
    this._api = new LogAPIClient(httpUrl, this.config.token);
    this._initialized = true;
    this._loadLogs();
    this._loadStats();
    this._loadFiles();
    this._loadModules();
  }

  private async _loadLogs(reset = false): Promise<void> {
    if (this._loading) return;

    this._loading = true;
    this._error = null;

    if (reset) {
      this._offset = 0;
      this._logs = [];
    }

    try {
      const query = {
        level: this._selectedLevels.size > 0 ? Array.from(this._selectedLevels) : undefined,
        from: this._dateFrom || undefined,
        to: this._dateTo || undefined,
        q: this._searchQuery || undefined,
        module: this._selectedModule || undefined,
        limit: this._limit,
        offset: this._offset,
      };

      const result = await this._api.queryLogs(query);

      if (reset) {
        this._logs = result.logs;
      } else {
        this._logs = [...this._logs, ...result.logs];
      }

      this._hasMore = result.logs.length === this._limit;
      this._offset = this._offset + result.logs.length;
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Failed to load logs';
      console.error('[LogManager] Load error:', err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadStats(): Promise<void> {
    try {
      this._stats = await this._api.getLogStats();
    } catch (err) {
      console.error('[LogManager] Stats error:', err);
    }
  }

  private async _loadFiles(): Promise<void> {
    try {
      this._files = await this._api.getLogFiles();
    } catch (err) {
      console.error('[LogManager] Files error:', err);
    }
  }

  private async _loadModules(): Promise<void> {
    try {
      this._modules = await this._api.getLogModules();
    } catch (err) {
      console.error('[LogManager] Modules error:', err);
    }
  }

  private _toggleLevel(level: LogLevel): void {
    if (this._selectedLevels.has(level)) {
      this._selectedLevels.delete(level);
    } else {
      this._selectedLevels.add(level);
    }
    this._selectedLevels = new Set(this._selectedLevels);
    this._loadLogs(true);
  }

  private _handleSearch(e: InputEvent): void {
    const target = e.target as HTMLInputElement;
    this._searchQuery = target.value;
    this._debouncedSearch();
  }

  private _debouncedSearch = this._debounce(() => {
    this._loadLogs(true);
  }, 300);

  private _debounce(fn: () => void, ms: number): () => void {
    let timeout: ReturnType<typeof setTimeout>;
    return () => {
      clearTimeout(timeout);
      timeout = setTimeout(fn, ms);
    };
  }

  private _handleModuleChange(e: Event): void {
    const target = e.target as HTMLSelectElement;
    this._selectedModule = target.value;
    this._loadLogs(true);
  }

  private _handleDateFromChange(e: InputEvent): void {
    const target = e.target as HTMLInputElement;
    this._dateFrom = target.value;
    this._loadLogs(true);
  }

  private _handleDateToChange(e: InputEvent): void {
    const target = e.target as HTMLInputElement;
    this._dateTo = target.value;
    this._loadLogs(true);
  }

  private _clearFilters(): void {
    this._selectedLevels.clear();
    this._selectedLevels = new Set();
    this._searchQuery = '';
    this._selectedModule = '';
    this._dateFrom = '';
    this._dateTo = '';
    this._loadLogs(true);
  }

  private _selectLog(log: LogEntry): void {
    this._selectedLog = log;
  }

  private _closeDetail(): void {
    this._selectedLog = null;
  }

  private _toggleAutoRefresh(): void {
    this._autoRefresh = !this._autoRefresh;
    if (this._autoRefresh) {
      this._startAutoRefresh();
    } else {
      this._stopAutoRefresh();
    }
  }

  private _startAutoRefresh(): void {
    this._refreshInterval = window.setInterval(() => {
      this._loadLogs(true);
      this._loadStats();
    }, 5000);
  }

  private _stopAutoRefresh(): void {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = undefined;
    }
  }

  private _handleLoadMore(): void {
    this._loadLogs();
  }

  private _formatTimestamp(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return timestamp;
    }
  }

  private _formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  override render(): unknown {
    return html`
      <div class="log-manager">
        ${this._renderHeader()}
        ${this._renderFilters()}
        ${this._renderStats()}
        ${this._error ? html`<div class="error-banner">${this._error}</div>` : ''}
        ${this._renderLogTable()}
        ${this._renderFileList()}
      </div>

      ${this._selectedLog ? this._renderDetailDrawer() : ''}
    `;
  }

  private _renderHeader(): unknown {
    return html`
      <div class="log-manager__header">
        <h1 class="page-title">${getIcon('fileText')} Logs</h1>
        <div class="log-manager__actions">
          <button
            class="btn ${this._autoRefresh ? 'btn-primary' : 'btn-secondary'}"
            @click=${this._toggleAutoRefresh}
          >
            ${getIcon(this._autoRefresh ? 'pause' : 'play')}
            ${this._autoRefresh ? 'Pause' : 'Auto Refresh'}
          </button>
          <button class="btn btn-secondary" @click=${() => this._loadLogs(true)}>
            ${getIcon('refreshCw')}
            Refresh
          </button>
        </div>
      </div>
    `;
  }

  private _renderFilters(): unknown {
    return html`
      <div class="log-manager__filters">
        <div class="filter-group">
          <label class="filter-label">Level</label>
          <div class="level-filters">
            ${LOG_LEVELS.map((level) => html`
              <button
                class="level-badge ${this._selectedLevels.has(level) ? 'level-badge--active' : ''}"
                style="--level-color: ${LOG_LEVEL_COLORS[level]}"
                @click=${() => this._toggleLevel(level)}
              >
                ${level}
              </button>
            `)}
          </div>
        </div>

        <div class="filter-group">
          <label class="filter-label">Search</label>
          <div class="search-box">
            ${getIcon('search')}
            <input
              type="text"
              placeholder="Search logs..."
              .value=${this._searchQuery}
              @input=${this._handleSearch}
            />
          </div>
        </div>

        <div class="filter-row">
          <div class="filter-group">
            <label class="filter-label">Module</label>
            <select @change=${this._handleModuleChange}>
              <option value="">All modules</option>
              ${this._modules.map((m) => html`<option value="${m}">${m}</option>`)}
            </select>
          </div>

          <div class="filter-group">
            <label class="filter-label">From</label>
            <input
              type="datetime-local"
              .value=${this._dateFrom}
              @input=${this._handleDateFromChange}
            />
          </div>

          <div class="filter-group">
            <label class="filter-label">To</label>
            <input
              type="datetime-local"
              .value=${this._dateTo}
              @input=${this._handleDateToChange}
            />
          </div>

          <button class="btn btn-ghost" @click=${this._clearFilters}>
            ${getIcon('x')}
            Clear
          </button>
        </div>
      </div>
    `;
  }

  private _renderStats(): unknown {
    if (!this._stats) return '';

    return html`
      <div class="log-manager__stats">
        <div class="stat-card">
          <div class="stat-value">${this._stats.total.toLocaleString()}</div>
          <div class="stat-label">Total Logs</div>
        </div>
        ${Object.entries(this._stats.byLevel).map(([level, count]) => html`
          <div class="stat-card stat-card--${level}">
            <div class="stat-value" style="color: ${LOG_LEVEL_COLORS[level as LogLevel]}">
              ${count.toLocaleString()}
            </div>
            <div class="stat-label">${level}</div>
          </div>
        `)}
      </div>
    `;
  }

  private _renderLogTable(): unknown {
    if (this._loading && this._logs.length === 0) {
      return this._renderLoading();
    }

    if (this._logs.length === 0) {
      return html`
        <div class="log-manager__empty">
          <div class="empty-state">
            <div class="empty-state__icon">${getIcon('fileText')}</div>
            <div class="empty-state__title">No logs found</div>
            <div class="empty-state__description">
              Try adjusting your filters or check back later.
            </div>
          </div>
        </div>
      `;
    }

    return html`
      <div class="log-table-container">
        <table class="log-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Level</th>
              <th>Module</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            ${this._logs.map((log) => html`
              <tr class="log-row log-row--${log.level}" @click=${() => this._selectLog(log)}>
                <td class="log-cell log-cell--time">${this._formatTimestamp(log.timestamp)}</td>
                <td class="log-cell log-cell--level">
                  <span
                    class="level-badge level-badge--small"
                    style="--level-color: ${LOG_LEVEL_COLORS[log.level]}"
                  >
                    ${log.level}
                  </span>
                </td>
                <td class="log-cell log-cell--module">${log.module}</td>
                <td class="log-cell log-cell--message">${log.message}</td>
              </tr>
            `)}
          </tbody>
        </table>

        ${this._hasMore ? html`
          <div class="log-table__load-more">
            <button class="btn btn-secondary" @click=${this._handleLoadMore} ?disabled=${this._loading}>
              ${this._loading ? html`<span class="spinner"></span>` : getIcon('chevronDown')}
              Load More
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  private _renderFileList(): unknown {
    if (this._files.length === 0) return '';

    return html`
      <div class="log-files">
        <h3 class="section-title">${getIcon('folder')} Log Files</h3>
        <div class="file-list">
          ${this._files.map((file) => html`
            <div class="file-item">
              <span class="file-name">${getIcon('file')}${file.name}</span>
              <span class="file-size">${this._formatFileSize(file.size)}</span>
              <span class="file-time">${this._formatTimestamp(file.modified)}</span>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  private _renderDetailDrawer(): unknown {
    if (!this._selectedLog) return '';

    const log = this._selectedLog;

    return html`
      <div class="drawer-overlay" @click=${this._closeDetail}></div>
      <div class="drawer drawer--right">
        <div class="drawer__header">
          <h3>Log Details</h3>
          <button class="btn-icon" @click=${this._closeDetail}>${getIcon('x')}</button>
        </div>
        <div class="drawer__content">
          <div class="log-detail">
            <div class="log-detail__field">
              <label>Timestamp</label>
              <code>${log.timestamp}</code>
            </div>
            <div class="log-detail__field">
              <label>Level</label>
              <span
                class="level-badge"
                style="--level-color: ${LOG_LEVEL_COLORS[log.level]}"
              >
                ${log.level}
              </span>
            </div>
            <div class="log-detail__field">
              <label>Module</label>
              <code>${log.module}</code>
            </div>
            <div class="log-detail__field">
              <label>Message</label>
              <pre class="log-detail__message">${log.message}</pre>
            </div>
            ${log.meta ? html`
              <div class="log-detail__field">
                <label>Metadata</label>
                <pre class="log-detail__meta">${JSON.stringify(log.meta, null, 2)}</pre>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  private _renderLoading(): unknown {
    return html`
      <div class="log-manager__loading">
        <div class="skeleton-table">
          ${Array.from({ length: 10 }).map(() => html`
            <div class="skeleton-row">
              <div class="skeleton skeleton--time"></div>
              <div class="skeleton skeleton--level"></div>
              <div class="skeleton skeleton--module"></div>
              <div class="skeleton skeleton--message"></div>
            </div>
          `)}
        </div>
      </div>
    `;
  }
}

export default LogManager;
