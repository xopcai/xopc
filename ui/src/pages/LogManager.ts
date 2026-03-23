// Log Manager — calm, scannable diagnostics view (design system aligned)

import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons';
import { t } from '../utils/i18n';
import {
  LogAPIClient,
  type LogEntry,
  type LogFile,
  type LogLevel,
  LOG_LEVELS,
} from '../utils/log-api';

export interface LogManagerConfig {
  /** @deprecated No longer needed - always uses current origin */
  url?: string;
  token?: string;
}

@customElement('log-manager')
export class LogManager extends LitElement {
  @property({ attribute: false }) config?: LogManagerConfig;

  @state() private _logs: LogEntry[] = [];
  @state() private _loading = false;
  @state() private _hasMore = false;
  @state() private _files: LogFile[] = [];
  @state() private _modules: string[] = [];

  @state() private _selectedLevels: Set<LogLevel> = new Set();
  @state() private _searchQuery = '';
  @state() private _selectedModule = '';
  @state() private _dateFrom = '';
  @state() private _dateTo = '';
  @state() private _offset = 0;
  @state() private _error: string | null = null;

  @state() private _selectedLog: LogEntry | null = null;
  @state() private _showFilesPanel = false;
  @state() private _autoRefresh = false;
  @state() private _refreshInterval?: number;

  private _api!: LogAPIClient;
  private _limit = 50;
  private _initialized = false;

  private _debouncedSearch = this._debounce(() => {
    this._loadLogs(true);
  }, 300);

  private _onDocKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    if (this._selectedLog) {
      this._closeDetail();
    } else if (this._showFilesPanel) {
      this._showFilesPanel = false;
    }
  };

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('keydown', this._onDocKeydown);
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
    document.removeEventListener('keydown', this._onDocKeydown);
    this._stopAutoRefresh();
  }

  override firstUpdated(): void {
    this._tryInitialize();
  }

  private _tryInitialize(): void {
    if (this._initialized) {
      return;
    }
    const httpUrl = window.location.origin;
    this._api = new LogAPIClient(httpUrl, this.config?.token);
    this._initialized = true;
    this._loadLogs();
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
    } finally {
      this._loading = false;
    }
  }

  private async _loadFiles(): Promise<void> {
    try {
      this._files = await this._api.getLogFiles();
    } catch {
      /* optional */
    }
  }

  private async _loadModules(): Promise<void> {
    try {
      this._modules = await this._api.getLogModules();
    } catch {
      /* optional */
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

  private _formatTimeCompact(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
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

  private _moduleLabel(log: LogEntry): string {
    return String(log.module || log.prefix || log.service || log.extension || '—');
  }

  private _messagePreview(log: LogEntry): string {
    if (log.message) return log.message;
    try {
      return JSON.stringify(log);
    } catch {
      return '';
    }
  }

  private _toggleFilesPanel(): void {
    this._showFilesPanel = !this._showFilesPanel;
  }

  override render(): unknown {
    return html`
      <div class="log-page">
        ${this._renderHeader()}
        ${this._error ? html`<div class="log-page__error" role="alert">${this._error}</div>` : ''}
        ${this._renderToolbar()}
        ${this._renderFeed()}
        ${this._renderFilesPanel()}
        ${this._selectedLog ? this._renderDetailDrawer() : ''}
      </div>
    `;
  }

  private _renderHeader(): unknown {
    return html`
      <header class="log-page__header">
        <div class="log-page__header-main">
          <div class="log-page__icon" aria-hidden="true">${getIcon('terminal')}</div>
          <div class="log-page__titles">
            <h1 class="log-page__title">${t('logs.title')}</h1>
            <p class="log-page__subtitle">${t('logs.subtitle')}</p>
          </div>
        </div>
        <div class="log-page__header-actions">
          <button
            type="button"
            class="log-icon-btn"
            @click=${this._toggleFilesPanel}
            title=${t('logs.logFiles')}
            aria-label=${t('logs.logFiles')}
          >
            ${getIcon('folder')}
            ${this._files.length > 0
              ? html`<span class="log-page__badge">${this._files.length}</span>`
              : ''}
          </button>
          <button
            type="button"
            class="log-icon-btn ${this._autoRefresh ? 'log-icon-btn--on' : ''}"
            @click=${this._toggleAutoRefresh}
            title=${this._autoRefresh ? t('logs.pause') : t('logs.autoRefresh')}
            aria-label=${this._autoRefresh ? t('logs.pause') : t('logs.autoRefresh')}
          >
            ${getIcon(this._autoRefresh ? 'pause' : 'play')}
          </button>
          <button
            type="button"
            class="log-icon-btn"
            @click=${() => this._loadLogs(true)}
            title=${t('logs.refresh')}
            aria-label=${t('logs.refresh')}
          >
            ${getIcon('refreshCw')}
          </button>
        </div>
      </header>
    `;
  }

  private _renderToolbar(): unknown {
    return html`
      <section class="log-toolbar" aria-label=${t('logs.filters')}>
        <div class="log-toolbar__primary">
          <label class="log-search">
            <span class="log-search__icon">${getIcon('search')}</span>
            <input
              type="search"
              class="log-search__input"
              placeholder="${t('logs.searchPlaceholder')}"
              .value=${this._searchQuery}
              @input=${this._handleSearch}
              autocomplete="off"
              spellcheck="false"
            />
          </label>
        </div>

        <div class="log-toolbar__levels" role="group" aria-label=${t('logs.level')}>
          ${LOG_LEVELS.map(
            (level) => html`
              <button
                type="button"
                class="log-level-chip ${this._selectedLevels.has(level) ? 'log-level-chip--active' : ''}"
                data-level=${level}
                @click=${() => this._toggleLevel(level)}
              >
                ${level}
              </button>
            `,
          )}
        </div>

        <div class="log-toolbar__secondary">
          <div class="log-field">
            <label class="log-field__label" for="log-module">${t('logs.module')}</label>
            <select id="log-module" class="log-select" @change=${this._handleModuleChange}>
              <option value="">${t('logs.allModules')}</option>
              ${this._modules.map((m) => html`<option value="${m}">${m}</option>`)}
            </select>
          </div>

          <details class="log-advanced">
            <summary class="log-advanced__summary">${t('logs.timeRange')}</summary>
            <div class="log-advanced__body">
              <div class="log-field log-field--inline">
                <label class="log-field__label" for="log-from">${t('logs.from')}</label>
                <input
                  id="log-from"
                  type="datetime-local"
                  class="log-input"
                  .value=${this._dateFrom}
                  @input=${this._handleDateFromChange}
                />
              </div>
              <div class="log-field log-field--inline">
                <label class="log-field__label" for="log-to">${t('logs.to')}</label>
                <input
                  id="log-to"
                  type="datetime-local"
                  class="log-input"
                  .value=${this._dateTo}
                  @input=${this._handleDateToChange}
                />
              </div>
            </div>
          </details>

          <button type="button" class="btn btn-ghost log-toolbar__clear" @click=${this._clearFilters}>
            ${getIcon('x')}
            ${t('logs.clear')}
          </button>
        </div>

        ${this._autoRefresh
          ? html`<p class="log-toolbar__hint">${t('logs.liveHint')}</p>`
          : ''}
      </section>
    `;
  }

  private _renderFeed(): unknown {
    if (this._loading && this._logs.length === 0) {
      return this._renderSkeleton();
    }

    if (this._logs.length === 0) {
      return html`
        <div class="log-feed log-feed--empty">
          <div class="log-empty">
            <div class="log-empty__icon" aria-hidden="true">${getIcon('fileText')}</div>
            <h2 class="log-empty__title">${t('logs.noLogs')}</h2>
            <p class="log-empty__text">${t('logs.noLogsDescription')}</p>
          </div>
        </div>
      `;
    }

    return html`
      <div class="log-feed">
        <div class="log-feed__meta">
          <span class="log-feed__count"
            >${t('logs.showingCount', { count: String(this._logs.length) })}</span
          >
          ${this._hasMore
            ? html`<span class="log-feed__hint">${t('logs.moreAvailable')}</span>`
            : ''}
        </div>
        <ul class="log-feed__list" role="list">
          ${this._logs.map(
            (log) => html`
              <li>
                <button
                  type="button"
                  class="log-line"
                  data-level=${log.level || 'info'}
                  @click=${() => this._selectLog(log)}
                >
                  <span class="log-line__time">${this._formatTimeCompact(log.timestamp)}</span>
                  <span class="log-line__level" data-level=${log.level || 'info'}>${log.level || 'info'}</span>
                  <span class="log-line__module" title=${this._moduleLabel(log)}>${this._moduleLabel(log)}</span>
                  <span class="log-line__msg">${this._messagePreview(log)}</span>
                </button>
              </li>
            `,
          )}
        </ul>
        ${this._hasMore
          ? html`
              <div class="log-feed__more">
                <button
                  type="button"
                  class="btn btn-secondary log-feed__more-btn"
                  @click=${this._handleLoadMore}
                  ?disabled=${this._loading}
                >
                  ${this._loading
                    ? html`<span class="log-spinner" aria-hidden="true"></span>`
                    : getIcon('chevronDown')}
                  ${t('logs.loadMore')}
                </button>
              </div>
            `
          : ''}
      </div>
    `;
  }

  private _renderSkeleton(): unknown {
    return html`
      <div class="log-feed log-feed--loading" aria-busy="true">
        ${Array.from({ length: 12 }).map(
          () => html`
            <div class="log-skel">
              <div class="log-skel__t"></div>
              <div class="log-skel__l"></div>
              <div class="log-skel__m"></div>
              <div class="log-skel__x"></div>
            </div>
          `,
        )}
      </div>
    `;
  }

  private _renderFilesPanel(): unknown {
    return html`
      ${this._showFilesPanel
        ? html`<div class="log-files-backdrop" @click=${this._toggleFilesPanel}></div>`
        : ''}
      <aside
        class="log-files-panel ${this._showFilesPanel ? 'log-files-panel--open' : ''}"
        aria-hidden=${!this._showFilesPanel}
      >
        <div class="log-files-panel__head">
          <span class="log-files-panel__title">
            ${getIcon('folder')}
            ${t('logs.logFiles')}
          </span>
          <button
            type="button"
            class="log-icon-btn"
            @click=${this._toggleFilesPanel}
            aria-label=${t('settings.close')}
          >
            ${getIcon('x')}
          </button>
        </div>
        <div class="log-files-panel__body">
          ${this._files.length === 0
            ? html`<p class="log-files-panel__empty">${t('logs.filesEmpty')}</p>`
            : html`
                <ul class="log-files-list">
                  ${this._files.map(
                    (file) => html`
                      <li class="log-files-list__item">
                        <span class="log-files-list__name">${getIcon('file')}${file.name}</span>
                        <span class="log-files-list__meta">
                          <span>${this._formatFileSize(file.size)}</span>
                          <span>${this._formatTimestamp(file.modified)}</span>
                        </span>
                      </li>
                    `,
                  )}
                </ul>
              `}
        </div>
      </aside>
    `;
  }

  private _renderDetailDrawer(): unknown {
    if (!this._selectedLog) return '';
    const log = this._selectedLog;
    const level = (log.level || 'info') as LogLevel;

    return html`
      <div class="drawer-overlay" @click=${this._closeDetail}></div>
      <aside class="drawer drawer--right log-detail-drawer">
        <div class="drawer-header">
          <h2 class="drawer-header__title">${t('logs.details')}</h2>
          <button type="button" class="btn-icon" @click=${this._closeDetail} aria-label=${t('settings.close')}>
            ${getIcon('x')}
          </button>
        </div>
        <div class="drawer-content">
          <div class="log-detail">
            <div class="log-detail__row">
              <span class="log-detail__k">${t('logs.time')}</span>
              <code class="log-detail__v">${log.timestamp}</code>
            </div>
            <div class="log-detail__row">
              <span class="log-detail__k">${t('logs.level')}</span>
              <span class="log-line__level log-line__level--badge" data-level=${level}>${level}</span>
            </div>
            <div class="log-detail__row">
              <span class="log-detail__k">${t('logs.module')}</span>
              <code class="log-detail__v">${this._moduleLabel(log)}</code>
            </div>
            <div class="log-detail__block">
              <span class="log-detail__k">${t('logs.message')}</span>
              <pre class="log-detail__pre">${log.message || '—'}</pre>
            </div>
            ${log.meta
              ? html`
                  <div class="log-detail__block">
                    <span class="log-detail__k">${t('logs.metadata')}</span>
                    <pre class="log-detail__pre">${JSON.stringify(log.meta, null, 2)}</pre>
                  </div>
                `
              : ''}
          </div>
        </div>
      </aside>
    `;
  }
}

export default LogManager;
