/**
 * Model selector component - loads models dynamically from backend API.
 */

import { html, LitElement, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

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

  static styles = css`
    :host { display: block; }

    .model-selector {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .label {
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--text-primary, #1c1917);
    }

    .required { color: var(--accent-error, #dc2626); }

    .select-wrapper { position: relative; }

    .model-select {
      width: 100%;
      padding: 0.5rem 0.75rem;
      padding-right: 2rem;
      border: 1px solid var(--border-color, #e7e5e4);
      border-radius: var(--radius-md, 0.5rem);
      font-size: 0.8125rem;
      background: var(--bg-primary, #fafaf9);
      color: var(--text-primary, #1c1917);
      cursor: pointer;
      appearance: none;
      transition: all var(--transition-fast, 150ms);
    }

    .model-select:focus {
      outline: none;
      border-color: var(--accent-primary, #4f46e5);
      box-shadow: 0 0 0 2px var(--accent-primary-light, #e0e7ff);
    }

    .model-select:disabled {
      background: var(--bg-secondary, #f5f5f4);
      cursor: not-allowed;
      opacity: 0.6;
    }

    :host([compact]) .model-select {
      padding: 0.35rem 1.75rem 0.35rem 0.65rem;
      min-height: 2rem;
      font-size: 0.8125rem;
      font-weight: 500;
      border-radius: var(--radius-lg, 0.5rem);
      background: var(--hover-bg, #f5f5f4);
    }

    :host([compact]) .select-arrow {
      right: 0.45rem;
      font-size: 0.5rem;
      opacity: 0.7;
    }

    .select-arrow {
      position: absolute;
      right: 0.625rem;
      top: 50%;
      transform: translateY(-50%);
      pointer-events: none;
      color: var(--text-muted, #a8a29e);
      font-size: 0.625rem;
    }

    .loading-state {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      color: var(--text-secondary, #57534e);
      font-size: 0.8125rem;
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid var(--border-color, #e7e5e4);
      border-top-color: var(--accent-primary, #4f46e5);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .error-state {
      padding: 0.5rem 0.75rem;
      color: var(--accent-error, #dc2626);
      font-size: 0.8125rem;
      background: var(--accent-error-light, #fee2e2);
      border-radius: var(--radius-md, 0.5rem);
    }

    .empty-state {
      padding: 0.5rem 0.75rem;
      color: var(--text-secondary, #57534e);
      font-size: 0.8125rem;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._loadModels();
  }

  protected willUpdate(): void {
    // After models are loaded, ensure the select value is properly set
    // This handles the case where value is set before models are loaded
    if (this.value && this._models.length > 0) {
      const hasMatchingModel = this._models.some(m => m.id === this.value);
      if (!hasMatchingModel) {
        console.warn('[ModelSelector] Current value not found in models:', {
          value: this.value,
          availableModels: this._models.map(m => m.id),
        });
      }
    }
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
        models = models.filter(m => m.vision);
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

      // Debug logging for model selection
      console.log('[ModelSelector] Models loaded:', {
        count: models.length,
        currentValue: this.value,
        hasMatchingModel: models.some(m => m.id === this.value),
        matchingModel: models.find(m => m.id === this.value),
      });
    } catch (err) {
      console.error('[ModelSelector] Failed to load models:', err);
      this._error = err instanceof Error ? err.message : 'Failed to load models';
    } finally {
      this._loading = false;
    }
  }

  private _onChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    const modelId = target.value;
    const model = this._models.find(m => m.id === modelId) || null;

    this.dispatchEvent(new CustomEvent<ModelSelectEvent>('change', {
      detail: { modelId, model },
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    return html`
      <div class="model-selector">
        ${this.label ? html`
          <label class="label">
            ${this.label}
            ${this.required ? html`<span class="required">*</span>` : ''}
          </label>
        ` : ''}

        ${this._loading ? html`
          <div class="loading-state">
            <span class="spinner"></span>
            <span>Loading models...</span>
          </div>
        ` : this._error ? html`
          <div class="error-state">
            ${this._error}
          </div>
        ` : this._models.length === 0 ? html`
          <div class="empty-state">
            No models available. Please configure a provider first.
          </div>
        ` : html`
          <div class="select-wrapper">
            <select
              class="model-select"
              .value=${this.value || ''}
              @change=${this._onChange}
              ?disabled=${this.disabled}
            >
              <option value="" disabled ?selected=${!this.value}>
                ${this.placeholder}
              </option>
              ${this._models.map(model => html`
                <option 
                  value="${model.id}"
                  ?selected=${model.id === this.value}
                >
                  ${model.provider}/${model.name}
                </option>
              `)}
            </select>
            <span class="select-arrow">▼</span>
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
