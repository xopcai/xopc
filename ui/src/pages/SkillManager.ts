// Skills management — view catalog, upload zip, delete managed skills

import { html, LitElement, nothing } from 'lit';
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
  @state() private _skillIdInput = '';
  @state() private _overwrite = false;
  @state() private _uploading = false;
  @state() private _confirmOpen = false;
  @state() private _confirmId: string | null = null;

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
    this._load();
  }

  private async _load(): Promise<void> {
    this._loading = true;
    this._error = null;
    try {
      const data = await this._api.getSkills();
      this._catalog = data.catalog;
    } catch (e) {
      this._error = e instanceof Error ? e.message : t('skills.loadFailed');
    } finally {
      this._loading = false;
    }
  }

  private async _reload(): Promise<void> {
    try {
      await this._api.reloadSkills();
      await this._load();
    } catch (e) {
      this._error = e instanceof Error ? e.message : t('skills.reloadFailed');
    }
  }

  private async _onFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !file.name.toLowerCase().endsWith('.zip')) {
      this._error = t('skills.zipOnly');
      return;
    }
    this._uploading = true;
    this._error = null;
    try {
      await this._api.uploadSkillZip(file, {
        skillId: this._skillIdInput.trim() || undefined,
        overwrite: this._overwrite,
      });
      this._skillIdInput = '';
      this._overwrite = false;
      await this._load();
    } catch (err) {
      this._error = err instanceof Error ? err.message : t('skills.uploadFailed');
    } finally {
      this._uploading = false;
    }
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
              @click=${() => this._load()}
            >
              ${getIcon('refresh')}
              ${t('skills.refresh')}
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              ?disabled=${this._loading}
              @click=${() => this._reload()}
            >
              ${t('skills.reloadRuntime')}
            </button>
          </div>
        </div>

        <p class="skill-manager__hint">${t('skills.hint')}</p>

        ${this._error
          ? html`<div class="skill-manager__error" role="alert">${this._error}</div>`
          : nothing}

        <section class="skill-manager__upload">
          <h2 class="skill-manager__section-title">${t('skills.uploadSection')}</h2>
          <div class="skill-manager__upload-row">
            <label class="skill-manager__file btn btn-primary">
              ${this._uploading ? t('skills.uploading') : t('skills.chooseZip')}
              <input
                type="file"
                accept=".zip,application/zip"
                ?disabled=${this._uploading}
                @change=${(e: Event) => this._onFile(e)}
              />
            </label>
            <input
              type="text"
              class="input skill-manager__id-input"
              placeholder=${t('skills.skillIdPlaceholder')}
              .value=${this._skillIdInput}
              @input=${(e: Event) => {
                this._skillIdInput = (e.target as HTMLInputElement).value;
              }}
            />
            <label class="skill-manager__check">
              <input
                type="checkbox"
                .checked=${this._overwrite}
                @change=${(e: Event) => {
                  this._overwrite = (e.target as HTMLInputElement).checked;
                }}
              />
              ${t('skills.overwrite')}
            </label>
          </div>
        </section>

        <section class="skill-manager__table-wrap">
          <h2 class="skill-manager__section-title">${t('skills.tableTitle')}</h2>
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
                    ${this._catalog.length === 0
                      ? html`<tr>
                          <td colspan="5" class="skill-manager__empty">${t('skills.empty')}</td>
                        </tr>`
                      : this._catalog.map(
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
                        )}
                  </tbody>
                </table>
              `}
        </section>
      </div>
    `;
  }
}
