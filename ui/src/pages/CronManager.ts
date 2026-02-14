// Cron Manager Page Component

import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons';
import { CronAPIClient, type CronJob, type CronJobExecution, type CronMetrics } from '../utils/cron-api';
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
  @state() private _loading = false;
  @state() private _error: string | null = null;

  // Form state
  @state() private _formOpen = false;
  @state() private _formName = '';
  @state() private _formSchedule = '*/5 * * * *';
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
      this._api = new CronAPIClient(httpUrl, this.config.token);
      this._loadJobs();
      this._loadMetrics();
    }
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

  // ========== Form ==========

  private _openForm(): void {
    this._formOpen = true;
    this._formName = '';
    this._formSchedule = '*/5 * * * *';
    this._formMessage = '';
  }

  private _closeForm(): void {
    this._formOpen = false;
    this._formName = '';
    this._formSchedule = '*/5 * * * *';
    this._formMessage = '';
  }

  private async _submitForm(): Promise<void> {
    if (!this._formSchedule || !this._formMessage) {
      this._error = 'Schedule and message are required';
      return;
    }

    this._formSubmitting = true;
    this._error = null;

    try {
      await this._api.addJob(this._formSchedule, this._formMessage, {
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
    this._confirmTitle = 'Run Job';
    this._confirmMessage = `Run "${job.name || job.id}" now?`;
    this._confirmJobId = job.id;
    this._confirmAction = 'run';
  }

  private _showDeleteConfirm(job: CronJob): void {
    this._confirmOpen = true;
    this._confirmTitle = 'Delete Job';
    this._confirmMessage = `Delete "${job.name || job.id}"? This cannot be undone.`;
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

  private async _executeConfirmAction(): Promise<void> {
    if (!this._confirmJobId || !this._confirmAction) return;

    const jobId = this._confirmJobId;
    this._closeConfirm();

    try {
      if (this._confirmAction === 'run') {
        await this._api.runJob(jobId);
        await this._loadJobs();
        await this._loadMetrics();
      } else if (this._confirmAction === 'delete') {
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
          <h1 class="page-title">${getIcon('clock')} Cron Jobs</h1>
          <div class="cron-manager__actions">
            <button class="btn btn--secondary" @click=${this._loadJobs} ?disabled=${this._loading}>
              ${getIcon('refresh')} Refresh
            </button>
            <button class="btn btn--primary" @click=${this._openForm}>
              ${getIcon('plus')} Add Job
            </button>
          </div>
        </div>

        <!-- Stats -->
        ${this._metrics ? html`
          <div class="cron-manager__stats">
            <div class="stat-card">
              <div class="stat-value">${this._metrics.totalJobs}</div>
              <div class="stat-label">Total</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${this._metrics.enabledJobs}</div>
              <div class="stat-label">Enabled</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">${this._metrics.runningJobs}</div>
              <div class="stat-label">Running</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" style="font-size: 0.875rem;">
                ${this._metrics.nextScheduledJob 
                  ? this._formatNextRun(this._metrics.nextScheduledJob.runAt)
                  : 'N/A'}
              </div>
              <div class="stat-label">Next Run</div>
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
                <button class="btn btn--primary" @click=${this._openForm}>Create your first job</button>
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
                    <th>Name</th>
                    <th>Schedule</th>
                    <th>Next Run</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${this._jobs.map(job => html`
                    <tr>
                      <td>
                        <button class="btn btn--link" @click=${() => this._openDetail(job)}>
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
                          <button class="btn btn--icon btn--secondary" title="Run Now" @click=${() => this._showRunConfirm(job)}>
                            ${getIcon('play')}
                          </button>
                          <button class="btn btn--icon btn--danger" title="Delete" @click=${() => this._showDeleteConfirm(job)}>
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
              <h2 class="modal__title">Add Cron Job</h2>
              <button class="btn-icon" @click=${this._closeForm}>${getIcon('x')}</button>
            </div>
            <div class="modal__content">
              <div class="form-field">
                <label class="form-field__label">Name (optional)</label>
                <input 
                  type="text" 
                  class="form-field__input"
                  .value=${this._formName}
                  @input=${(e: Event) => this._formName = (e.target as HTMLInputElement).value}
                  placeholder="My scheduled task"
                />
              </div>
              <div class="form-field">
                <label class="form-field__label">Schedule (cron expression) *</label>
                <input 
                  type="text" 
                  class="form-field__input"
                  .value=${this._formSchedule}
                  @input=${(e: Event) => this._formSchedule = (e.target as HTMLInputElement).value}
                  placeholder="*/5 * * * *"
                />
                <p class="form-field__hint">e.g., */5 * * * * (every 5 minutes), 0 9 * * * (daily at 9am)</p>
              </div>
              <div class="form-field">
                <label class="form-field__label">Message *</label>
                <textarea 
                  class="form-field__textarea"
                  .value=${this._formMessage}
                  @input=${(e: Event) => this._formMessage = (e.target as HTMLTextAreaElement).value}
                  placeholder="What should the assistant do?"
                  rows="4"
                ></textarea>
              </div>
            </div>
            <div class="modal__actions">
              <button class="btn btn--secondary" @click=${this._closeForm}>Cancel</button>
              <button 
                class="btn btn--primary" 
                @click=${this._submitForm}
                ?disabled=${this._formSubmitting || !this._formSchedule || !this._formMessage}
              >
                ${this._formSubmitting ? 'Creating...' : 'Create Job'}
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
                    <span class="session-detail__label">Schedule</span>
                    <code>${this._detailJob?.schedule}</code>
                  </div>
                  <div class="session-detail__row">
                    <span class="session-detail__label">Message</span>
                    <span>${this._detailJob?.message}</span>
                  </div>
                  <div class="session-detail__row">
                    <span class="session-detail__label">Status</span>
                    <span>${this._detailJob?.enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                  <div class="session-detail__row">
                    <span class="session-detail__label">Next Run</span>
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
        .confirmText=${this._confirmAction === 'delete' ? 'Delete' : 'Run'}
        .cancelText="Cancel"
        .type=${this._confirmAction === 'delete' ? 'danger' : 'warning'}
        @confirm=${(e: CustomEvent<{ confirmed: boolean }>) => {
          if (e.detail.confirmed) {
            this._executeConfirmAction();
          } else {
            this._closeConfirm();
          }
        }}
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
