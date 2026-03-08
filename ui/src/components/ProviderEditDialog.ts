/**
 * ProviderEditDialog Component
 * 
 * A modal dialog for adding/editing custom providers with full configuration options
 */

import { html, LitElement, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';
import type { ProviderConfig } from '../config/models-json-client.js';

// API types for dropdown
const API_TYPES = [
  { value: 'openai-completions', label: 'OpenAI Completions (Most compatible)' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI' },
  { value: 'bedrock-converse-stream', label: 'AWS Bedrock' },
  { value: 'openai-codex-responses', label: 'OpenAI Codex' },
  { value: 'google-gemini-cli', label: 'Google Gemini CLI' },
  { value: 'google-vertex', label: 'Google Vertex AI' },
];

// Preset providers with default configurations
const PROVIDER_PRESETS: Record<string, Partial<ProviderConfig>> = {
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    api: 'openai-completions',
    apiKey: 'ollama',
  },
  lmstudio: {
    baseUrl: 'http://localhost:1234/v1',
    api: 'openai-completions',
    apiKey: 'lmstudio',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
    apiKey: '',
  },
  'vercel-ai-gateway': {
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    api: 'openai-completions',
    apiKey: '',
  },
  vllm: {
    baseUrl: 'http://localhost:8000/v1',
    api: 'openai-completions',
    apiKey: '',
  },
  custom: {
    baseUrl: '',
    api: 'openai-completions',
    apiKey: '',
  },
};

export interface ProviderEditDialogResult {
  confirmed: boolean;
  providerId?: string;
  config?: ProviderConfig;
}

@customElement('provider-edit-dialog')
export class ProviderEditDialog extends LitElement {
  @property({ type: Object }) config?: ProviderConfig;
  @property({ type: String }) providerId?: string;
  @property({ type: Boolean }) isOpen = false;
  @property({ type: Boolean }) isNew = false;

  @state() private _formData: Partial<ProviderConfig> = {};
  @state() private _providerId = '';
  @state() private _errors: Map<string, string> = new Map();
  @state() private _selectedPreset = 'custom';
  @state() private _showAdvanced = false;

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
      animation: fadeIn 0.15s ease;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    
    .dialog {
      background: var(--bg-primary, white);
      border-radius: var(--radius-lg, 0.75rem);
      width: 100%;
      max-width: 560px;
      max-height: 90vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      animation: slideUp 0.2s ease;
    }
    
    @keyframes slideUp {
      from { 
        opacity: 0;
        transform: translateY(20px);
      }
      to { 
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border-color, #e2e8f0);
      background: linear-gradient(to right, var(--bg-primary, white), var(--bg-secondary, #f8fafc));
    }
    
    .dialog-title {
      font-size: 1.25rem;
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
      transition: all 0.15s;
    }
    
    .close-btn:hover {
      background: var(--bg-secondary, #f1f5f9);
      color: var(--text-primary, #0f172a);
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
      gap: 0.5rem;
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
      line-height: 1.4;
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
    
    .text-input:hover, .select-input:hover, .textarea-input:hover {
      border-color: var(--border-hover, #cbd5e1);
    }
    
    .text-input:focus, .select-input:focus, .textarea-input:focus {
      outline: none;
      border-color: var(--accent-primary, #3b82f6);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    
    .text-input.error, .select-input.error {
      border-color: #dc2626;
      background-color: #fef2f2;
    }
    
    .text-input::placeholder {
      color: var(--text-muted, #94a3b8);
    }
    
    .textarea-input {
      resize: vertical;
      min-height: 80px;
      font-family: monospace;
      font-size: 0.8125rem;
    }
    
    .select-input {
      cursor: pointer;
    }
    
    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      font-size: 0.875rem;
      color: var(--text-primary, #0f172a);
      padding: 0.5rem 0;
    }
    
    .checkbox-input {
      width: 1.125rem;
      height: 1.125rem;
      cursor: pointer;
      accent-color: var(--accent-primary, #3b82f6);
    }
    
    .error-message {
      font-size: 0.75rem;
      color: #dc2626;
      display: flex;
      align-items: center;
      gap: 0.25rem;
      animation: shake 0.3s ease;
    }
    
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-4px); }
      75% { transform: translateX(4px); }
    }
    
    .section-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-primary, #0f172a);
      margin: 1.5rem 0 0.75rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border-color, #e2e8f0);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .section-title:first-child {
      margin-top: 0;
    }
    
    .preset-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    
    .preset-btn {
      padding: 0.875rem;
      border: 1px solid var(--border-color, #e2e8f0);
      border-radius: var(--radius-md, 0.375rem);
      background: var(--bg-primary, white);
      cursor: pointer;
      text-align: left;
      transition: all 0.15s;
    }
    
    .preset-btn:hover {
      border-color: var(--accent-primary, #3b82f6);
      background: var(--bg-secondary, #f8fafc);
    }
    
    .preset-btn.active {
      border-color: var(--accent-primary, #3b82f6);
      background: rgba(59, 130, 246, 0.05);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
    }
    
    .preset-name {
      font-weight: 600;
      font-size: 0.875rem;
      color: var(--text-primary, #0f172a);
    }
    
    .preset-desc {
      font-size: 0.75rem;
      color: var(--text-muted, #64748b);
      margin-top: 0.25rem;
    }
    
    .input-with-suffix {
      position: relative;
      display: flex;
      align-items: center;
    }
    
    .input-with-suffix .text-input {
      flex: 1;
      padding-right: 3rem;
    }
    
    .input-suffix {
      position: absolute;
      right: 0.75rem;
      font-size: 0.75rem;
      color: var(--text-muted, #94a3b8);
      pointer-events: none;
    }
    
    .toggle-advanced {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.75rem;
      margin: 1rem 0;
      background: transparent;
      border: 1px dashed var(--border-color, #e2e8f0);
      border-radius: var(--radius-md, 0.375rem);
      color: var(--text-muted, #64748b);
      cursor: pointer;
      font-size: 0.875rem;
      transition: all 0.15s;
    }
    
    .toggle-advanced:hover {
      border-color: var(--accent-primary, #3b82f6);
      color: var(--accent-primary, #3b82f6);
    }
    
    .advanced-section {
      animation: slideDown 0.2s ease;
    }
    
    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
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
      padding: 0.625rem 1.25rem;
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
      
      .preset-grid {
        grid-template-columns: 1fr;
      }
      
      .dialog {
        max-height: 95vh;
      }
    }
    
    .info-box {
      padding: 0.875rem;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: var(--radius-md, 0.375rem);
      margin-bottom: 1rem;
    }
    
    .info-box-title {
      font-weight: 600;
      font-size: 0.875rem;
      color: #1e40af;
      margin-bottom: 0.25rem;
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }
    
    .info-box-text {
      font-size: 0.8125rem;
      color: #3b82f6;
    }
  `;

  open(config?: ProviderConfig, providerId?: string, isNew = false) {
    this.isNew = isNew;
    this.config = config;
    this.providerId = providerId;
    this._formData = config ? { ...config } : {};
    this._providerId = providerId || '';
    this._errors.clear();
    this._showAdvanced = false;
    this._selectedPreset = 'custom';
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
    this.dispatchEvent(new CustomEvent<ProviderEditDialogResult>('close', {
      detail: { confirmed: false },
      bubbles: true,
      composed: true,
    }));
  }

  private _validate(): boolean {
    this._errors.clear();
    
    if (this.isNew) {
      if (!this._providerId || this._providerId.trim() === '') {
        this._errors.set('providerId', 'Provider ID is required');
      } else if (!/^[a-z0-9-_]+$/i.test(this._providerId)) {
        this._errors.set('providerId', 'Only letters, numbers, hyphens, and underscores allowed');
      }
    }
    
    if (this._formData.baseUrl) {
      try {
        new URL(this._formData.baseUrl);
      } catch {
        this._errors.set('baseUrl', 'Must be a valid URL');
      }
    }
    
    this.requestUpdate();
    return this._errors.size === 0;
  }

  private _handleSave() {
    if (!this._validate()) return;
    
    const result: ProviderConfig = {
      baseUrl: this._formData.baseUrl || '',
      apiKey: this._formData.apiKey || '',
      api: this._formData.api || 'openai-completions',
      authHeader: this._formData.authHeader,
      headers: this._formData.headers,
      models: this._formData.models || [],
      modelOverrides: this._formData.modelOverrides,
    };
    
    this.dispatchEvent(new CustomEvent<ProviderEditDialogResult>('close', {
      detail: { 
        confirmed: true, 
        providerId: this.isNew ? this._providerId : this.providerId,
        config: result,
      },
      bubbles: true,
      composed: true,
    }));
    this.isOpen = false;
  }

  private _updateField<K extends keyof ProviderConfig>(field: K, value: ProviderConfig[K]) {
    this._formData = { ...this._formData, [field]: value };
    if (this._errors.has(field)) {
      this._errors.delete(field);
      this.requestUpdate();
    }
  }

  private _applyPreset(presetKey: string) {
    this._selectedPreset = presetKey;
    const preset = PROVIDER_PRESETS[presetKey];
    if (preset) {
      this._formData = { ...this._formData, ...preset };
      
      // Auto-fill provider ID for new providers based on preset
      if (this.isNew && !this._providerId && presetKey !== 'custom') {
        this._providerId = presetKey;
      }
    }
    this.requestUpdate();
  }

  render() {
    if (!this.isOpen) return '';
    
    const title = this.isNew ? 'Add New Provider' : 'Edit Provider';
    
    return html`
      <div class="dialog-overlay" @click=${(e: Event) => {
        if (e.target === e.currentTarget) this.close();
      }}>
        <div class="dialog">
          <div class="dialog-header">
            <div>
              <div class="dialog-title">${title}</div>
              ${!this.isNew ? html`
                <div class="dialog-subtitle">Editing: ${this.providerId}</div>
              ` : ''}
            </div>
            <button class="close-btn" @click=${this.close}>
              ${getIcon('x')}
            </button>
          </div>
          
          <div class="dialog-body">
            ${this.isNew ? this._renderNewProviderForm() : this._renderEditForm()}
          </div>
          
          <div class="dialog-footer">
            <button class="btn btn-secondary" @click=${this.close}>
              Cancel
            </button>
            <button class="btn btn-primary" @click=${this._handleSave}>
              ${this.isNew ? 'Add Provider' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderNewProviderForm() {
    return html`
      <div class="form-grid">
        ${this._renderPresetSelection()}
        
        <div class="section-title">
          ${getIcon('settings')} Provider Configuration
        </div>
        
        <div class="field-group">
          <label class="field-label">
            Provider ID <span class="required">*</span>
          </label>
          <input
            class="text-input ${this._errors.has('providerId') ? 'error' : ''}"
            type="text"
            .value=${this._providerId}
            placeholder="e.g., ollama, my-openai-proxy"
            @input=${(e: Event) => {
              this._providerId = (e.target as HTMLInputElement).value.toLowerCase();
              if (this._errors.has('providerId')) {
                this._errors.delete('providerId');
                this.requestUpdate();
              }
            }}
          />
          <span class="field-hint">
            Unique identifier (lowercase, alphanumeric, hyphens, underscores)
          </span>
          ${this._errors.has('providerId') ? html`
            <span class="error-message">${getIcon('alertCircle')} ${this._errors.get('providerId')}</span>
          ` : ''}
        </div>
        
        ${this._renderCommonFields()}
      </div>
    `;
  }

  private _renderEditForm() {
    return html`
      <div class="form-grid">
        ${this._renderCommonFields()}
      </div>
    `;
  }

  private _renderPresetSelection() {
    return html`
      <div class="info-box">
        <div class="info-box-title">${getIcon('info')} Quick Setup</div>
        <div class="info-box-text">Select a preset to auto-fill common configurations, or choose "Custom" for manual setup.</div>
      </div>
      
      <div class="preset-grid">
        ${Object.entries(PROVIDER_PRESETS).map(([key, preset]) => html`
          <button 
            class="preset-btn ${this._selectedPreset === key ? 'active' : ''}"
            @click=${() => this._applyPreset(key)}
          >
            <div class="preset-name">${this._formatPresetName(key)}</div>
            <div class="preset-desc">${this._getPresetDescription(key)}</div>
          </button>
        `)}
      </div>
    `;
  }

  private _renderCommonFields() {
    return html`
      <div class="field-group">
        <label class="field-label">API Type</label>
        <select
          class="select-input"
          .value=${this._formData.api || 'openai-completions'}
          @change=${(e: Event) => this._updateField('api', (e.target as HTMLSelectElement).value as any)}
        >
          ${API_TYPES.map(api => html`
            <option value=${api.value}>${api.label}</option>
          `)}
        </select>
        <span class="field-hint">The API protocol this provider uses</span>
      </div>
      
      <div class="field-group">
        <label class="field-label">
          Base URL ${this.isNew ? html`<span class="required">*</span>` : ''}
        </label>
        <div class="input-with-suffix">
          <input
            class="text-input ${this._errors.has('baseUrl') ? 'error' : ''}"
            type="text"
            .value=${this._formData.baseUrl || ''}
            placeholder="https://api.example.com/v1"
            @input=${(e: Event) => this._updateField('baseUrl', (e.target as HTMLInputElement).value)}
          />
          ${this._formData.baseUrl?.includes('/v1') ? html`
            <span class="input-suffix">/v1</span>
          ` : ''}
        </div>
        <span class="field-hint">The API endpoint URL (should end with /v1 for OpenAI-compatible)</span>
        ${this._errors.has('baseUrl') ? html`
          <span class="error-message">${getIcon('alertCircle')} ${this._errors.get('baseUrl')}</span>
        ` : ''}
      </div>
      
      <div class="field-group">
        <label class="field-label">API Key</label>
        <input
          class="text-input"
          type="text"
          .value=${this._formData.apiKey || ''}
          placeholder="sk-... or ENV_VAR or !command"
          @input=${(e: Event) => this._updateField('apiKey', (e.target as HTMLInputElement).value)}
        />
        <span class="field-hint">
          Supports: literal value, ENV_VAR (uppercase), or !shell command
        </span>
      </div>
      
      <button 
        class="toggle-advanced"
        @click=${() => this._showAdvanced = !this._showAdvanced}
      >
        ${getIcon(this._showAdvanced ? 'chevronUp' : 'chevronDown')}
        ${this._showAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options'}
      </button>
      
      ${this._showAdvanced ? html`
        <div class="advanced-section">
          <div class="field-group" style="margin-bottom: 1rem;">
            <label class="checkbox-label">
              <input
                class="checkbox-input"
                type="checkbox"
                .checked=${this._formData.authHeader || false}
                @change=${(e: Event) => this._updateField('authHeader', (e.target as HTMLInputElement).checked)}
              />
              Add Authorization header automatically
            </label>
            <span class="field-hint">Adds "Authorization: Bearer {apiKey}" header to requests</span>
          </div>
          
          <div class="field-group">
            <label class="field-label">Custom Headers (JSON)</label>
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
            <span class="field-hint">Optional custom headers in JSON format</span>
          </div>
        </div>
      ` : ''}
    `;
  }

  private _formatPresetName(key: string): string {
    const names: Record<string, string> = {
      ollama: 'Ollama',
      lmstudio: 'LM Studio',
      openrouter: 'OpenRouter',
      'vercel-ai-gateway': 'Vercel AI Gateway',
      vllm: 'vLLM',
      custom: 'Custom',
    };
    return names[key] || key;
  }

  private _getPresetDescription(key: string): string {
    const descriptions: Record<string, string> = {
      ollama: 'Local LLMs via Ollama',
      lmstudio: 'LM Studio local server',
      openrouter: 'Multi-provider API',
      'vercel-ai-gateway': 'Vercel AI Gateway',
      vllm: 'vLLM inference server',
      custom: 'Manual configuration',
    };
    return descriptions[key] || '';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'provider-edit-dialog': ProviderEditDialog;
  }
}
