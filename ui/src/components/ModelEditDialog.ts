/**
 * ModelEditDialog Component
 * 
 * A modal dialog for adding/editing custom models with full configuration options
 */

import { html, LitElement, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';
import type { CustomModel } from '../config/models-json-client.js';
import { createCustomModel } from '../config/models-json-client.js';

// API types for dropdown
const API_TYPES = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI' },
  { value: 'bedrock-converse-stream', label: 'AWS Bedrock' },
];

const INPUT_TYPES = [
  { value: 'text', label: 'Text Only' },
  { value: 'text,image', label: 'Text + Vision' },
];

export interface ModelEditDialogResult {
  confirmed: boolean;
  model?: CustomModel;
}

@customElement('model-edit-dialog')
export class ModelEditDialog extends LitElement {
  @property({ type: Object }) model?: CustomModel;
  @property({ type: String }) providerId?: string;
  @property({ type: Boolean }) isOpen = false;
  @property({ type: Boolean }) isNew = false;

  @state() private _formData: Partial<CustomModel> = {};
  @state() private _errors: Map<string, string> = new Map();
  @state() private _activeTab: 'basic' | 'advanced' | 'compat' = 'basic';

  static styles = css`
    :host { display: block; }
    
    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 1rem;
    }
    
    .dialog {
      background: var(--bg-primary, white);
      border-radius: var(--radius-lg, 0.75rem);
      width: 100%;
      max-width: 600px;
      max-height: 85vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    }
    
    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--border-color, #e2e8f0);
    }
    
    .dialog-title {
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--text-primary, #0f172a);
    }
    
    .dialog-subtitle {
      font-size: 0.875rem;
      color: var(--text-muted, #64748b);
      margin-top: 0.25rem;
    }
    
    .close-btn {
      padding: 0.5rem;
      background: transparent;
      border: none;
      cursor: pointer;
      border-radius: var(--radius-md, 0.375rem);
      color: var(--text-muted, #64748b);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .close-btn:hover {
      background: var(--bg-secondary, #f1f5f9);
      color: var(--text-primary, #0f172a);
    }
    
    .dialog-tabs {
      display: flex;
      gap: 0;
      padding: 0 1.5rem;
      border-bottom: 1px solid var(--border-color, #e2e8f0);
      background: var(--bg-secondary, #f8fafc);
    }
    
    .tab-btn {
      padding: 0.75rem 1rem;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-muted, #64748b);
      transition: all 0.15s;
    }
    
    .tab-btn:hover {
      color: var(--text-primary, #0f172a);
    }
    
    .tab-btn.active {
      color: var(--accent-primary, #3b82f6);
      border-bottom-color: var(--accent-primary, #3b82f6);
    }
    
    .dialog-body {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem;
    }
    
    .form-grid {
      display: grid;
      gap: 1.25rem;
    }
    
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }
    
    .field-group {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }
    
    .field-label {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-primary, #0f172a);
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    
    .field-label .required {
      color: #dc2626;
    }
    
    .field-hint {
      font-size: 0.75rem;
      color: var(--text-muted, #64748b);
    }
    
    .text-input, .select-input, .textarea-input {
      padding: 0.625rem 0.875rem;
      border: 1px solid var(--border-color, #e2e8f0);
      border-radius: var(--radius-md, 0.375rem);
      background: var(--bg-primary, white);
      color: var(--text-primary, #0f172a);
      font-size: 0.875rem;
      transition: all 0.15s;
    }
    
    .text-input:focus, .select-input:focus, .textarea-input:focus {
      outline: none;
      border-color: var(--accent-primary, #3b82f6);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    
    .text-input.error, .select-input.error {
      border-color: #dc2626;
    }
    
    .text-input::placeholder {
      color: var(--text-muted, #94a3b8);
    }
    
    .textarea-input {
      resize: vertical;
      min-height: 80px;
    }
    
    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      font-size: 0.875rem;
      color: var(--text-primary, #0f172a);
    }
    
    .checkbox-input {
      width: 1rem;
      height: 1rem;
      cursor: pointer;
    }
    
    .error-message {
      font-size: 0.75rem;
      color: #dc2626;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    
    .section-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-primary, #0f172a);
      margin-bottom: 0.75rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border-color, #e2e8f0);
    }
    
    .cost-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
    }
    
    .cost-input-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .cost-input-group .text-input {
      flex: 1;
    }
    
    .cost-unit {
      font-size: 0.75rem;
      color: var(--text-muted, #64748b);
      white-space: nowrap;
    }
    
    .compat-section {
      background: var(--bg-secondary, #f8fafc);
      padding: 1rem;
      border-radius: var(--radius-md, 0.375rem);
      margin-bottom: 1rem;
    }
    
    .compat-title {
      font-size: 0.875rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
      color: var(--text-primary, #0f172a);
    }
    
    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--border-color, #e2e8f0);
      background: var(--bg-secondary, #f8fafc);
    }
    
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.625rem 1rem;
      border-radius: var(--radius-md, 0.375rem);
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.15s;
    }
    
    .btn-primary {
      background: var(--accent-primary, #3b82f6);
      color: white;
    }
    
    .btn-primary:hover {
      background: var(--accent-primary-hover, #2563eb);
    }
    
    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .btn-secondary {
      background: white;
      color: var(--text-primary, #0f172a);
      border: 1px solid var(--border-color, #e2e8f0);
    }
    
    .btn-secondary:hover {
      background: var(--bg-secondary, #f1f5f9);
    }
    
    .hidden {
      display: none !important;
    }
    
    @media (max-width: 640px) {
      .form-row {
        grid-template-columns: 1fr;
      }
      
      .cost-grid {
        grid-template-columns: 1fr;
      }
    }
  `;

  open(model?: CustomModel, isNew = false) {
    this.isNew = isNew;
    this.model = model;
    this._formData = model ? { ...model } : createCustomModel('');
    this._errors.clear();
    this._activeTab = 'basic';
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
    this.dispatchEvent(new CustomEvent<ModelEditDialogResult>('close', {
      detail: { confirmed: false },
      bubbles: true,
      composed: true,
    }));
  }

  private _validate(): boolean {
    this._errors.clear();
    
    if (!this._formData.id || this._formData.id.trim() === '') {
      this._errors.set('id', 'Model ID is required');
    }
    
    if (this._formData.contextWindow !== undefined && this._formData.contextWindow <= 0) {
      this._errors.set('contextWindow', 'Must be greater than 0');
    }
    
    if (this._formData.maxTokens !== undefined && this._formData.maxTokens <= 0) {
      this._errors.set('maxTokens', 'Must be greater than 0');
    }
    
    this.requestUpdate();
    return this._errors.size === 0;
  }

  private _handleSave() {
    if (!this._validate()) return;
    
    const result: CustomModel = {
      id: this._formData.id || '',
      name: this._formData.name || this._formData.id || '',
      reasoning: this._formData.reasoning || false,
      input: this._formData.input || ['text'],
      contextWindow: this._formData.contextWindow || 128000,
      maxTokens: this._formData.maxTokens || 16384,
      cost: this._formData.cost || {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      ...this._formData,
    };
    
    this.dispatchEvent(new CustomEvent<ModelEditDialogResult>('close', {
      detail: { confirmed: true, model: result },
      bubbles: true,
      composed: true,
    }));
    this.isOpen = false;
  }

  private _updateField<K extends keyof CustomModel>(field: K, value: CustomModel[K]) {
    this._formData = { ...this._formData, [field]: value };
    if (this._errors.has(field)) {
      this._errors.delete(field);
      this.requestUpdate();
    }
  }

  render() {
    if (!this.isOpen) return '';
    
    const title = this.isNew ? 'Add New Model' : 'Edit Model';
    const subtitle = this.providerId ? `Provider: ${this.providerId}` : '';
    
    return html`
      <div class="dialog-overlay" @click=${(e: Event) => {
        if (e.target === e.currentTarget) this.close();
      }}>
        <div class="dialog">
          <div class="dialog-header">
            <div>
              <div class="dialog-title">${title}</div>
              ${subtitle ? html`<div class="dialog-subtitle">${subtitle}</div>` : ''}
            </div>
            <button class="close-btn" @click=${this.close}>
              ${getIcon('x')}
            </button>
          </div>
          
          <div class="dialog-tabs">
            <button 
              class="tab-btn ${this._activeTab === 'basic' ? 'active' : ''}"
              @click=${() => this._activeTab = 'basic'}
            >
              Basic
            </button>
            <button 
              class="tab-btn ${this._activeTab === 'advanced' ? 'active' : ''}"
              @click=${() => this._activeTab = 'advanced'}
            >
              Advanced
            </button>
            <button 
              class="tab-btn ${this._activeTab === 'compat' ? 'active' : ''}"
              @click=${() => this._activeTab = 'compat'}
            >
              Compatibility
            </button>
          </div>
          
          <div class="dialog-body">
            ${this._activeTab === 'basic' ? this._renderBasicTab() : ''}
            ${this._activeTab === 'advanced' ? this._renderAdvancedTab() : ''}
            ${this._activeTab === 'compat' ? this._renderCompatTab() : ''}
          </div>
          
          <div class="dialog-footer">
            <button class="btn btn-secondary" @click=${this.close}>
              Cancel
            </button>
            <button class="btn btn-primary" @click=${this._handleSave}>
              ${this.isNew ? 'Add Model' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderBasicTab() {
    return html`
      <div class="form-grid">
        <div class="field-group">
          <label class="field-label">
            Model ID <span class="required">*</span>
          </label>
          <input
            class="text-input ${this._errors.has('id') ? 'error' : ''}"
            type="text"
            .value=${this._formData.id || ''}
            placeholder="e.g., llama3.1:8b, gpt-4o"
            @input=${(e: Event) => this._updateField('id', (e.target as HTMLInputElement).value)}
          />
          <span class="field-hint">Unique identifier used in API calls</span>
          ${this._errors.has('id') ? html`
            <span class="error-message">${getIcon('alertCircle')} ${this._errors.get('id')}</span>
          ` : ''}
        </div>
        
        <div class="field-group">
          <label class="field-label">Display Name</label>
          <input
            class="text-input"
            type="text"
            .value=${this._formData.name || ''}
            placeholder="e.g., Llama 3.1 8B"
            @input=${(e: Event) => this._updateField('name', (e.target as HTMLInputElement).value)}
          />
          <span class="field-hint">Human-readable name (defaults to ID)</span>
        </div>
        
        <div class="form-row">
          <div class="field-group">
            <label class="field-label">Input Types</label>
            <select
              class="select-input"
              .value=${(this._formData.input || ['text']).join(',')}
              @change=${(e: Event) => {
                const value = (e.target as HTMLSelectElement).value;
                this._updateField('input', value.split(',') as ('text' | 'image')[]);
              }}
            >
              ${INPUT_TYPES.map(type => html`
                <option value=${type.value}>${type.label}</option>
              `)}
            </select>
          </div>
          
          <div class="field-group">
            <label class="checkbox-label" style="margin-top: 1.5rem;">
              <input
                class="checkbox-input"
                type="checkbox"
                .checked=${this._formData.reasoning || false}
                @change=${(e: Event) => this._updateField('reasoning', (e.target as HTMLInputElement).checked)}
              />
              Supports Reasoning
            </label>
          </div>
        </div>
        
        <div class="section-title">Context & Tokens</div>
        
        <div class="form-row">
          <div class="field-group">
            <label class="field-label">Context Window</label>
            <input
              class="text-input ${this._errors.has('contextWindow') ? 'error' : ''}"
              type="number"
              .value=${this._formData.contextWindow || 128000}
              min="1"
              @input=${(e: Event) => this._updateField('contextWindow', parseInt((e.target as HTMLInputElement).value))}
            />
            <span class="field-hint">Maximum context size in tokens</span>
            ${this._errors.has('contextWindow') ? html`
              <span class="error-message">${this._errors.get('contextWindow')}</span>
            ` : ''}
          </div>
          
          <div class="field-group">
            <label class="field-label">Max Output Tokens</label>
            <input
              class="text-input ${this._errors.has('maxTokens') ? 'error' : ''}"
              type="number"
              .value=${this._formData.maxTokens || 16384}
              min="1"
              @input=${(e: Event) => this._updateField('maxTokens', parseInt((e.target as HTMLInputElement).value))}
            />
            <span class="field-hint">Maximum tokens in response</span>
            ${this._errors.has('maxTokens') ? html`
              <span class="error-message">${this._errors.get('maxTokens')}</span>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  private _renderAdvancedTab() {
    const cost = this._formData.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    
    return html`
      <div class="form-grid">
        <div class="section-title">Cost per Million Tokens (USD)</div>
        
        <div class="cost-grid">
          <div class="field-group">
            <label class="field-label">Input</label>
            <div class="cost-input-group">
              <input
                class="text-input"
                type="number"
                step="0.01"
                min="0"
                .value=${cost.input}
                @input=${(e: Event) => {
                  const value = parseFloat((e.target as HTMLInputElement).value) || 0;
                  this._updateField('cost', { ...cost, input: value });
                }}
              />
              <span class="cost-unit">$/M tokens</span>
            </div>
          </div>
          
          <div class="field-group">
            <label class="field-label">Output</label>
            <div class="cost-input-group">
              <input
                class="text-input"
                type="number"
                step="0.01"
                min="0"
                .value=${cost.output}
                @input=${(e: Event) => {
                  const value = parseFloat((e.target as HTMLInputElement).value) || 0;
                  this._updateField('cost', { ...cost, output: value });
                }}
              />
              <span class="cost-unit">$/M tokens</span>
            </div>
          </div>
          
          <div class="field-group">
            <label class="field-label">Cache Read</label>
            <div class="cost-input-group">
              <input
                class="text-input"
                type="number"
                step="0.01"
                min="0"
                .value=${cost.cacheRead}
                @input=${(e: Event) => {
                  const value = parseFloat((e.target as HTMLInputElement).value) || 0;
                  this._updateField('cost', { ...cost, cacheRead: value });
                }}
              />
              <span class="cost-unit">$/M tokens</span>
            </div>
          </div>
          
          <div class="field-group">
            <label class="field-label">Cache Write</label>
            <div class="cost-input-group">
              <input
                class="text-input"
                type="number"
                step="0.01"
                min="0"
                .value=${cost.cacheWrite}
                @input=${(e: Event) => {
                  const value = parseFloat((e.target as HTMLInputElement).value) || 0;
                  this._updateField('cost', { ...cost, cacheWrite: value });
                }}
              />
              <span class="cost-unit">$/M tokens</span>
            </div>
          </div>
        </div>
        
        <div class="section-title">Custom Headers</div>
        
        <div class="field-group">
          <label class="field-label">Headers (JSON)</label>
          <textarea
            class="textarea-input"
            .value=${this._formData.headers ? JSON.stringify(this._formData.headers, null, 2) : ''}
            placeholder='{"X-Custom-Header": "value"}'
            @change=${(e: Event) => {
              try {
                const value = (e.target as HTMLTextAreaElement).value;
                this._updateField('headers', value ? JSON.parse(value) : undefined);
              } catch {
                // Invalid JSON, ignore
              }
            }}
          ></textarea>
          <span class="field-hint">Optional custom headers for this model (JSON format)</span>
        </div>
      </div>
    `;
  }

  private _renderCompatTab() {
    const compat = (this._formData.compat || {}) as Record<string, unknown>;
    
    return html`
      <div class="form-grid">
        <div class="compat-section">
          <div class="compat-title">OpenAI Completions Compatibility</div>
          
          <div class="field-group" style="margin-bottom: 0.75rem;">
            <label class="checkbox-label">
              <input
                class="checkbox-input"
                type="checkbox"
                .checked=${compat.supportsStore || false}
                @change=${(e: Event) => this._updateCompat('supportsStore', (e.target as HTMLInputElement).checked)}
              />
              Supports Store
            </label>
          </div>
          
          <div class="field-group" style="margin-bottom: 0.75rem;">
            <label class="checkbox-label">
              <input
                class="checkbox-input"
                type="checkbox"
                .checked=${compat.supportsDeveloperRole || false}
                @change=${(e: Event) => this._updateCompat('supportsDeveloperRole', (e.target as HTMLInputElement).checked)}
              />
              Supports Developer Role
            </label>
          </div>
          
          <div class="field-group" style="margin-bottom: 0.75rem;">
            <label class="checkbox-label">
              <input
                class="checkbox-input"
                type="checkbox"
                .checked=${compat.supportsUsageInStreaming !== false}
                @change=${(e: Event) => this._updateCompat('supportsUsageInStreaming', (e.target as HTMLInputElement).checked)}
              />
              Supports Usage in Streaming
            </label>
          </div>
          
          <div class="field-group">
            <label class="field-label">Max Tokens Field</label>
            <select
              class="select-input"
              .value=${compat.maxTokensField || ''}
              @change=${(e: Event) => this._updateCompat('maxTokensField', (e.target as HTMLSelectElement).value || undefined)}
            >
              <option value="">Auto-detect</option>
              <option value="max_completion_tokens">max_completion_tokens</option>
              <option value="max_tokens">max_tokens</option>
            </select>
          </div>
        </div>
        
        <div class="compat-section">
          <div class="compat-title">Routing (OpenRouter / Vercel Gateway)</div>
          
          <div class="field-group">
            <label class="field-label">Provider Order (comma-separated)</label>
            <input
              class="text-input"
              type="text"
              .value=${(compat.openRouterRouting as { order?: string[] })?.order?.join(', ') || ''}
              placeholder="anthropic, openai, ..."
              @change=${(e: Event) => {
                const value = (e.target as HTMLInputElement).value;
                const order = value ? value.split(',').map(s => s.trim()).filter(Boolean) : undefined;
                this._updateCompat('openRouterRouting', order ? { order } : undefined);
              }}
            />
          </div>
          
          <div class="field-group">
            <label class="field-label">Allowed Providers Only (comma-separated)</label>
            <input
              class="text-input"
              type="text"
              .value=${(compat.openRouterRouting as { only?: string[] })?.only?.join(', ') || ''}
              placeholder="amazon-bedrock, ..."
              @change=${(e: Event) => {
                const value = (e.target as HTMLInputElement).value;
                const only = value ? value.split(',').map(s => s.trim()).filter(Boolean) : undefined;
                this._updateCompat('openRouterRouting', only ? { only } : undefined);
              }}
            />
          </div>
        </div>
      </div>
    `;
  }

  private _updateCompat(key: string, value: unknown) {
    const compat = { ...(this._formData.compat || {}) };
    if (value === undefined) {
      delete compat[key];
    } else {
      compat[key] = value;
    }
    this._updateField('compat', Object.keys(compat).length > 0 ? compat : undefined);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'model-edit-dialog': ModelEditDialog;
  }
}
