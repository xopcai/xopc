// Skills management — view catalog, upload zip, delete managed skills

import { html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons';
import { t } from '../utils/i18n';
import { SkillAPIClient, type SkillCatalogEntry } from '../utils/skill-api';
import '../components/ConfirmDialog';

export interface SkillManagerConfig {
  token?: string;
}

@customElement('skill-manager')
export class SkillManager extends LitElement {
  @property({ attribute: false }) config?: SkillManagerConfig;

  @state() private _catalog: SkillCatalogEntry[] = [];
  @state() private _loading = false;
  @state() private _error: string | null = null;
  @state() private _uploading = false;
  @state() private _confirmOpen = false;
  @state() private _confirmId: string | null = null;
  @state() private _searchQuery = '';
  @state() private _dropActive = false;
  /** Transient banner after header actions (refresh / reload). */
  @state() private _actionFeedback: { kind: 'success' | 'error'; message: string } | null = null;

  private _actionFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  private _api!: SkillAPIClient;
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
      this._initialized = false;
      this._tryInitialize();
    }
  }

  private _tryInitialize(): void {
    if (this._initialized) return;
    this._api = new SkillAPIClient(window.location.origin, this.config?.token);
    this._initialized = true;
    void this._load();
  }

  private _clearActionFeedbackTimer(): void {
    if (this._actionFeedbackTimer !== undefined) {
      clearTimeout(this._actionFeedbackTimer);
      this._actionFeedbackTimer = undefined;
    }
  }

  private _showActionFeedback(kind: 'success' | 'error', message: string, durationMs = 5000): void {
    this._clearActionFeedbackTimer();
    this._actionFeedback = { kind, message };
    this._actionFeedbackTimer = setTimeout(() => {
      this._actionFeedback = null;
      this._actionFeedbackTimer = undefined;
    }, durationMs);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._clearActionFeedbackTimer();
  }

  /** @returns whether the catalog was loaded successfully */
  private async _load(): Promise<boolean> {
    this._loading = true;
    this._error = null;
    try {
      const data = await this._api.getSkills();
      this._catalog = data.catalog;
      return true;
    } catch (e) {
      this._error = e instanceof Error ? e.message : t('skills.loadFailed');
      return false;
    } finally {
      this._loading = false;
    }
  }

  private async _onRefreshClick(): Promise<void> {
    this._clearActionFeedbackTimer();
    this._actionFeedback = null;
    const ok = await this._load();
    if (ok) {
      this._showActionFeedback('success', t('skills.refreshSuccess'));
    } else {
      this._showActionFeedback('error', this._error || t('skills.loadFailed'));
    }
  }

  private async _onReloadClick(): Promise<void> {
    this._clearActionFeedbackTimer();
    this._actionFeedback = null;
    this._loading = true;
    this._error = null;
    try {
      await this._api.reloadSkills();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('skills.reloadFailed');
      this._error = msg;
      this._showActionFeedback('error', msg);
      this._loading = false;
      return;
    }
    const ok = await this._load();
    if (ok) {
      this._showActionFeedback('success', t('skills.reloadSuccess'));
    } else {
      this._showActionFeedback('error', this._error || t('skills.loadFailed'));
    }
  }

  private _filteredCatalog(): SkillCatalogEntry[] {
    const q = this._searchQuery.trim().toLowerCase();
    if (!q) return this._catalog;
    return this._catalog.filter((row) => {
      const blob = [
        row.name,
        row.description,
        row.directoryId,
        row.path,
        row.source,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return blob.includes(q);
    });
  }

  private async _uploadZipFile(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      this._error = t('skills.zipOnly');
      return;
    }
    this._clearActionFeedbackTimer();
    this._actionFeedback = null;
    this._uploading = true;
    this._error = null;
    try {
      await this._api.uploadSkillZip(file, { overwrite: true });
      await this._load();
    } catch (err) {
      this._error = err instanceof Error ? err.message : t('skills.uploadFailed');
    } finally {
      this._uploading = false;
    }
  }

  private async _onFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this._uploadZipFile(file);
  }

  private _onDragOver(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.types.includes('Files')) {
      this._dropActive = true;
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  private _onDragLeave(e: DragEvent): void {
    const root = e.currentTarget as HTMLElement;
    const to = e.relatedTarget as Node | null;
    if (to && root.contains(to)) return;
    this._dropActive = false;
  }

  private _onDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this._dropActive = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      void this._uploadZipFile(file);
    }
  }

  private _renderSkillRows(): TemplateResult {
    const rows = this._filteredCatalog();
    if (this._catalog.length === 0) {
      return html`<tr>
        <td colspan="5" class="skill-manager__empty">${t('skills.empty')}</td>
      </tr>`;
    }
    if (rows.length === 0) {
      return html`<tr>
        <td colspan="5" class="skill-manager__empty">${t('skills.noSearchResults')}</td>
      </tr>`;
    }
    return html`${rows.map(
      (row) => html`
        <tr>
          <td><strong>${row.name}</strong></td>
          <td class="skill-manager__desc">${row.description || '—'}</td>
          <td>${this._sourceLabel(row.source)}</td>
          <td>${row.managed ? t('skills.yes') : t('skills.no')}</td>
          <td class="skill-manager__actions-cell">
            ${row.managed
              ? html`<button
                  type="button"
                  class="btn btn-danger"
                  @click=${() => this._askDelete(row.directoryId)}
                >
                  ${t('skills.delete')}
                </button>`
              : html`<span class="text-muted">—</span>`}
          </td>
        </tr>
      `,
    )}`;
  }

  private _askDelete(id: string): void {
    this._confirmId = id;
    this._confirmOpen = true;
  }

  private _onConfirmDelete(e: CustomEvent<{ confirmed: boolean }>): void {
    if (!e.detail.confirmed) {
      this._confirmOpen = false;
      this._confirmId = null;
      return;
    }
    void this._runDelete();
  }

  private async _runDelete(): Promise<void> {
    const id = this._confirmId;
    this._confirmOpen = false;
    this._confirmId = null;
    if (!id) return;
    this._clearActionFeedbackTimer();
    this._actionFeedback = null;
    try {
      await this._api.deleteSkill(id);
      await this._load();
    } catch (e) {
      this._error = e instanceof Error ? e.message : t('skills.deleteFailed');
    }
  }

  private _sourceLabel(source: SkillCatalogEntry['source']): string {
    switch (source) {
      case 'builtin':
        return t('skills.source.builtin');
      case 'workspace':
        return t('skills.source.workspace');
      case 'global':
        return t('skills.source.global');
      default:
        return source;
    }
  }

  override render(): unknown {
    return html`
      <confirm-dialog
        .open=${this._confirmOpen}
        .title=${t('skills.deleteTitle')}
        .message=${this._confirmId ? t('skills.deleteMessage', { id: this._confirmId }) : ''}
        .confirmText=${t('skills.deleteConfirm')}
        .cancelText=${t('common.cancel')}
        .type=${'danger'}
        @confirm=${this._onConfirmDelete}
      ></confirm-dialog>

      <div class="skill-manager">
        <div class="skill-manager__header">
          <h1 class="page-title">
            <span class="page-title__icon">${getIcon('layers')}</span>
            ${t('skills.title')}
          </h1>
          <div class="skill-manager__actions">
            <button
              type="button"
              class="btn btn-secondary"
              ?disabled=${this._loading}
              @click=${() => void this._onRefreshClick()}
            >
              ${getIcon('refresh')}
              ${t('skills.refresh')}
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              ?disabled=${this._loading}
              @click=${() => void this._onReloadClick()}
            >
              ${t('skills.reloadRuntime')}
            </button>
          </div>
        </div>

        <p class="skill-manager__hint">${t('skills.hint')}</p>

        ${this._actionFeedback
          ? html`<div
              class="skill-manager__feedback skill-manager__feedback--${this._actionFeedback.kind}"
              role="status"
              aria-live="polite"
            >
              ${this._actionFeedback.message}
            </div>`
          : this._error
            ? html`<div class="skill-manager__error" role="alert">${this._error}</div>`
            : nothing}

        <section
          class="skill-manager__upload skill-manager__dropzone ${this._dropActive
            ? 'skill-manager__dropzone--active'
            : ''}"
          @dragleave=${this._onDragLeave}
          @dragover=${this._onDragOver}
          @drop=${this._onDrop}
        >
          <label class="skill-manager__drop-label">
            <input
              type="file"
              class="skill-manager__file-input"
              accept=".zip,application/zip"
              ?disabled=${this._uploading}
              aria-label=${t('skills.dropHint')}
              @change=${(e: Event) => this._onFile(e)}
            />
            <div class="skill-manager__drop-content">
              <h2 class="skill-manager__section-title">${t('skills.uploadSection')}</h2>
              <p class="skill-manager__drop-hint">${t('skills.dropHint')}</p>
              ${this._uploading
                ? html`<p class="skill-manager__drop-status">${t('skills.uploading')}</p>`
                : nothing}
            </div>
          </label>
        </section>

        <section class="skill-manager__table-wrap">
          <div class="skill-manager__table-head">
            <h2 class="skill-manager__section-title">${t('skills.tableTitle')}</h2>
            <div class="skill-manager__search">
              <span class="skill-manager__search-icon" aria-hidden="true">${getIcon('search')}</span>
              <input
                type="search"
                class="input skill-manager__search-input"
                placeholder=${t('skills.searchPlaceholder')}
                autocomplete="off"
                .value=${this._searchQuery}
                @input=${(e: Event) => {
                  this._searchQuery = (e.target as HTMLInputElement).value;
                }}
              />
            </div>
          </div>
          ${this._loading
            ? html`<div class="skill-manager__loading">${t('skills.loading')}</div>`
            : html`
                <table class="skill-manager__table">
                  <thead>
                    <tr>
                      <th>${t('skills.col.name')}</th>
                      <th>${t('skills.col.description')}</th>
                      <th>${t('skills.col.source')}</th>
                      <th>${t('skills.col.managed')}</th>
                      <th>${t('skills.col.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this._renderSkillRows()}
                  </tbody>
                </table>
              `}
        </section>
      </div>
    `;
  }
}
