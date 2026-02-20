// Cron Manager Page Component

import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons';
import { t } from '../utils/i18n';
import { CronAPIClient, type CronJob, type CronJobExecution, type CronMetrics, type ChannelStatus, type ModelInfo } from '../utils/cron-api';
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
  @state() private _availableModels: ModelInfo[] = [];
  @state() private _defaultModel: string = '';
  @state() private _loading = false;
  @state() private _error: string | null = null;

  // Form state
  @state() private _formOpen = false;
  @state() private _formMode: 'add' | 'edit' = 'add';
  @state() private _formJobId: string | null = null;
  @state() private _formName = '';
  @state() private _formSchedule = '*/5 * * * *';
  @state() private _formChannel = 'telegram';
  @state() private _formChatId = '';
  @state() private _formMessage = '';
  @state() private _formSessionTarget: 'main' | 'isolated' = 'main';
  @state() private _formModel = '';
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
    this._loadModels();
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

  private async _loadModels(): Promise<void> {
    try {
      // Load available models from configured providers
      this._availableModels = await this._api.getModels();
      
      // Load config to get default model
      const config = await this._api.getConfig();
      this._defaultModel = config.model || '';
      
      // Set form default model
      this._formModel = this._defaultModel;
      
      console.log('[CronManager] Loaded models:', this._availableModels.length, 'default:', this._defaultModel);
    } catch (err) {
      console.error('[CronManager] Models error:', err);
    }
  }

  // ========== Form ==========

  private _openForm(job?: CronJob): void {
    this._formOpen = true;
    this._formMode = job ? 'edit' : 'add';
    this._formJobId = job?.id || null;
    
    if (job) {
      // Editing existing job - populate form
      this._formName = job.name || '';
      this._formSchedule = job.schedule;
      this._formMessage = job.message;
      this._formSessionTarget = job.sessionTarget || 'main';
      this._formModel = job.model || '';
      
      // Parse delivery info
      if (job.delivery) {
        this._formChannel = job.delivery.channel || 'telegram';
        this._formChatId = job.delivery.to || '';
      } else {
        // Try to parse from message format: "channel:chat_id:message"
        const parts = job.message.split(':');
        const knownChannels = ['telegram', 'whatsapp', 'cli', 'gateway'];
        if (parts.length >= 3 && knownChannels.includes(parts[0])) {
          this._formChannel = parts[0];
          this._formChatId = parts[1];
          this._formMessage = parts.slice(2).join(':');
        } else {
          this._formChannel = 'telegram';
          this._formChatId = '';
        }
      }
    } else {
      // Adding new job
      this._formName = '';
      this._formSchedule = '*/5 * * * *';
      this._formChannel = 'telegram';
      this._formChatId = '';
      this._formMessage = '';
      this._formSessionTarget = 'main';
      this._formModel = this._defaultModel || (this._availableModels.length > 0 ? this._availableModels[0].id : '');
    }
  }

  private _closeForm(): void {
    this._formOpen = false;
    this._formMode = 'add';
    this._formJobId = null;
    this._formName = '';
    this._formSchedule = '*/5 * * * *';
    this._formChannel = 'telegram';
    this._formChatId = '';
    this._formMessage = '';
    this._formSessionTarget = 'main';
    this._formModel = '';
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
      // Build message (just the content, not prefixed with channel:chat_id)
      const message = this._formMessage;
      
      // Build delivery config
      const delivery = {
        mode: 'direct' as const,
        channel: this._formChannel,
        to: this._formChatId,
      };

      // Build payload based on session target
      const payload = this._formSessionTarget === 'isolated'
        ? { kind: 'agentTurn' as const, message, model: this._formModel }
        : { kind: 'systemEvent' as const, text: message };

      const jobData = {
        name: this._formName || undefined,
        schedule: this._formSchedule,
        message,
        sessionTarget: this._formSessionTarget,
        model: this._formSessionTarget === 'isolated' ? this._formModel : undefined,
        delivery,
      };

      if (this._formMode === 'edit' && this._formJobId) {
        // Update existing job
        await this._api.updateJob(this._formJobId, jobData);
      } else {
        // Add new job
        await this._api.addJob(this._formSchedule, message, jobData);
      }
      
      this._closeForm();
      await this._loadJobs();
      await this._loadMetrics();
    } catch (err) {
      this._error = err instanceof Error ? err.message : `Failed to ${this._formMode} job`;
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
            <button class="btn btn-primary" @click=${() => this._openForm()}>
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
                          <button class="btn btn-icon btn-secondary" title="Edit" @click=${() => this._openForm(job)}>
                            ${getIcon('edit')}
                          </button>
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

      <!-- Add/Edit Job Form Modal -->
      ${this._formOpen ? html`
        <div class="modal-backdrop" @click=${this._closeForm}>
          <div class="modal modal--form" @click=${(e: Event) => e.stopPropagation()}>
            <div class="modal__header">
              <h2 class="modal__title">${this._formMode === 'edit' ? 'Edit Job' : t('cron.addJob')}</h2>
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
                <label class="form-field__label">Mode</label>
                <select 
                  class="form-field__select"
                  .value=${this._formSessionTarget}
                  @change=${(e: Event) => this._formSessionTarget = (e.target as HTMLSelectElement).value as 'main' | 'isolated'}
                >
                  <option value="main">Direct (send message directly)</option>
                  <option value="isolated">AI Agent (process with AI then send)</option>
                </select>
                <p class="form-field__hint">
                  ${this._formSessionTarget === 'main' 
                    ? 'Send message directly to the channel without AI processing'
                    : 'Use AI agent to process the message, then send the response'}
                </p>
              </div>
              ${this._formSessionTarget === 'isolated' ? html`
                <div class="form-field">
                  <label class="form-field__label">Model</label>
                  <select 
                    class="form-field__select"
                    .value=${this._formModel}
                    @change=${(e: Event) => this._formModel = (e.target as HTMLSelectElement).value}
                  >
                    ${this._availableModels.length > 0 ? this._availableModels.map(model => html`
                      <option value=${model.id}>${model.name} (${model.provider})</option>
                    `) : html`
                      <option value="">No configured models</option>
                    `}
                  </select>
                </div>
              ` : nothing}
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
                ${this._formSubmitting ? t('common.loading') : (this._formMode === 'edit' ? 'Save' : t('cron.create'))}
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
