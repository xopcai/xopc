// Cron Manager Page Component

import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons';
import { t } from '../utils/i18n';
import { CronAPIClient, cronJobBodyText, type CronJob, type CronJobExecution, type CronMetrics, type ChannelStatus, type ModelInfo, type SessionChatId, type CronRunHistoryRow } from '../utils/cron-api';
import '../components/ConfirmDialog';
import '../components/ModelSelector';
import type { ModelSelectEvent } from '../components/ModelSelector';

export interface CronManagerConfig {
  url?: string;
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
  @state() private _sessionChatIds: SessionChatId[] = [];
  @state() private _loading = false;
  @state() private _error: string | null = null;
  @state() private _runHistory: CronRunHistoryRow[] = [];
  @state() private _runHistoryLoading = false;

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

  private _onDocKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    if (this._formOpen) {
      this._closeForm();
    } else if (this._detailOpen) {
      this._closeDetail();
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

  private _tryInitialize(): void {
    if (this._initialized) {
      return;
    }
    const httpUrl = window.location.origin;
    this._api = new CronAPIClient(httpUrl, this.config?.token);
    this._initialized = true;
    this._loadJobs();
    this._loadMetrics();
    this._loadChannels();
    this._loadModels();
    this._loadSessionChatIds();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._onDocKeydown);
    this._api?.disconnect();
  }

  private async _loadJobs(): Promise<void> {
    if (this._loading) return;
    this._loading = true;
    this._error = null;

    try {
      this._jobs = await this._api.listJobs();
      await this._loadRunHistory();
    } catch (err) {
      this._error = err instanceof Error ? (err.message || t('cron.failedToLoadJobs')) : t('cron.failedToLoadJobs');
      console.error('[CronManager] Load error:', err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadRunHistory(): Promise<void> {
    this._runHistoryLoading = true;
    try {
      this._runHistory = await this._api.getAllRunsHistory(30);
    } catch (err) {
      console.error('[CronManager] Run history:', err);
    } finally {
      this._runHistoryLoading = false;
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
      
    } catch (err) {
      console.error('[CronManager] Models error:', err);
    }
  }

  private async _loadSessionChatIds(): Promise<void> {
    try {
      const chatIds = await this._api.getSessionChatIds(this._formChannel);
      this._sessionChatIds = chatIds;
    } catch (err) {
      console.error('[CronManager] Session chatIds error:', err);
      this._sessionChatIds = [];
    }
  }

  // ========== Form ==========

  private _openForm(job?: CronJob): void {
    this._formOpen = true;
    this._formMode = job ? 'edit' : 'add';
    this._formJobId = job?.id || null;
    
    // Refresh session chat IDs when opening form
    this._loadSessionChatIds();

    if (job) {
      // Editing existing job - populate form
      this._formName = job.name || '';
      this._formSchedule = job.schedule;
      const bodyText = cronJobBodyText(job);
      this._formMessage = bodyText;
      this._formSessionTarget = job.sessionTarget || 'main';
      this._formModel = job.model || '';
      
      // Parse delivery info
      if (job.delivery) {
        this._formChannel = job.delivery.channel || 'telegram';
        this._formChatId = job.delivery.to || '';
      } else {
        // Try to parse from legacy body format: "channel:chat_id:content"
        const parts = bodyText.split(':');
        const knownChannels = ['telegram', 'cli', 'gateway'];
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
      this._error = t('cron.scheduleRequired');
      return;
    }

    if (!this._formChatId) {
      this._error = t('cron.chatIdRequired');
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

      // Build payload based on session target (must be sent on update or payload stays stale)
      const payload = this._formSessionTarget === 'isolated'
        ? { kind: 'agentTurn' as const, message, model: this._formModel }
        : { kind: 'systemEvent' as const, text: message };

      const jobData = {
        name: this._formName || undefined,
        schedule: this._formSchedule,
        sessionTarget: this._formSessionTarget,
        model: this._formSessionTarget === 'isolated' ? this._formModel : undefined,
        delivery,
        payload,
      };

      if (this._formMode === 'edit' && this._formJobId) {
        // Update existing job
        await this._api.updateJob(this._formJobId, jobData);
      } else {
        // Add new job
        await this._api.addJob(this._formSchedule, jobData);
      }
      
      this._closeForm();
      await this._loadJobs();
      await this._loadMetrics();
    } catch (err) {
      this._error = err instanceof Error ? (err.message || t('cron.failedToJob', { mode: this._formMode })) : t('cron.failedToJob', { mode: this._formMode });
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
      this._error = err instanceof Error ? (err.message || t('cron.failedToToggleJob')) : t('cron.failedToToggleJob');
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
        if (this._detailJob?.id === jobId) {
          this._closeDetail();
        }
        await this._loadJobs();
        await this._loadMetrics();
      }
    } catch (err) {
      this._error = err instanceof Error ? (err.message || t('cron.actionFailed')) : t('cron.actionFailed');
    }
  }

  // ========== Render ==========

  override render(): ReturnType<typeof html> {
    return html`
      <div class="cron-page">
        ${this._error ? html`<div class="cron-page__error" role="alert">${this._error}</div>` : nothing}

        <header class="cron-page__header">
          <div class="cron-page__header-main">
            <div class="cron-page__icon" aria-hidden="true">${getIcon('clock')}</div>
            <div class="cron-page__titles">
              <h1 class="cron-page__title">${t('cron.title')}</h1>
              <p class="cron-page__subtitle">${t('cron.subtitle')}</p>
            </div>
          </div>
          <div class="cron-page__actions">
            <button
              type="button"
              class="log-icon-btn"
              @click=${this._loadJobs}
              ?disabled=${this._loading}
              title=${t('logs.refresh')}
              aria-label=${t('logs.refresh')}
            >
              ${getIcon('refreshCw')}
            </button>
            <button type="button" class="btn btn-primary cron-page__add" @click=${() => this._openForm()}>
              ${getIcon('plus')}
              ${t('cron.addJob')}
            </button>
          </div>
        </header>

        ${this._metrics
          ? html`
              <div class="cron-stats" role="region" aria-label=${t('cron.statsRegion')}>
                <div class="cron-stat">
                  <div class="cron-stat__value">${this._metrics.totalJobs}</div>
                  <div class="cron-stat__label">${t('cron.totalJobs')}</div>
                </div>
                <div class="cron-stat">
                  <div class="cron-stat__value">${this._metrics.enabledJobs}</div>
                  <div class="cron-stat__label">${t('cron.enabled')}</div>
                </div>
                <div class="cron-stat">
                  <div class="cron-stat__value">${this._metrics.runningJobs}</div>
                  <div class="cron-stat__label">${t('cron.running')}</div>
                </div>
                <div class="cron-stat cron-stat--wide">
                  <div class="cron-stat__value cron-stat__value--muted">
                    ${this._metrics.nextScheduledJob
                      ? this._formatNextRun(this._metrics.nextScheduledJob.runAt)
                      : '—'}
                  </div>
                  <div class="cron-stat__label">${t('cron.nextRun')}</div>
                </div>
              </div>
            `
          : nothing}

        <section class="cron-section cron-jobs-section" aria-label=${t('cron.jobsHeading')}>
          <div class="cron-jobs-section__head">
            <h2 class="cron-jobs-section__title">${t('cron.jobsHeading')}</h2>
            ${this._jobs.length > 0
              ? html`<span class="cron-jobs-section__count">${this._jobs.length}</span>`
              : nothing}
          </div>
          ${this._loading && this._jobs.length === 0
            ? html`
                <div class="cron-jobs-section__loading" aria-busy="true">
                  <div class="cron-spinner"></div>
                </div>
              `
            : this._jobs.length === 0
              ? html`
                  <div class="cron-empty">
                    <div class="cron-empty__icon" aria-hidden="true">${getIcon('clock')}</div>
                    <h3 class="cron-empty__title">${t('cron.emptyStateTitle')}</h3>
                    <p class="cron-empty__text">${t('cron.emptyStateHint')}</p>
                    <button type="button" class="btn btn-primary cron-empty__cta" @click=${this._openForm}>
                      ${t('cron.emptyStateCta')}
                    </button>
                  </div>
                `
              : html`
            <div class="cron-job-grid">
              ${this._jobs.map(
                (job) => html`
                <article
                  class="cron-job-card"
                  role="button"
                  tabindex="0"
                  @click=${() => this._openDetail(job)}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      this._openDetail(job);
                    }
                  }}
                >
                  <div class="cron-job-card__top">
                    <h3 class="cron-job-card__title">${job.name || job.id}</h3>
                    <span class="cron-job-card__badge ${job.enabled ? 'cron-job-card__badge--on' : 'cron-job-card__badge--off'}">
                      ${job.enabled ? t('cron.enabled') : t('cron.disabled')}
                    </span>
                  </div>
                  ${job.name ? html`<p class="cron-job-card__id"><code>${job.id}</code></p>` : nothing}
                  <div class="cron-job-card__schedule">
                    <span class="cron-job-card__label">${t('cron.scheduleLabel')}</span>
                    <code class="cron-job-card__cron">${job.schedule}</code>
                  </div>
                  <div class="cron-job-card__row">
                    <span class="cron-job-card__label">${t('cron.nextRun')}</span>
                    <span class="cron-job-card__value">${job.next_run ? this._formatNextRun(job.next_run) : '—'}</span>
                  </div>
                  <p class="cron-job-card__preview" title=${cronJobBodyText(job)}>${this._truncate(cronJobBodyText(job), 120)}</p>
                  <div class="cron-job-card__footer">
                    <div class="cron-job-card__toggle" @click=${(e: Event) => e.stopPropagation()} title=${t('cron.enabled')}>
                      <label class="toggle">
                        <input
                          type="checkbox"
                          ?checked=${job.enabled}
                          @change=${(e: Event) => this._toggleJob(job, (e.target as HTMLInputElement).checked)}
                        />
                        <span class="toggle__slider"></span>
                      </label>
                    </div>
                    <div class="cron-job-card__actions" @click=${(e: Event) => e.stopPropagation()}>
                      <button
                        type="button"
                        class="btn-icon"
                        title="${t('cron.edit')}"
                        aria-label="${t('cron.edit')}"
                        @click=${() => this._openForm(job)}
                      >
                        ${getIcon('edit')}
                      </button>
                      <button
                        type="button"
                        class="btn-icon"
                        title="${t('cron.runNow')}"
                        aria-label="${t('cron.runNow')}"
                        @click=${() => this._showRunConfirm(job)}
                      >
                        ${getIcon('play')}
                      </button>
                      <button
                        type="button"
                        class="btn-icon cron-job-card__btn--danger"
                        title="${t('cron.delete')}"
                        aria-label="${t('cron.delete')}"
                        @click=${() => this._showDeleteConfirm(job)}
                      >
                        ${getIcon('trash')}
                      </button>
                    </div>
                  </div>
                </article>
              `
              )}
            </div>
          `}
        </section>

        <section class="cron-section cron-run-log" aria-label=${t('cron.runHistoryTitle')}>
          <div class="cron-run-log__head">
            <div>
              <h2 class="cron-run-log__title">${t('cron.runHistoryTitle')}</h2>
              <p class="cron-run-log__hint">${t('cron.runHistoryHint')}</p>
            </div>
            <button
              type="button"
              class="log-icon-btn"
              @click=${this._loadRunHistory}
              ?disabled=${this._runHistoryLoading}
              title=${t('logs.refresh')}
              aria-label=${t('logs.refresh')}
            >
              ${getIcon('refreshCw')}
            </button>
          </div>
          ${this._runHistoryLoading && this._runHistory.length === 0
            ? html`
                <div class="cron-run-log__loading" aria-busy="true">
                  <div class="cron-spinner"></div>
                </div>
              `
            : this._runHistory.length === 0
              ? html`<p class="cron-run-log__empty">${t('cron.noRunsYet')}</p>`
              : html`
                  <div class="cron-run-log__table-wrap">
                    <table class="data-table cron-run-log__table cron-run-log__table--full">
                      <thead>
                        <tr>
                          <th>${t('cron.colStarted')}</th>
                          <th>${t('cron.colJob')}</th>
                          <th>${t('cron.status')}</th>
                          <th>${t('cron.colDuration')}</th>
                          <th>${t('cron.colDetail')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${this._runHistory.map((row) => html`
                          <tr>
                            <td><time datetime=${row.startedAt}>${this._formatTime(row.startedAt)}</time></td>
                            <td>
                              ${this._jobs.some((j) => j.id === row.jobId)
                                ? html`<button
                                    type="button"
                                    class="cron-run-log__job-link"
                                    @click=${() => {
                                      const j = this._jobs.find((x) => x.id === row.jobId);
                                      if (j) this._openDetail(j);
                                    }}
                                  >
                                    ${row.jobName || row.jobId}
                                  </button>`
                                : html`<span class="cron-run-log__job-id">${row.jobName || row.jobId}</span>`}
                            </td>
                            <td>
                              <span class="cron-run-log__pill cron-run-log__pill--${row.status}"
                                >${this._execStatusLabel(row.status)}</span
                              >
                            </td>
                            <td>${this._formatDuration(row.duration)}</td>
                            <td class="cron-run-log__detail" title=${row.summary || row.error || ''}>
                              ${this._truncate(row.summary || row.error, 96)}
                            </td>
                          </tr>
                        `)}
                      </tbody>
                    </table>
                  </div>
                `}
        </section>
      </div>

      <!-- Add/Edit Job Form Modal -->
      ${this._formOpen ? html`
        <div class="modal-backdrop" @click=${this._closeForm}>
          <div class="modal modal--form" @click=${(e: Event) => e.stopPropagation()}>
            <div class="modal__header">
              <h2 class="modal__title">${this._formMode === 'edit' ? t('cron.editJob') : t('cron.addJob')}</h2>
              <button type="button" class="btn-icon" @click=${this._closeForm} aria-label=${t('settings.close')}>
                ${getIcon('x')}
              </button>
            </div>
            <div class="modal__content">
              <div class="form-field">
                <label class="form-field__label">${t('cron.name')}</label>
                <input
                  type="text"
                  class="form-field__input"
                  .value=${this._formName ?? ''}
                  @input=${(e: Event) => this._formName = (e.target as HTMLInputElement).value}
                  placeholder="${t('cron.namePlaceholder') ?? 'My scheduled task'}"
                />
              </div>
              <div class="form-field">
                <label class="form-field__label">${t('cron.schedule')}</label>
                <div class="cron-form__inline">
                  <input
                    type="text"
                    class="form-field__input cron-form__input-grow"
                    .value=${this._formSchedule ?? '*/5 * * * *'}
                    @input=${(e: Event) => this._formSchedule = (e.target as HTMLInputElement).value}
                    placeholder="*/5 * * * *"
                  />
                  <select
                    class="form-field__select cron-form__select-shrink"
                    .value=${this._formSchedule ?? '*/5 * * * *'}
                    @change=${(e: Event) => {
                      const value = (e.target as HTMLSelectElement).value;
                      if (value) {
                        this._formSchedule = value;
                      }
                    }}
                  >
                    <option value="">${t('cron.schedulePresets.custom')}</option>
                    <option value="*/1 * * * *">${t('cron.schedulePresets.everyMinute')}</option>
                    <option value="*/5 * * * *">${t('cron.schedulePresets.every5Minutes')}</option>
                    <option value="*/10 * * * *">${t('cron.schedulePresets.every10Minutes')}</option>
                    <option value="*/15 * * * *">${t('cron.schedulePresets.every15Minutes')}</option>
                    <option value="*/30 * * * *">${t('cron.schedulePresets.every30Minutes')}</option>
                    <option value="0 * * * *">${t('cron.schedulePresets.everyHour')}</option>
                    <option value="0 */2 * * *">${t('cron.schedulePresets.every2Hours')}</option>
                    <option value="0 */4 * * *">${t('cron.schedulePresets.every4Hours')}</option>
                    <option value="0 */6 * * *">${t('cron.schedulePresets.every6Hours')}</option>
                    <option value="0 */12 * * *">${t('cron.schedulePresets.every12Hours')}</option>
                    <option value="0 0 * * *">${t('cron.schedulePresets.everyDayMidnight')}</option>
                    <option value="0 9 * * *">${t('cron.schedulePresets.everyDay9AM')}</option>
                    <option value="0 21 * * *">${t('cron.schedulePresets.everyDay9PM')}</option>
                  </select>
                </div>
                <p class="form-field__hint">
                  ${t('cron.scheduleHintPreset')}
                </p>
              </div>
              <div class="form-field">
                <label class="form-field__label">${t('cron.mode')}</label>
                <select
                  class="form-field__select"
                  .value=${this._formSessionTarget ?? 'main'}
                  @change=${(e: Event) => this._formSessionTarget = (e.target as HTMLSelectElement).value as 'main' | 'isolated'}
                >
                  <option value="main">${t('cron.modeDirectOption') || 'Direct (send message directly)'}</option>
                  <option value="isolated">${t('cron.modeAgentOption') || 'AI Agent (process with AI then send)'}</option>
                </select>
                <p class="form-field__hint">
                  ${this._formSessionTarget === 'main' 
                    ? t('cron.modeDirect')
                    : t('cron.modeAgent')}
                </p>
              </div>
              ${this._formSessionTarget === 'isolated' ? html`
                <div class="form-field">
                  <model-selector
                    .value=${this._formModel}
                    .filter=${'configured'}
                    .token=${this.config?.token}
                    .label=${t('cron.model')}
                    @change=${(e: CustomEvent<ModelSelectEvent>) => this._formModel = e.detail.modelId}
                  ></model-selector>
                </div>
              ` : nothing}
              <div class="form-field">
                <label class="form-field__label">${t('cron.channel')}</label>
                <select
                  class="form-field__select"
                  .value=${this._formChannel ?? 'telegram'}
                  @change=${(e: Event) => {
                    this._formChannel = (e.target as HTMLSelectElement).value;
                    // Reload chat IDs for selected channel
                    this._loadSessionChatIds();
                    // Clear chat ID when channel changes
                    this._formChatId = '';
                  }}
                >
                  ${this._channels.map(ch => html`
                    <option value=${ch.name} ?disabled=${!ch.enabled}>
                      ${ch.name} ${!ch.enabled ? '(disabled)' : ''}
                    </option>
                  `)}
                </select>
              </div>
              <div class="form-field">
                <div class="cron-form__label-row">
                  <label class="form-field__label cron-form__label-inline">${t('cron.recipient')}</label>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm cron-form__mini"
                    @click=${() => this._loadSessionChatIds()}
                    title=${t('cron.refreshRecipientHint')}
                  >
                    ${getIcon('refreshCw')}
                    ${t('cron.refreshList')}
                  </button>
                </div>
                <div class="cron-form__inline">
                  <input
                    type="text"
                    class="form-field__input cron-form__input-grow"
                    .value=${this._formChatId ?? ''}
                    @input=${(e: Event) => this._formChatId = (e.target as HTMLInputElement).value}
                    placeholder=${t('cron.recipientPlaceholder')}
                  />
                  <select
                    class="form-field__select cron-form__select-shrink"
                    .value=${this._formChatId ?? ''}
                    @change=${(e: Event) => {
                      const value = (e.target as HTMLSelectElement).value;
                      if (value) {
                        this._formChatId = value;
                      }
                    }}
                  >
                    <option value="">${t('cron.selectRecipient')}</option>
                    ${this._sessionChatIds.length > 0 ? this._sessionChatIds.map(item => html`
                      <option value=${item.chatId}>
                        ${this._formatRecipientOptionLabel(item)}
                      </option>
                    `) : html`
                      <option value="" disabled>${t('cron.noRecentChatsOption')}</option>
                    `}
                  </select>
                </div>
                <p class="form-field__hint">
                  ${this._sessionChatIds.length > 0 
                    ? t('cron.enterManuallyOrSelect')
                    : t('cron.noRecentChats')}
                </p>
              </div>
              <div class="form-field">
                <label class="form-field__label">${t('cron.message')}</label>
                <textarea 
                  class="form-field__textarea"
                  .value=${this._formMessage ?? ''}
                  @input=${(e: Event) => this._formMessage = (e.target as HTMLTextAreaElement).value}
                  placeholder="${t('cron.messagePlaceholder') ?? 'What should the assistant do?'}"
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
                ${this._formSubmitting ? t('common.loading') : (this._formMode === 'edit' ? t('cron.save') : t('cron.create'))}
              </button>
            </div>
          </div>
        </div>
      ` : nothing}

      ${this._detailOpen
        ? html`
            <div class="drawer-overlay" @click=${this._closeDetail}></div>
            <aside class="drawer drawer--right cron-detail-drawer">
              <div class="drawer-header">
                <div class="drawer-header__info">
                  <h2 class="drawer-header__title">${this._detailJob?.name || this._detailJob?.id}</h2>
                </div>
                <button type="button" class="btn-icon" @click=${this._closeDetail} aria-label=${t('settings.close')}>
                  ${getIcon('x')}
                </button>
              </div>
              <div class="drawer-content ${this._detailLoading ? 'drawer-content--loading' : ''}">
                ${this._detailLoading
                  ? html`<div class="cron-spinner" aria-hidden="true"></div>`
                  : html`
                      <div class="cron-detail-fields">
                        <div class="cron-detail-fields__row">
                          <span class="cron-detail-fields__k">${t('cron.scheduleLabel')}</span>
                          <code class="cron-detail-fields__code">${this._detailJob?.schedule}</code>
                        </div>
                        <div class="cron-detail-fields__row">
                          <span class="cron-detail-fields__k">${t('cron.messageLabel')}</span>
                          <span class="cron-detail-fields__v">${this._detailJob ? cronJobBodyText(this._detailJob) : ''}</span>
                        </div>
                        <div class="cron-detail-fields__row">
                          <span class="cron-detail-fields__k">${t('cron.mode')}</span>
                          <span class="cron-detail-fields__v"
                            >${this._detailJob?.sessionTarget === 'isolated'
                              ? t('cron.modeAgentOption')
                              : t('cron.modeDirectOption')}</span
                          >
                        </div>
                        ${this._detailJob?.delivery?.to
                          ? html`
                              <div class="cron-detail-fields__row">
                                <span class="cron-detail-fields__k">${t('cron.deliveryTarget')}</span>
                                <span class="cron-detail-fields__v">
                                  <code>${this._detailJob.delivery?.channel ?? ''}</code> →
                                  ${this._formatDeliveryToSummary(this._detailJob)}
                                </span>
                              </div>
                            `
                          : nothing}
                        <div class="cron-detail-fields__row">
                          <span class="cron-detail-fields__k">${t('cron.status')}</span>
                          <span class="cron-detail-fields__v">${this._detailJob?.enabled ? t('cron.enabled') : t('cron.disabled')}</span>
                        </div>
                        <div class="cron-detail-fields__row">
                          <span class="cron-detail-fields__k">${t('cron.nextRun')}</span>
                          <span class="cron-detail-fields__v">${this._detailJob?.next_run ? this._formatNextRun(this._detailJob.next_run) : '—'}</span>
                        </div>
                      </div>
                      <div class="cron-detail-history">
                        <h3 class="cron-detail-history__title">${t('cron.detailRunHistory')}</h3>
                        ${this._detailHistory.length === 0
                          ? html`<p class="cron-run-log__empty">${t('cron.noRunsYet')}</p>`
                          : html`
                              <div class="cron-run-log__table-wrap">
                                <table class="data-table cron-run-log__table cron-run-log__table--drawer">
                                  <thead>
                                    <tr>
                                      <th>${t('cron.colStarted')}</th>
                                      <th>${t('cron.status')}</th>
                                      <th>${t('cron.colDuration')}</th>
                                      <th>${t('cron.colDetail')}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    ${this._detailHistory.map((row) => html`
                                      <tr>
                                        <td><time datetime=${row.startedAt}>${this._formatTime(row.startedAt)}</time></td>
                                        <td>
                                          <span class="cron-run-log__pill cron-run-log__pill--${row.status}"
                                            >${this._execStatusLabel(row.status)}</span
                                          >
                                        </td>
                                        <td>${this._formatDuration(row.duration)}</td>
                                        <td class="cron-run-log__detail" title=${row.summary || row.error || ''}>
                                          ${this._truncate(row.summary || row.error, 120)}
                                        </td>
                                      </tr>
                                    `)}
                                  </tbody>
                                </table>
                              </div>
                            `}
                      </div>
                    `}
              </div>
            </aside>
          `
        : nothing}

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

  private _execStatusLabel(status: CronJobExecution['status']): string {
    switch (status) {
      case 'running':
        return t('cron.execStatusRunning');
      case 'success':
        return t('cron.execStatusSuccess');
      case 'failed':
        return t('cron.execStatusFailed');
      case 'cancelled':
        return t('cron.execStatusCancelled');
      default:
        return status;
    }
  }

  private _formatDuration(ms?: number): string {
    if (ms == null || !Number.isFinite(ms)) {
      return '—';
    }
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }
    if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return `${m}m ${s}s`;
  }

  private _truncate(text: string | undefined, max: number): string {
    const s = text?.trim() || '';
    if (!s) {
      return '—';
    }
    return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
  }

  private _formatNextRun(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    
    if (diff < 0) return t('cron.timeLabels.overdue');
    if (diff < 60000) return t('cron.timeLabels.lessThanMinute');
    if (diff < 3600000) {
      const mins = Math.floor(diff / 60000);
      return t('cron.timeLabels.minutes', { count: mins });
    }
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return t('cron.timeLabels.hours', { count: hours });
    }
    return d.toLocaleString();
  }

  private _formatRecipientOptionLabel(item: SessionChatId): string {
    const when = this._formatLastActive(item.lastActive);
    if (item.channel === 'telegram' && item.peerId) {
      const acc = item.accountId ?? 'default';
      const kind = item.peerKind ?? '';
      return `${acc} · ${kind} · ${item.peerId} · ${when}`;
    }
    return `${item.channel}: ${item.chatId} · ${when}`;
  }

  private _formatDeliveryToSummary(job: CronJob): string {
    const to = job.delivery?.to ?? '';
    const parts = to.split(':');
    if (parts.length === 3 && (parts[1] === 'dm' || parts[1] === 'group')) {
      return `${parts[0]} · ${parts[1]} · ${parts[2]}`;
    }
    return to;
  }

  private _formatLastActive(date: string): string {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    
    if (diff < 0) return t('cron.lastActiveLabels.justNow');
    if (diff < 60000) return t('cron.lastActiveLabels.justNow');
    if (diff < 3600000) {
      const mins = Math.floor(diff / 60000);
      return t('cron.lastActiveLabels.minutesAgo', { count: mins });
    }
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return t('cron.lastActiveLabels.hoursAgo', { count: hours });
    }
    if (diff < 604800000) {
      const days = Math.floor(diff / 86400000);
      return t('cron.lastActiveLabels.daysAgo', { count: days });
    }
    return d.toLocaleDateString();
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
