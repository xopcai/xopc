/**
 * Model selector component - loads models dynamically from backend API.
 * Searchable combobox for long model lists.
 */

import { html, LitElement, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { t } from '../utils/i18n.js';

export interface Model {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  cost?: {
    input: number;
    output: number;
  };
}

export interface ModelSelectEvent {
  modelId: string;
  model: Model | null;
}

function modelSearchHaystack(m: Model): string {
  return `${m.id} ${m.name} ${m.provider}`.toLowerCase();
}

function modelsMatchingQuery(models: Model[], query: string): Model[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return models;
  const tokens = raw.split(/\s+/).filter(Boolean);
  return models.filter((m) => {
    const hay = modelSearchHaystack(m);
    return tokens.every((tok) => hay.includes(tok));
  });
}

@customElement('model-selector')
export class ModelSelector extends LitElement {
  @property({ type: String }) value: string = '';
  @property({ type: String }) label: string = 'Model';
  @property({ type: String }) placeholder: string = 'Select a model...';
  @property({ type: Boolean }) required: boolean = false;
  @property({ type: Boolean }) disabled: boolean = false;
  @property({ type: String }) filter: 'all' | 'configured' | 'vision' = 'configured';
  @property({ type: String }) token?: string;
  /** Denser padding for chat toolbar */
  @property({ type: Boolean, reflect: true }) compact = false;

  @state() private _models: Model[] = [];
  @state() private _loading: boolean = false;
  @state() private _error: string | null = null;
  @state() private _open = false;
  @state() private _query = '';

  static styles = css`
    :host {
      --model-selector-max-width: 22rem;

      display: inline-block;
      width: max-content;
      max-width: min(var(--model-selector-max-width), 100%);
      min-width: min(8.75rem, 100%);
      vertical-align: middle;
      box-sizing: border-box;
    }

    :host([compact]) {
      --model-selector-max-width: min(22rem, calc(100vw - 2rem));
    }

    .model-selector {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      width: max-content;
      max-width: min(var(--model-selector-max-width), 100%);
      min-width: 0;
    }

    .label {
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--text-primary);
    }

    .required { color: var(--accent-error); }

    .combobox {
      position: relative;
      width: max-content;
      max-width: 100%;
      min-width: 0;
    }

    /* Aligned with secondary toolbar controls (e.g. chat new-session): card surface, UI type scale, xl radius */
    .model-trigger {
      display: block;
      width: max-content;
      max-width: 100%;
      min-width: 0;
      margin: 0;
      padding: 0.5rem 2rem 0.5rem 0.875rem;
      border: 1px solid var(--border-default);
      border-radius: var(--radius-xl);
      font-family: var(--font-sans);
      font-size: 0.875rem;
      font-weight: 500;
      line-height: 1.5;
      background: var(--card-bg);
      color: var(--text-primary);
      cursor: pointer;
      text-align: left;
      transition:
        background var(--transition-fast),
        border-color var(--transition-fast),
        color var(--transition-fast),
        transform var(--transition-fast);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-sizing: border-box;
    }

    .model-trigger:hover:not(:disabled) {
      background: var(--hover-bg);
      border-color: var(--border-strong);
    }

    .model-trigger:focus {
      outline: none;
    }

    .model-trigger:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--card-bg), 0 0 0 4px var(--primary-base);
    }

    .model-trigger:active:not(:disabled) {
      transform: scale(0.98);
    }

    .model-trigger:disabled {
      background: var(--hover-bg);
      cursor: not-allowed;
      opacity: 0.5;
    }

    :host([compact]) .model-trigger {
      padding: 0.5rem 1.75rem 0.5rem 0.875rem;
    }

    :host([compact]) .select-arrow {
      right: 0.5rem;
      font-size: 0.625rem;
    }

    .select-arrow {
      position: absolute;
      right: 0.625rem;
      top: 50%;
      transform: translateY(-50%);
      pointer-events: none;
      color: var(--text-secondary);
      font-size: 0.625rem;
    }

    .model-panel {
      position: absolute;
      left: 0;
      right: auto;
      top: calc(100% + 4px);
      z-index: 200;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.5rem;
      box-sizing: border-box;
      min-width: 100%;
      width: max(100%, min(22rem, calc(100vw - 2rem)));
      max-width: min(100vw - 2rem, 36rem);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-xl);
      background: var(--card-bg);
      box-shadow: var(--shadow-lg);
    }

    .model-search {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--border-default);
      border-radius: var(--radius-xl);
      font-family: var(--font-sans);
      font-size: 0.875rem;
      line-height: 1.5;
      background: var(--card-bg);
      color: var(--text-primary);
      transition:
        border-color var(--transition-fast),
        box-shadow var(--transition-fast);
    }

    .model-search:hover:not(:disabled) {
      border-color: var(--border-strong);
    }

    .model-search:focus {
      outline: none;
      border-color: var(--primary-base);
      box-shadow: 0 0 0 1px var(--primary-base);
      background: var(--card-bg);
    }

    .model-list {
      margin: 0;
      padding: 0;
      list-style: none;
      max-height: 240px;
      overflow-y: auto;
    }

    .model-option {
      display: block;
      width: 100%;
      margin: 0;
      padding: 0.5rem 0.625rem;
      border: none;
      border-radius: var(--radius-lg);
      font-family: var(--font-sans);
      font-size: 0.875rem;
      line-height: 1.5;
      text-align: left;
      cursor: pointer;
      background: transparent;
      color: var(--text-primary);
      transition: background var(--transition-fast);
    }

    .model-option:hover,
    .model-option:focus-visible {
      outline: none;
      background: var(--hover-bg);
    }

    .model-option[aria-selected="true"] {
      background: var(--primary-soft);
      font-weight: 500;
    }

    .model-option-primary {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .model-option-secondary {
      display: block;
      font-size: 0.75rem;
      line-height: 1.4;
      color: var(--text-secondary);
      margin-top: 0.125rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .model-no-matches {
      padding: 0.5rem;
      font-size: 0.875rem;
      color: var(--text-secondary);
    }

    .loading-state {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.875rem;
      min-width: min(8.75rem, 100%);
      min-height: 2.5rem;
      box-sizing: border-box;
      color: var(--text-secondary);
      font-size: 0.875rem;
      font-weight: 500;
      border: 1px solid var(--border-default);
      border-radius: var(--radius-xl);
      background: var(--card-bg);
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid var(--border-default);
      border-top-color: var(--primary-base);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .error-state {
      padding: 0.5rem 0.75rem;
      color: var(--accent-error);
      font-size: 0.875rem;
      background: var(--accent-error-light);
      border-radius: var(--radius-xl);
      border: 1px solid var(--border-default);
    }

    .empty-state {
      padding: 0.5rem 0.75rem;
      color: var(--text-secondary);
      font-size: 0.875rem;
      border: 1px solid var(--border-default);
      border-radius: var(--radius-xl);
      background: var(--card-bg);
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('pointerdown', this._onDocPointerDown, true);
    this._loadModels();
  }

  disconnectedCallback() {
    document.removeEventListener('pointerdown', this._onDocPointerDown, true);
    super.disconnectedCallback();
  }

  private _onDocPointerDown = (e: PointerEvent) => {
    if (!this._open) return;
    if (e.composedPath().includes(this)) return;
    this._closePanel();
  };

  private _closePanel() {
    this._open = false;
    this._query = '';
  }

  private _toggleOpen() {
    if (this.disabled) return;
    this._open = !this._open;
    if (this._open) {
      this._query = '';
      void this.updateComplete.then(() => {
        const input = this.renderRoot.querySelector<HTMLInputElement>('.model-search');
        input?.focus();
      });
    } else {
      this._query = '';
    }
  }

  private _onSearchInput(e: Event) {
    this._query = (e.target as HTMLInputElement).value;
  }

  private _onPanelKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this._closePanel();
    }
  };

  private _selectModel(modelId: string) {
    const model = this._models.find((m) => m.id === modelId) || null;
    this._closePanel();
    this.dispatchEvent(
      new CustomEvent<ModelSelectEvent>('change', {
        detail: { modelId, model },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _displayLabel(): string {
    if (!this.value) return this.placeholder;
    const m = this._models.find((x) => x.id === this.value);
    if (m) return `${m.provider}/${m.name}`;
    return this.value;
  }

  private async _loadModels() {
    if (this._loading) return;

    this._loading = true;
    this._error = null;

    try {
      const endpoint = this.filter === 'all' ? '/api/providers' : '/api/models';
      const headers: Record<string, string> = {};
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      const response = await fetch(`${window.location.origin}${endpoint}`, { headers });

      if (!response.ok) {
        throw new Error(`Failed to load models: ${response.status}`);
      }

      const data = await response.json();
      let models: Model[] = data.payload.models;

      if (this.filter === 'vision') {
        models = models.filter((m) => m.vision);
      }

      models.sort((a, b) => {
        if (a.reasoning !== b.reasoning) {
          return b.reasoning ? 1 : -1;
        }
        if (a.provider !== b.provider) {
          return a.provider.localeCompare(b.provider);
        }
        return a.name.localeCompare(b.name);
      });

      this._models = models;
    } catch (err) {
      console.error('[ModelSelector] Failed to load models:', err);
      this._error = err instanceof Error ? err.message : 'Failed to load models';
    } finally {
      this._loading = false;
    }
  }

  render() {
    const filtered = modelsMatchingQuery(this._models, this._query);

    return html`
      <div class="model-selector">
        ${this.label
          ? html`
              <label class="label">
                ${this.label}
                ${this.required ? html`<span class="required">*</span>` : ''}
              </label>
            `
          : ''}

        ${this._loading
          ? html`
              <div class="loading-state">
                <span class="spinner"></span>
                <span>Loading models...</span>
              </div>
            `
          : this._error
            ? html`
                <div class="error-state">
                  ${this._error}
                </div>
              `
            : this._models.length === 0
              ? html`
                  <div class="empty-state">
                    No models available. Please configure a provider first.
                  </div>
                `
              : html`
                  <div class="combobox">
                    <button
                      type="button"
                      class="model-trigger"
                      @click=${() => this._toggleOpen()}
                      ?disabled=${this.disabled}
                      aria-haspopup="listbox"
                      aria-expanded=${this._open}
                    >
                      ${this._displayLabel()}
                    </button>
                    <span class="select-arrow" aria-hidden="true">▼</span>
                    ${this._open
                      ? html`
                          <div class="model-panel" @keydown=${this._onPanelKeydown}>
                            <input
                              type="search"
                              class="model-search"
                              .value=${this._query}
                              placeholder=${t('chat.modelSearchPlaceholder')}
                              autocomplete="off"
                              spellcheck="false"
                              @input=${this._onSearchInput}
                              @click=${(e: Event) => e.stopPropagation()}
                            />
                            ${filtered.length === 0
                              ? html`<div class="model-no-matches">${t('chat.modelNoMatches')}</div>`
                              : html`
                                  <ul class="model-list" role="listbox" aria-label=${t('chat.model')}>
                                    ${filtered.map(
                                      (model) => html`
                                        <li role="presentation">
                                          <button
                                            type="button"
                                            class="model-option"
                                            role="option"
                                            aria-selected=${model.id === this.value}
                                            @click=${() => this._selectModel(model.id)}
                                          >
                                            <span class="model-option-primary">${model.provider}/${model.name}</span>
                                            <span class="model-option-secondary">${model.id}</span>
                                          </button>
                                        </li>
                                      `,
                                    )}
                                  </ul>
                                `}
                          </div>
                        `
                      : ''}
                  </div>
                `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'model-selector': ModelSelector;
  }
}
