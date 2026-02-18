// Cron Manager Page Component

import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons';
import { t } from '../utils/i18n';
import { CronAPIClient, type CronJob, type CronJobExecution, type CronMetrics, type ChannelStatus } from '../utils/cron-api';
import '../components/ConfirmDialog';

export interface CronManagerConfig {
  url: string;
  token?: string;
}

@customElement('cron-manager')
export class CronManager extends LitElement {
  @property({ attribute: false }) config?: CronManagerConfig;

  @state() private _jobs: CronJob[] = [];
  @state() private _metrics: CronMetrics | null = null;
  @state() private _channels: ChannelStatus[] = [];
  @state() private _loading = false;
  @state() private _error: string | null = null;

  // Form state
  @state() private _formOpen = false;
  @state() private _formName = '';
  @state() private _formSchedule = '*/5 * * * *';
  @state() private _formChannel = 'telegram';
  @state() private _formChatId = '';
  @state() private _formMessage = '';
  @state() private _formSubmitting = false;

  // Detail drawer state
  @state() private _detailOpen = false;
  @state() private _detailJob: CronJob | null = null;
  @state() private _detailHistory: CronJobExecution[] = [];
  @state() private _detailLoading = false;

  // Confirm dialog state
  @state() private _confirmOpen = false;
  @state() private _confirmTitle = '';
  @state() private _confirmMessage = '';
  @state() private _confirmJobId: string | null = null;
  @state() private _confirmAction: 'delete' | 'run' | null = null;

  private _api!: CronAPIClient;
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
    this._api = new CronAPIClient(httpUrl, this.config.token);
    this._initialized = true;
    this._loadJobs();
    this._loadMetrics();
    this._loadChannels();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._api?.disconnect();
  }

  private async _loadJobs(): Promise<void> {
    if (this._loading) return;
    this._loading = true;
    this._error = null;

    try {
      this._jobs = await this._api.listJobs();
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Failed to load jobs';
      console.error('[CronManager] Load error:', err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadMetrics(): Promise<void> {
    try {
      this._metrics = await this._api.getMetrics();
    } catch (err) {
      console.error('[CronManager] Metrics error:', err);
    }
  }

  private async _loadChannels(): Promise<void> {
    try {
      this._channels = await this._api.getChannels();
    } catch (err) {
      console.error('[CronManager] Channels error:', err);
    }
  }

  // ========== Form ==========

  private _openForm(): void {
    this._formOpen = true;
    this._formName = '';
    this._formSchedule = '*/5 * * * *';
    this._formChannel = 'telegram';
    this._formChatId = '';
    this._formMessage = '';
  }

  private _closeForm(): void {
    this._formOpen = false;
    this._formName = '';
    this._formSchedule = '*/5 * * * *';
    this._formChannel = 'telegram';
    this._formChatId = '';
    this._formMessage = '';
  }

  private async _submitForm(): Promise<void> {
    if (!this._formSchedule || !this._formMessage) {
      this._error = 'Schedule and message are required';
      return;
    }

    if (!this._formChatId) {
      this._error = 'Chat ID is required';
      return;
    }

    this._formSubmitting = true;
    this._error = null;

    try {
      // Format: channel:chat_id:message
      const message = `${this._formChannel}:${this._formChatId}:${this._formMessage}`;
      await this._api.addJob(this._formSchedule, message, {
        name: this._formName || undefined,
      });
      this._closeForm();
      await this._loadJobs();
      await this._loadMetrics();
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Failed to add job';
    } finally {
      this._formSubmitting = false;
    }
  }

  // ========== Detail Drawer ==========

  private async _openDetail(job: CronJob): Promise<void> {
    this._detailOpen = true;
    this._detailJob = job;
    this._detailLoading = true;

    try {
      const fullJob = await this._api.getJob(job.id);
      if (fullJob) {
        this._detailJob = fullJob;
        this._detailHistory = await this._api.getHistory(job.id, 20);
      }
    } catch (err) {
      console.error('[CronManager] Load detail error:', err);
    } finally {
      this._detailLoading = false;
    }
  }

  private _closeDetail(): void {
    this._detailOpen = false;
    this._detailJob = null;
    this._detailHistory = [];
  }

  // ========== Actions ==========

  private async _toggleJob(job: CronJob, enabled: boolean): Promise<void> {
    try {
      await this._api.toggleJob(job.id, enabled);
      await this._loadJobs();
      await this._loadMetrics();
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Failed to toggle job';
    }
  }

  private _showRunConfirm(job: CronJob): void {
    this._confirmOpen = true;
    this._confirmTitle = t('cron.runNow');
    this._confirmMessage = t('cron.confirmRun');
    this._confirmJobId = job.id;
    this._confirmAction = 'run';
  }

  private _showDeleteConfirm(job: CronJob): void {
    this._confirmOpen = true;
    this._confirmTitle = t('cron.delete');
    this._confirmMessage = t('cron.confirmDelete');
    this._confirmJobId = job.id;
    this._confirmAction = 'delete';
  }

  private _closeConfirm(): void {
    this._confirmOpen = false;
    this._confirmTitle = '';
    this._confirmMessage = '';
    this._confirmJobId = null;
    this._confirmAction = null;
  }

  private _handleConfirm(e: CustomEvent<{ confirmed: boolean }>): void {
    if (e.detail.confirmed) {
      this._executeConfirmAction();
    } else {
      this._closeConfirm();
    }
  }

  private async _executeConfirmAction(): Promise<void> {
    if (!this._confirmJobId || !this._confirmAction) {
      return;
    }

    const jobId = this._confirmJobId;
    const action = this._confirmAction;  // Save before closing
    this._closeConfirm();
    
    try {
      if (action === 'run') {
        await this._api.runJob(jobId);
        await this._loadJobs();
        await this._loadMetrics();
      } else if (action === 'delete') {
        await this._api.removeJob(jobId);
        await this._loadJobs();
        await this._loadMetrics();
      }
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Action failed';
    }
  }

  // ========== Render ==========

  override render(): ReturnType<typeof html> {
    return html`
      <div class="cron-manager">
        ${this._error ? html`<div class="error-banner">${this._error}</div>` : ''}

        <!-- Header -->
        <div class="cron-manager__header">
          <h1 class="page-title">${getIcon('clock')} ${t('cron.title')}</h1>
          <div class="cron-manager__actions">
            <button class="btn btn-secondary" @click=${this._loadJobs} ?disabled=${this._loading}>
              ${getIcon('refresh')} ${t('logs.refresh')}
            </button>
            <button class="btn btn-primary" @click=${this._openForm}>
              ${getIcon('plus')} ${t('cron.addJob')}
            </button>
          </div>
        </div>

        <!-- Stats -->
        ${this._metrics ? html`
          <div class="cron-manager__stats">
            <div class="stat-card">
              <div class="stat-value">${this._metrics.totalJobs}</div>
              <div class="stat-label">${t('sessions.totalSessions')}</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${this._metrics.enabledJobs}</div>
              <div class="stat-label">${t('cron.enabled')}</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${this._metrics.runningJobs}</div>
              <div class="stat-label">${t('cron.running')}</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" style="font-size: 0.875rem;">
                ${this._metrics.nextScheduledJob 
                  ? this._formatNextRun(this._metrics.nextScheduledJob.runAt)
                  : 'N/A'}
              </div>
              <div class="stat-label">${t('cron.nextRun')}</div>
            </div>
          </div>
        ` : nothing}

        <!-- Job List -->
        <div class="session-list">
          ${this._loading && this._jobs.length === 0 ? html`
            <div class="session-list__loading-overlay">
              <div class="spinner"></div>
            </div>
          ` : this._jobs.length === 0 ? html`
            <div class="session-list session-list--empty">
              <div class="empty-state">
                <div class="empty-state__icon">${getIcon('clock')}</div>
                <div class="empty-state__title">No cron jobs yet</div>
                <button class="btn btn-primary" @click=${this._openForm}>Create your first job</button>
              </div>
            </div>
          ` : html`
            <div class="session-list__toolbar">
              <div class="session-list__count">${this._jobs.length} job${this._jobs.length !== 1 ? 's' : ''}</div>
            </div>
            <div class="session-list__content">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>${t('cron.name')}</th>
                    <th>${t('cron.scheduleLabel')}</th>
                    <th>${t('cron.nextRun')}</th>
                    <th>${t('cron.status')}</th>
                    <th>${t('cron.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  ${this._jobs.map(job => html`
                    <tr>
                      <td>
                        <button class="btn btn-link" @click=${() => this._openDetail(job)}>
                          ${job.name || job.id}
                        </button>
                      </td>
                      <td><code>${job.schedule}</code></td>
                      <td>${job.next_run ? this._formatNextRun(job.next_run) : '-'}</td>
                      <td>
                        <label class="toggle">
                          <input 
                            type="checkbox" 
                            ?checked=${job.enabled}
                            @change=${(e: Event) => this._toggleJob(job, (e.target as HTMLInputElement).checked)}
                          />
                          <span class="toggle__slider"></span>
                        </label>
                      </td>
                      <td>
                        <div class="action-buttons">
                          <button class="btn btn-icon btn-secondary" title="${t('cron.runNow')}" @click=${() => this._showRunConfirm(job)}>
                            ${getIcon('play')}
                          </button>
                          <button class="btn btn-icon btn-danger" title="${t('cron.delete')}" @click=${() => this._showDeleteConfirm(job)}>
                            ${getIcon('trash')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  `)}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>

      <!-- Add Job Form Modal -->
      ${this._formOpen ? html`
        <div class="modal-backdrop" @click=${this._closeForm}>
          <div class="modal modal--form" @click=${(e: Event) => e.stopPropagation()}>
            <div class="modal__header">
              <h2 class="modal__title">${t('cron.addJob')}</h2>
              <button class="btn-icon" @click=${this._closeForm}>${getIcon('x')}</button>
            </div>
            <div class="modal__content">
              <div class="form-field">
                <label class="form-field__label">${t('cron.name')}</label>
                <input 
                  type="text" 
                  class="form-field__input"
                  .value=${this._formName}
                  @input=${(e: Event) => this._formName = (e.target as HTMLInputElement).value}
                  placeholder="${t('cron.namePlaceholder')}"
                />
              </div>
              <div class="form-field">
                <label class="form-field__label">${t('cron.schedule')}</label>
                <input 
                  type="text" 
                  class="form-field__input"
                  .value=${this._formSchedule}
                  @input=${(e: Event) => this._formSchedule = (e.target as HTMLInputElement).value}
                  placeholder="*/5 * * * *"
                />
                <p class="form-field__hint">${t('cron.scheduleHint')}</p>
              </div>
              <div class="form-field">
                <label class="form-field__label">Channel</label>
                <select 
                  class="form-field__select"
                  .value=${this._formChannel}
                  @change=${(e: Event) => this._formChannel = (e.target as HTMLSelectElement).value}
                >
                  ${this._channels.map(ch => html`
                    <option value=${ch.name} ?disabled=${!ch.enabled}>
                      ${ch.name} ${!ch.enabled ? '(disabled)' : ''}
                    </option>
                  `)}
                </select>
              </div>
              <div class="form-field">
                <label class="form-field__label">Chat ID *</label>
                <input 
                  type="text" 
                  class="form-field__input"
                  .value=${this._formChatId}
                  @input=${(e: Event) => this._formChatId = (e.target as HTMLInputElement).value}
                  placeholder="e.g., 123456789"
                />
              </div>
              <div class="form-field">
                <label class="form-field__label">${t('cron.message')}</label>
                <textarea 
                  class="form-field__textarea"
                  .value=${this._formMessage}
                  @input=${(e: Event) => this._formMessage = (e.target as HTMLTextAreaElement).value}
                  placeholder="${t('cron.messagePlaceholder')}"
                  rows="4"
                ></textarea>
              </div>
            </div>
            <div class="modal__actions">
              <button class="btn btn-secondary" @click=${this._closeForm}>${t('common.cancel')}</button>
              <button 
                class="btn btn-primary" 
                @click=${this._submitForm}
                ?disabled=${this._formSubmitting || !this._formSchedule || !this._formChatId || !this._formMessage}
              >
                ${this._formSubmitting ? t('common.loading') : t('cron.create')}
              </button>
            </div>
          </div>
        </div>
      ` : nothing}

      <!-- Detail Drawer -->
      ${this._detailOpen ? html`
        <div class="drawer-backdrop" @click=${this._closeDetail}>
          <div class="drawer drawer--open" @click=${(e: Event) => e.stopPropagation()}>
            <div class="drawer-header">
              <div class="drawer-header__info">
                <div class="drawer-header__title">${this._detailJob?.name || this._detailJob?.id}</div>
              </div>
              <button class="btn-icon" @click=${this._closeDetail}>${getIcon('x')}</button>
            </div>
            <div class="drawer-content ${this._detailLoading ? 'drawer-content--loading' : ''}">
              ${this._detailLoading ? html`
                <div class="spinner"></div>
              ` : html`
                <div class="session-detail">
                  <div class="session-detail__row">
                    <span class="session-detail__label">${t('cron.scheduleLabel')}</span>
                    <code>${this._detailJob?.schedule}</code>
                  </div>
                  <div class="session-detail__row">
                    <span class="session-detail__label">${t('cron.messageLabel')}</span>
                    <span>${this._detailJob?.message}</span>
                  </div>
                  <div class="session-detail__row">
                    <span class="session-detail__label">${t('cron.status')}</span>
                    <span>${this._detailJob?.enabled ? t('cron.enabled') : t('cron.disabled')}</span>
                  </div>
                  <div class="session-detail__row">
                    <span class="session-detail__label">${t('cron.nextRun')}</span>
                    <span>${this._detailJob?.next_run ? this._formatNextRun(this._detailJob.next_run) : 'N/A'}</span>
                  </div>
                </div>
              `}
            </div>
          </div>
        </div>
      ` : nothing}

      <!-- Confirm Dialog -->
      <confirm-dialog
        .open=${this._confirmOpen}
        .title=${this._confirmTitle}
        .message=${this._confirmMessage}
        .confirmText=${this._confirmAction === 'delete' ? t('cron.delete') : t('cron.runNow')}
        .cancelText=${t('common.cancel')}
        .type=${this._confirmAction === 'delete' ? 'danger' : 'warning'}
        @confirm=${this._handleConfirm}
      ></confirm-dialog>
    `;
  }

  // ========== Helpers ==========

  private _formatNextRun(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    
    if (diff < 0) return 'Overdue';
    if (diff < 60000) return 'Less than a minute';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours`;
    return d.toLocaleString();
  }

  private _formatTime(date: string): string {
    return new Date(date).toLocaleString();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'cron-manager': CronManager;
  }
}
