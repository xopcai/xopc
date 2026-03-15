/**
 * ModelJsonEditor Component
 * 
 * Visual editor for models.json configuration
 */

import { html, LitElement, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';

import type { 
  ModelsJsonConfig, 
  ProviderConfig, 
  CustomModel,
  ValidationResult,
} from '../config/models-json-client.js';
import type { ApiType } from '../config/models-json-types.js';
import {
  validateModelsJson,
  saveModelsJson,
  reloadModelsJson,
  testApiKey,
  getApiKeyType,
  maskApiKey,
} from '../config/models-json-client.js';
import './ModelEditDialog.js';
import type { ModelEditDialog, ModelEditDialogResult } from './ModelEditDialog.js';
import './ProviderEditDialog.js';
import type { ProviderEditDialog, ProviderEditDialogResult } from './ProviderEditDialog.js';

// API types for dropdown
const API_TYPES = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI' },
  { value: 'bedrock-converse-stream', label: 'AWS Bedrock' },
];

interface EditorState {
  expandedProviders: Set<string>;
  editingModel: { provider: string; modelId: string } | null;
  showRawJson: boolean;
}

@customElement('model-json-editor')
export class ModelJsonEditor extends LitElement {
  @property({ attribute: false }) config: ModelsJsonConfig = { providers: {} };
  @property({ type: String }) token?: string;
  @property({ type: String }) error?: string;
  
  @state() private _loading = false;
  @state() private _saving = false;
  @state() private _validation: ValidationResult | null = null;
  @state() private _editorState: EditorState = {
    expandedProviders: new Set(),
    editingModel: null,
    showRawJson: false,
  };
  @state() private _showPasswords: Set<string> = new Set();
  @state() private _testResults: Map<string, { type: string; resolved?: string; error?: string }> = new Map();
  @query('model-edit-dialog') private _editDialog!: ModelEditDialog;
  @query('provider-edit-dialog') private _providerEditDialog!: ProviderEditDialog;

  static styles = css`
    :host { display: block; }
    
    .editor-header {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }
    
    .provider-card {
      border: 1px solid var(--border-color, #e2e8f0);
      border-radius: var(--radius-md, 0.5rem);
      margin-bottom: 0.75rem;
      overflow: hidden;
    }
    
    .provider-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      background: var(--bg-secondary, #f8fafc);
      cursor: pointer;
      user-select: none;
    }
    
    .provider-header:hover {
      background: var(--bg-tertiary, #f1f5f9);
    }
    
    .provider-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
    }
    
    .provider-badge {
      font-size: 0.75rem;
      padding: 0.125rem 0.5rem;
      border-radius: 9999px;
      background: var(--accent-primary, #3b82f6);
      color: white;
    }
    
    .provider-content {
      padding: 1rem;
      display: none;
    }
    
    .provider-content.expanded {
      display: block;
    }
    
    .field-group {
      margin-bottom: 1rem;
    }
    
    .field-label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      margin-bottom: 0.25rem;
      color: var(--text-secondary, #475569);
    }
    
    .text-input, .select-input, .textarea-input {
      width: 100%;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--border-color, #e2e8f0);
      border-radius: var(--radius-md, 0.375rem);
      background: var(--bg-primary, white);
      color: var(--text-primary, #0f172a);
      font-size: 0.875rem;
    }
    
    .text-input:focus, .select-input:focus, .textarea-input:focus {
      outline: none;
      border-color: var(--accent-primary, #3b82f6);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
    }
    
    .input-with-actions {
      display: flex;
      gap: 0.5rem;
    }
    
    .input-with-actions .text-input {
      flex: 1;
    }
    
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.5rem 0.75rem;
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
    
    .btn-secondary {
      background: var(--bg-secondary, #f1f5f9);
      color: var(--text-primary, #0f172a);
      border: 1px solid var(--border-color, #e2e8f0);
    }
    
    .btn-secondary:hover {
      background: var(--bg-tertiary, #e2e8f0);
    }
    
    .btn-ghost {
      background: transparent;
      color: var(--text-secondary, #64748b);
    }
    
    .btn-ghost:hover {
      background: var(--bg-secondary, #f1f5f9);
    }
    
    .btn-icon {
      padding: 0.375rem;
      background: transparent;
      border: none;
      cursor: pointer;
      border-radius: var(--radius-md, 0.375rem);
      color: var(--text-secondary, #64748b);
    }
    
    .btn-icon:hover {
      background: var(--bg-secondary, #f1f5f9);
      color: var(--text-primary, #0f172a);
    }
    
    .btn-sm {
      padding: 0.375rem 0.5rem;
      font-size: 0.75rem;
    }
    
    .models-section {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border-color, #e2e8f0);
    }
    
    .model-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      background: var(--bg-secondary, #f8fafc);
      border-radius: var(--radius-md, 0.375rem);
      margin-bottom: 0.5rem;
    }
    
    .model-actions {
      display: flex;
      gap: 0.25rem;
    }
    
    .empty-state {
      padding: 1.5rem;
      text-align: center;
      color: var(--text-muted, #94a3b8);
    }
    
    .error-alert {
      padding: 0.75rem 1rem;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: var(--radius-md, 0.375rem);
      color: #dc2626;
      margin-bottom: 1rem;
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
    }
    
    .success-alert {
      padding: 0.75rem 1rem;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: var(--radius-md, 0.375rem);
      color: #16a34a;
      margin-bottom: 1rem;
    }
    
    .validation-errors {
      margin-top: 1rem;
      padding: 0.75rem;
      background: #fefce8;
      border: 1px solid #fde047;
      border-radius: var(--radius-md, 0.375rem);
    }
    
    .validation-error {
      font-size: 0.875rem;
      color: #854d0e;
      margin-bottom: 0.25rem;
    }
    
    .api-key-type {
      font-size: 0.75rem;
      padding: 0.125rem 0.375rem;
      border-radius: 9999px;
      background: var(--bg-tertiary, #e2e8f0);
      color: var(--text-secondary, #64748b);
    }
    
    .api-key-type.shell {
      background: #dbeafe;
      color: #1e40af;
    }
    
    .api-key-type.env {
      background: #dcfce7;
      color: #166534;
    }
    
    .test-result {
      font-size: 0.75rem;
      margin-top: 0.25rem;
    }
    
    .test-result.success {
      color: #16a34a;
    }
    
    .test-result.error {
      color: #dc2626;
    }
    
    .raw-json {
      font-family: monospace;
      font-size: 0.75rem;
      white-space: pre-wrap;
      background: var(--bg-secondary, #f8fafc);
      padding: 1rem;
      border-radius: var(--radius-md, 0.375rem);
      overflow: auto;
      max-height: 400px;
    }
    
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }

    /* Stats Badge Styles */
    .stats-badge {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.375rem 0.75rem;
      background: var(--bg-secondary, #f1f5f9);
      border-radius: var(--radius-md, 0.375rem);
      font-size: 0.875rem;
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .stat-item.empty {
      opacity: 0.5;
    }

    .stat-number {
      font-weight: 600;
      color: var(--accent-primary, #3b82f6);
    }

    .stat-item.empty .stat-number {
      color: var(--text-muted, #94a3b8);
    }

    .stat-label {
      color: var(--text-muted, #64748b);
    }

    .stat-separator {
      color: var(--border-color, #e2e8f0);
    }

    /* Enhanced Empty State Styles */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem 2rem;
      text-align: center;
      background: linear-gradient(135deg, var(--bg-secondary, #f8fafc) 0%, var(--bg-primary, white) 100%);
      border: 2px dashed var(--border-color, #e2e8f0);
      border-radius: var(--radius-lg, 0.75rem);
      margin: 1rem 0;
    }

    .empty-icon {
      width: 64px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bg-primary, white);
      border-radius: 50%;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      margin-bottom: 1.5rem;
      color: var(--accent-primary, #3b82f6);
    }

    .empty-icon svg {
      width: 32px;
      height: 32px;
    }

    .empty-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text-primary, #0f172a);
      margin: 0 0 0.5rem;
    }

    .empty-description {
      font-size: 0.9375rem;
      color: var(--text-muted, #64748b);
      max-width: 400px;
      margin: 0 0 1.5rem;
      line-height: 1.6;
    }

    .empty-actions {
      margin-bottom: 1.5rem;
    }

    .empty-suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: center;
    }

    .suggestion-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.5rem 0.875rem;
      background: var(--bg-primary, white);
      border: 1px solid var(--border-color, #e2e8f0);
      border-radius: var(--radius-full, 9999px);
      font-size: 0.8125rem;
      color: var(--text-secondary, #475569);
      cursor: pointer;
      transition: all 0.15s;
    }

    .suggestion-tag:hover {
      border-color: var(--accent-primary, #3b82f6);
      background: rgba(59, 130, 246, 0.05);
      color: var(--accent-primary, #3b82f6);
      transform: translateY(-1px);
    }

    .suggestion-tag svg {
      width: 14px;
      height: 14px;
    }

    @media (max-width: 640px) {
      .empty-state {
        padding: 2rem 1rem;
      }

      .empty-title {
        font-size: 1.125rem;
      }

      .empty-description {
        font-size: 0.875rem;
      }

      .stats-badge {
        font-size: 0.8125rem;
        padding: 0.25rem 0.5rem;
      }
    }

    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    
    .dialog {
      background: var(--bg-primary, white);
      border-radius: var(--radius-lg, 0.5rem);
      width: 90%;
      max-width: 500px;
      max-height: 80vh;
      overflow: auto;
      padding: 1.5rem;
    }
    
    .dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }
    
    .dialog-title {
      font-size: 1.125rem;
      font-weight: 600;
    }
    
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
    }
  `;

  // ============================================
  // Event Handlers
  // ============================================

  private _toggleProvider(providerId: string) {
    const expanded = new Set(this._editorState.expandedProviders);
    if (expanded.has(providerId)) {
      expanded.delete(providerId);
    } else {
      expanded.add(providerId);
    }
    this._editorState = { ...this._editorState, expandedProviders: expanded };
  }

  private _updateProvider(providerId: string, updates: Partial<ProviderConfig>) {
    const newConfig = { ...this.config };
    newConfig.providers = { ...newConfig.providers };
    newConfig.providers[providerId] = {
      ...newConfig.providers[providerId],
      ...updates,
    };
    this._emitChange(newConfig);
  }

  private _addProvider() {
    const handleClose = (e: CustomEvent<ProviderEditDialogResult>) => {
      this._providerEditDialog.removeEventListener('close', handleClose as EventListener);
      
      if (e.detail.confirmed && e.detail.providerId && e.detail.config) {
        const newConfig = { ...this.config };
        newConfig.providers = { ...newConfig.providers };
        newConfig.providers[e.detail.providerId] = e.detail.config;
        
        const expanded = new Set(this._editorState.expandedProviders);
        expanded.add(e.detail.providerId);
        
        this._editorState = { ...this._editorState, expandedProviders: expanded };
        this._emitChange(newConfig);
      }
    };
    
    this._providerEditDialog.addEventListener('close', handleClose as EventListener);
    this._providerEditDialog.open(undefined, undefined, true);
  }

  private _quickAddProvider(preset: string) {
    // Quick add with preset - directly open the dialog with preset applied
    const handleClose = (e: CustomEvent<ProviderEditDialogResult>) => {
      this._providerEditDialog.removeEventListener('close', handleClose as EventListener);
      
      if (e.detail.confirmed && e.detail.providerId && e.detail.config) {
        const newConfig = { ...this.config };
        newConfig.providers = { ...newConfig.providers };
        newConfig.providers[e.detail.providerId] = e.detail.config;
        
        const expanded = new Set(this._editorState.expandedProviders);
        expanded.add(e.detail.providerId);
        
        this._editorState = { ...this._editorState, expandedProviders: expanded };
        this._emitChange(newConfig);
      }
    };
    
    this._providerEditDialog.addEventListener('close', handleClose as EventListener);
    
    // Open with preset configuration
    const presets: Record<string, Partial<ProviderConfig>> = {
      ollama: { baseUrl: 'http://localhost:11434/v1', api: 'openai-completions', apiKey: 'ollama' },
      openrouter: { baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions', apiKey: '' },
      lmstudio: { baseUrl: 'http://localhost:1234/v1', api: 'openai-completions', apiKey: 'lmstudio' },
    };
    
    const presetConfig = presets[preset];
    if (presetConfig) {
      this._providerEditDialog.open({ ...presetConfig, models: [] }, preset, true);
    } else {
      this._providerEditDialog.open(undefined, undefined, true);
    }
  }

  private _removeProvider(providerId: string) {
    if (!confirm(`Remove provider "${providerId}"?`)) return;
    
    const newConfig = { ...this.config };
    newConfig.providers = { ...newConfig.providers };
    delete newConfig.providers[providerId];
    this._emitChange(newConfig);
  }

  private _addModel(providerId: string) {
    this._editorState = { ...this._editorState, editingModel: { provider: providerId, modelId: '' } };
    
    const handleClose = (e: CustomEvent<ModelEditDialogResult>) => {
      this._editDialog.removeEventListener('close', handleClose as EventListener);
      
      if (e.detail.confirmed && e.detail.model) {
        const provider = this.config.providers[providerId];
        this._updateProvider(providerId, {
          models: [...(provider.models || []), e.detail.model],
        });
      }
    };
    
    this._editDialog.addEventListener('close', handleClose as EventListener);
    this._editDialog.open(undefined, true);
  }

  private _removeModel(providerId: string, modelId: string) {
    const provider = this.config.providers[providerId];
    this._updateProvider(providerId, {
      models: (provider.models || []).filter(m => m.id !== modelId),
    });
  }

  private _updateModel(providerId: string, modelId: string, updates: Partial<CustomModel>) {
    const provider = this.config.providers[providerId];
    this._updateProvider(providerId, {
      models: (provider.models || []).map(m =>
        m.id === modelId ? { ...m, ...updates } : m
      ),
    });
  }

  private _emitChange(config: ModelsJsonConfig) {
    this.dispatchEvent(new CustomEvent<{ config: ModelsJsonConfig }>('change', {
      detail: { config },
      bubbles: true,
      composed: true,
    }));
  }

  private async _validate() {
    this._loading = true;
    try {
      this._validation = await validateModelsJson(this.config, this.token);
    } catch (err) {
      console.error('Validation failed:', err);
    } finally {
      this._loading = false;
    }
  }

  private async _save() {
    this._saving = true;
    try {
      await saveModelsJson(this.config, this.token);
      this.dispatchEvent(new CustomEvent('save', { bubbles: true, composed: true }));
    } catch (err) {
      console.error('Save failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      this._saving = false;
    }
  }

  private async _reload() {
    this._loading = true;
    try {
      const result = await reloadModelsJson(this.token);
      this.dispatchEvent(new CustomEvent('reload', { 
        detail: result,
        bubbles: true, 
        composed: true 
      }));
    } catch (_err: unknown) {
      console.error('Reload failed:', _err);
    } finally {
      this._loading = false;
    }
  }

  private async _testApiKey(providerId: string, value: string) {
    try {
      const result = await testApiKey(value, this.token);
      this._testResults = new Map(this._testResults);
      this._testResults.set(providerId, result);
      this.requestUpdate();
    } catch (err) {
      console.error('API key test failed:', err);
    }
  }

  private _togglePassword(providerId: string) {
    const show = new Set(this._showPasswords);
    if (show.has(providerId)) {
      show.delete(providerId);
    } else {
      show.add(providerId);
    }
    this._showPasswords = show;
  }

  // ============================================
  // Rendering
  // ============================================

  render() {
    const editingModel = this._editorState.editingModel;
    const _currentModel = editingModel 
      ? this.config.providers[editingModel.provider]?.models?.find(m => m.id === editingModel.modelId)
      : undefined;
    
    return html`
      ${this.error ? html`
        <div class="error-alert">
          ${getIcon('alertCircle')}
          <span>${this.error}</span>
        </div>
      ` : ''}
      
      ${this._renderHeader()}
      ${this._renderProviders()}
      ${this._renderValidationErrors()}
      ${this._editorState.showRawJson ? this._renderRawJson() : ''}
      
      <model-edit-dialog
        .providerId=${editingModel?.provider}
      ></model-edit-dialog>
      
      <provider-edit-dialog></provider-edit-dialog>
    `;
  }

  private _renderHeader() {
    const providerCount = Object.keys(this.config.providers).length;
    const modelCount = Object.values(this.config.providers).reduce(
      (sum, p) => sum + (p.models?.length || 0), 0
    );

    return html`
      <div class="editor-header">
        <button class="btn btn-primary" @click=${this._addProvider}>
          ${getIcon('plus')} Add Provider
        </button>
        <button class="btn btn-secondary" @click=${this._validate} ?disabled=${this._loading}>
          ${this._loading ? 'Validating...' : 'Validate'}
        </button>
        <button class="btn btn-secondary" @click=${this._save} ?disabled=${this._saving}>
          ${this._saving ? 'Saving...' : 'Save'}
        </button>
        <button class="btn btn-secondary" @click=${this._reload} ?disabled=${this._loading}>
          ${getIcon('refreshCw')} Reload
        </button>
        <button class="btn btn-ghost" @click=${() => this._editorState = { ...this._editorState, showRawJson: !this._editorState.showRawJson }}>
          ${this._editorState.showRawJson ? 'Hide JSON' : 'Show JSON'}
        </button>
        <div class="stats-badge">
          <span class="stat-item ${providerCount === 0 ? 'empty' : ''}">
            <span class="stat-number">${providerCount}</span>
            <span class="stat-label">provider${providerCount !== 1 ? 's' : ''}</span>
          </span>
          <span class="stat-separator">|</span>
          <span class="stat-item ${modelCount === 0 ? 'empty' : ''}">
            <span class="stat-number">${modelCount}</span>
            <span class="stat-label">model${modelCount !== 1 ? 's' : ''}</span>
          </span>
        </div>
      </div>
    `;
  }

  private _renderProviders() {
    const providers = Object.entries(this.config.providers);
    
    if (providers.length === 0) {
      return html`
        <div class="empty-state">
          <div class="empty-icon">
            ${getIcon('cpu')}
          </div>
          <h3 class="empty-title">No Custom Providers</h3>
          <p class="empty-description">
            Add custom model providers like Ollama, vLLM, OpenRouter, or other OpenAI-compatible APIs.
          </p>
          <div class="empty-actions">
            <button class="btn btn-primary" @click=${this._addProvider}>
              ${getIcon('plus')} Add Your First Provider
            </button>
          </div>
          <div class="empty-suggestions">
            <div class="suggestion-tag" @click=${() => this._quickAddProvider('ollama')}>
              ${getIcon('zap')} Ollama
            </div>
            <div class="suggestion-tag" @click=${() => this._quickAddProvider('openrouter')}>
              ${getIcon('globe')} OpenRouter
            </div>
            <div class="suggestion-tag" @click=${() => this._quickAddProvider('lmstudio')}>
              ${getIcon('monitor')} LM Studio
            </div>
          </div>
        </div>
      `;
    }

    return html`
      ${providers.map(([id, config]) => this._renderProvider(id, config))}
    `;
  }

  private _renderProvider(id: string, config: ProviderConfig) {
    const isExpanded = this._editorState.expandedProviders.has(id);
    const modelCount = config.models?.length || 0;
    const isPasswordVisible = this._showPasswords.has(id);
    const testResult = this._testResults.get(id);
    const apiKeyType = config.apiKey ? getApiKeyType(config.apiKey) : null;

    return html`
      <div class="provider-card">
        <div class="provider-header" @click=${() => this._toggleProvider(id)}>
          <div class="provider-title">
            ${getIcon(isExpanded ? 'chevronDown' : 'chevronRight')}
            <span>${id}</span>
            ${modelCount > 0 ? html`<span class="provider-badge">${modelCount} models</span>` : ''}
            ${apiKeyType ? html`<span class="api-key-type ${apiKeyType}">${apiKeyType}</span>
            ` : ''}
          </div>
          <button class="btn-icon" @click=${(e: Event) => { e.stopPropagation(); this._removeProvider(id); }}>
            ${getIcon('trash')}
          </button>
        </div>
        
        <div class="provider-content ${isExpanded ? 'expanded' : ''}">
          ${this._renderProviderConfig(id, config, isPasswordVisible, testResult)}
          ${this._renderModelsSection(id, config)}
        </div>
      </div>
    `;
  }

  private _renderProviderConfig(
    id: string, 
    config: ProviderConfig, 
    isPasswordVisible: boolean,
    testResult?: { type: string; resolved?: string; error?: string }
  ) {
    return html`
      <div class="grid-2">
        <div class="field-group">
          <label class="field-label">Base URL</label>
          <input
            class="text-input"
            type="text"
            .value=${config.baseUrl || ''}
            placeholder="https://api.example.com/v1"
            @change=${(e: Event) => this._updateProvider(id, { baseUrl: (e.target as HTMLInputElement).value })}
          >
        </div>
        
        <div class="field-group">
          <label class="field-label">API Type</label>
          <select
            class="select-input"
            .value=${config.api || 'openai-completions'}
            @change=${(e: Event) => this._updateProvider(id, { api: (e.target as HTMLSelectElement).value as ApiType })}
          >
            ${API_TYPES.map(api => html`<option value=${api.value}>${api.label}</option>
            `)}
          </select>
        </div>
      </div>
      
      <div class="field-group">
        <label class="field-label">API Key</label>
        <div class="input-with-actions">
          <input
            class="text-input"
            type=${isPasswordVisible ? 'text' : 'password'}
            .value=${config.apiKey || ''}
            placeholder="sk-... or ENV_VAR or !command"
            @change=${(e: Event) => {
              this._updateProvider(id, { apiKey: (e.target as HTMLInputElement).value });
              this._testResults.delete(id);
            }}
          >
          <button class="btn btn-secondary btn-sm" @click=${() => this._togglePassword(id)}>
            ${isPasswordVisible ? 'Hide' : 'Show'}
          </button>
          <button class="btn btn-secondary btn-sm" @click=${() => this._testApiKey(id, config.apiKey || '')}>
            Test
          </button>
        </div>
        ${testResult ? html`
          <div class="test-result ${testResult.error ? 'error' : 'success'}">
            ${testResult.error 
              ? `Error: ${testResult.error}` 
              : `Resolved (${testResult.type}): ${maskApiKey(testResult.resolved || '')}`
            }
          </div>
        ` : ''}
        <small style="color: var(--text-muted, #94a3b8)">
          Supports: literal value, ENV_VAR name (uppercase), or !shell command
        </small>
      </div>
      
      <div class="field-group">
        <label class="toggle-label" style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
          <input
            type="checkbox"
            .checked=${config.authHeader || false}
            @change=${(e: Event) => this._updateProvider(id, { authHeader: (e.target as HTMLInputElement).checked })}
          >
          <span>Add Authorization header automatically</span>
        </label>
      </div>
    `;
  }

  private _renderModelsSection(providerId: string, config: ProviderConfig) {
    const models = config.models || [];

    return html`
      <div class="models-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <span style="font-weight: 600;">Models</span>
          <button class="btn btn-primary btn-sm" @click=${() => this._addModel(providerId)}>
            ${getIcon('plus')} Add Model
          </button>
        </div>
        
        ${models.length === 0 ? html`
          <p style="color: var(--text-muted, #94a3b8); font-size: 0.875rem;">
            No custom models. Models from this provider will inherit from built-in configuration.
          </p>
        ` : html`
          ${models.map(model => this._renderModel(providerId, model))}
        `}
      </div>
    `;
  }

  private _renderModel(providerId: string, model: CustomModel) {
    return html`
      <div class="model-item">
        <div>
          <div style="font-weight: 500;">${model.id}</div>
          ${model.name && model.name !== model.id ? html`
            <div style="font-size: 0.75rem; color: var(--text-muted, #94a3b8);">${model.name}</div>
          ` : ''}
        </div>
        <div class="model-actions">
          <button class="btn-icon" @click=${() => this._editModel(providerId, model)}>
            ${getIcon('edit')}
          </button>
          <button class="btn-icon" @click=${() => this._removeModel(providerId, model.id)}>
            ${getIcon('trash')}
          </button>
        </div>
      </div>
    `;
  }

  private _editModel(providerId: string, model: CustomModel) {
    this._editorState = { ...this._editorState, editingModel: { provider: providerId, modelId: model.id } };
    
    const handleClose = (e: CustomEvent<ModelEditDialogResult>) => {
      this._editDialog.removeEventListener('close', handleClose as EventListener);
      
      if (e.detail.confirmed && e.detail.model) {
        const provider = this.config.providers[providerId];
        const updatedModels = (provider.models || []).map(m =>
          m.id === model.id ? e.detail.model! : m
        );
        this._updateProvider(providerId, { models: updatedModels });
      }
    };
    
    this._editDialog.addEventListener('close', handleClose as EventListener);
    this._editDialog.open(model, false);
  }

  private _renderValidationErrors() {
    if (!this._validation || this._validation.errors.length === 0) return '';
    
    return html`
      <div class="validation-errors">
        <div style="font-weight: 600; margin-bottom: 0.5rem;">
          ${this._validation.valid ? 'Warnings' : 'Validation Errors'}
        </div>
        ${this._validation.errors.map(err => html`
          <div class="validation-error">
            ${err.path}: ${err.message} (${err.severity})
          </div>
        `)}
      </div>
    `;
  }

  private _renderRawJson() {
    return html`
      <div class="raw-json">${JSON.stringify(this.config, null, 2)}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'model-json-editor': ModelJsonEditor;
  }
}
