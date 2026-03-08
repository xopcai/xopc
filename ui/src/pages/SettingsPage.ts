// Settings Page Component

import { html, LitElement } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { 
  User, Bot, Plug, Globe, Search, Clock, Puzzle, 
  X, Save, ChevronRight, Check, AlertCircle,
  Settings, Eye, EyeOff, Loader2, RefreshCw, Key, Lock
} from 'lucide';
import { getIcon } from '../utils/icons';
import { t } from '../utils/i18n';
import type { ProviderTemplate } from '../config/provider-templates.js';
import { PROVIDER_TEMPLATES, getProviderTemplate } from '../config/provider-templates.js';
import { loadDynamicProviders, toProviderTemplate, getAllProviderTemplates, type DynamicProviderInfo } from '../config/dynamic-providers.js';

// Model and Provider interfaces
export interface ModelConfig {
  id: string;
  name: string;
  capabilities: {
    text: boolean;
    image: boolean;
    reasoning: boolean;
  };
  contextWindow: number;
  maxTokens: number;
  cost?: {
    input: number;
    output: number;
  };
}

export interface ProviderConfig {
  id: string;
  baseUrl: string;
  api: string;
  apiKey: string;
  models: ModelConfig[];
}

export interface SettingsPageConfig {
  /** @deprecated No longer needed - always uses current origin */
  url?: string;
  token?: string;
}

export interface SettingsSection {
  id: string;
  title: string;
  icon: string;
  fields: SettingsField[];
}

export interface SettingsField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'textarea';
  description?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string; group?: string }>;
  validation?: {
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: string;
  };
  // For select fields with search
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

export interface SettingsValue {
  [key: string]: any;
}

@customElement('settings-page')
export class SettingsPage extends LitElement {
  @property({ attribute: false }) config?: SettingsPageConfig;

  @state() private _activeSection = 'agent';
  @state() private _loading = false;
  @state() private _saving = false;
  @state() private _refreshingToken = false;
  @state() private _serverToken: string | null = null;
  @state() private _showToken = false;
  @state() private _dirtyFields: Set<string> = new Set();
  @state() private _errors: Map<string, string> = new Map();
  @state() private _saveSuccess = false;
  @state() private _models: Array<{
    id: string;
    name: string;
    provider: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
    vision?: boolean;
    cost?: { input: number; output: number };
  }> = [];

  // Provider and Model management
  @state() private _providers: ProviderConfig[] = [];
  @state() private _expandedProviders: Set<string> = new Set();
  @state() private _editingModel: { providerId: string; model: ModelConfig } | null = null;
  @state() private _showAddModelModal = false;
  @state() private _showAddProviderModal = false;
  @state() private _editingProvider: ProviderConfig | null = null;
  @state() private _newProvider: ProviderConfig = {
    id: '',
    baseUrl: '',
    api: 'openai-completions',
    apiKey: '',
    models: [],
  };
  @state() private _selectedTemplate: ProviderTemplate | null = null;
  @state() private _templateApiKey: string = '';
  @state() private _showTemplateSelection = true;
  @state() private _dynamicProviders: DynamicProviderInfo[] = [];
  @state() private _staticTemplates: ProviderTemplate[] = [];
  @state() private _loadingDynamicProviders = false;

  @state() private _values: SettingsValue = {
    model: 'anthropic/claude-sonnet-4-5',
    imageModel: '',
    maxTokens: 8192,
    temperature: 0.7,
    maxToolIterations: 20,
    // Telegram
    telegramEnabled: false,
    telegramToken: '',
    telegramApiRoot: '',
    telegramDebug: false,
    telegramAllowFrom: '',
    // WhatsApp
    whatsappEnabled: false,
    whatsappBridgeUrl: 'ws://localhost:3001',
    whatsappAllowFrom: '',
    // Gateway
    gatewayToken: '',
    heartbeatEnabled: true,
    heartbeatIntervalMs: 60000,
    // Providers API Keys (legacy)
    openaiApiKey: '',
    anthropicApiKey: '',
    googleApiKey: '',
    qwenApiKey: '',
    kimiApiKey: '',
    minimaxApiKey: '',
    deepseekApiKey: '',
    grokApiKey: '',
    openrouterApiKey: '',
    // Workspace
    workspace: '',
    theme: 'system',
  };

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
    if (this._initialized) {
      return;
    }
    this._initialized = true;
    
    // Always try to load settings when config changes
    this._loadSettings();
  }

  // Helper: Format context window (e.g., 128K, 1M)
  private _formatContextWindow(tokens?: number): string {
    if (!tokens) return '';
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(0)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
    return tokens.toString();
  }

  // Helper: Format cost (e.g., $2.50/M)
  private _formatCost(cost?: { input: number; output: number }): string {
    if (!cost || (cost.input === 0 && cost.output === 0)) return '';
    return `$${cost.input.toFixed(2)}/M`;
  }

  // Helper: Format model display name with badges
  private _formatModelLabel(m: {
    name: string;
    provider: string;
    contextWindow?: number;
    reasoning?: boolean;
    vision?: boolean;
    cost?: { input: number; output: number };
  }): string {
    const badges: string[] = [];
    
    // Context window badge
    const ctx = this._formatContextWindow(m.contextWindow);
    if (ctx) badges.push(ctx);
    
    // Reasoning badge
    if (m.reasoning) badges.push('🧠');
    
    // Vision badge  
    if (m.vision) badges.push('📷');
    
    // Cost badge (only if non-zero)
    const costStr = this._formatCost(m.cost);
    if (costStr) badges.push(costStr);
    
    const badgeStr = badges.length > 0 ? ` [${badges.join(' ')}]` : '';
    return `${m.provider}/${m.name}${badgeStr}`;
  }

  // Settings sections definition
  private get _sections(): SettingsSection[] {
    // Simple flat list of models with formatted labels
    const modelOptions = this._models.map(m => ({
      value: m.id,
      label: this._formatModelLabel(m),
    }));

    // Filter vision models for imageModel
    const visionModels = this._models.filter(m => m.vision || m.id.includes('vision') || m.id.includes('vl') || m.id.includes('image'));
    const imageModelOptions = [
      { value: '', label: 'None (use primary model)' },
      ...visionModels.map(m => ({
        value: m.id,
        label: this._formatModelLabel(m),
      })),
    ];

    return [
      {
        id: 'agent',
        title: t('settings.sections.agent'),
        icon: 'bot',
        fields: [
          {
            key: 'model',
            label: t('settings.fields.model'),
            type: 'select',
            description: t('settings.descriptionsFields.model'),
            options: modelOptions,
          },
          {
            key: 'imageModel',
            label: t('settings.fields.imageModel'),
            type: 'select',
            description: t('settings.descriptionsFields.imageModel'),
            options: imageModelOptions,
          },
          {
            key: 'workspace',
            label: t('settings.fields.workspace'),
            type: 'text',
            description: t('settings.descriptionsFields.workspace'),
            placeholder: t('settings.placeholders.workspace'),
          },
          {
            key: 'maxTokens',
            label: t('settings.fields.maxTokens'),
            type: 'number',
            description: t('settings.descriptionsFields.maxTokens'),
            validation: { min: 256, max: 128000 },
          },
          {
            key: 'temperature',
            label: t('settings.fields.temperature'),
            type: 'number',
            description: t('settings.descriptionsFields.temperature'),
            validation: { min: 0, max: 2 },
          },
          {
            key: 'maxToolIterations',
            label: t('settings.fields.maxToolIterations'),
            type: 'number',
            description: t('settings.descriptionsFields.maxToolIterations'),
            validation: { min: 1, max: 100 },
          },
        ],
      },
      {
        id: 'providers',
        title: t('settings.sections.providers'),
        icon: 'cloud',
        fields: [
          {
            key: 'openaiApiKey',
            label: t('settings.fields.openaiApiKey'),
            type: 'password',
            description: t('settings.descriptionsFields.openaiApiKey'),
            placeholder: t('settings.placeholders.openaiApiKey'),
          },
          {
            key: 'anthropicApiKey',
            label: t('settings.fields.anthropicApiKey'),
            type: 'password',
            description: t('settings.descriptionsFields.anthropicApiKey'),
            placeholder: t('settings.placeholders.anthropicApiKey'),
          },
          {
            key: 'googleApiKey',
            label: t('settings.fields.googleApiKey'),
            type: 'password',
            description: t('settings.descriptionsFields.googleApiKey'),
            placeholder: t('settings.placeholders.googleApiKey'),
          },
          {
            key: 'qwenApiKey',
            label: t('settings.fields.qwenApiKey'),
            type: 'password',
            description: t('settings.descriptionsFields.qwenApiKey'),
            placeholder: t('settings.placeholders.qwenApiKey'),
          },
          {
            key: 'kimiApiKey',
            label: t('settings.fields.kimiApiKey'),
            type: 'password',
            description: t('settings.descriptionsFields.kimiApiKey'),
            placeholder: t('settings.placeholders.kimiApiKey'),
          },
          {
            key: 'minimaxApiKey',
            label: t('settings.fields.minimaxApiKey'),
            type: 'password',
            description: t('settings.descriptionsFields.minimaxApiKey'),
            placeholder: t('settings.placeholders.minimaxApiKey'),
          },
          {
            key: 'deepseekApiKey',
            label: t('settings.fields.deepseekApiKey'),
            type: 'password',
            description: t('settings.descriptionsFields.deepseekApiKey'),
            placeholder: t('settings.placeholders.deepseekApiKey'),
          },
          {
            key: 'openrouterApiKey',
            label: t('settings.fields.openrouterApiKey'),
            type: 'password',
            description: t('settings.descriptionsFields.openrouterApiKey'),
            placeholder: t('settings.placeholders.openrouterApiKey'),
          },
        ],
      },
      {
        id: 'channels',
        title: t('settings.sections.channels'),
        icon: 'plug',
        fields: [
          // Telegram section
          {
            key: 'telegramEnabled',
            label: t('settings.fields.telegramEnabled'),
            type: 'boolean',
            description: t('settings.descriptionsFields.telegramEnabled'),
          },
          ...(this._values.telegramEnabled ? [
            {
              key: 'telegramToken',
              label: t('settings.fields.telegramToken'),
              type: 'password' as const,
              description: t('settings.descriptionsFields.telegramToken'),
              placeholder: t('settings.placeholders.telegramToken'),
            },
            {
              key: 'telegramApiRoot',
              label: t('settings.fields.telegramApiRoot'),
              type: 'text' as const,
              description: t('settings.descriptionsFields.telegramApiRoot'),
              placeholder: t('settings.placeholders.telegramApiRoot'),
            },
            {
              key: 'telegramAllowFrom',
              label: t('settings.fields.telegramAllowFrom'),
              type: 'text' as const,
              description: t('settings.descriptionsFields.telegramAllowFrom'),
              placeholder: t('settings.placeholders.telegramAllowFrom'),
            },
            {
              key: 'telegramDebug',
              label: t('settings.fields.telegramDebug'),
              type: 'boolean' as const,
              description: t('settings.descriptionsFields.telegramDebug'),
            },
          ] : []),
          // WhatsApp section
          {
            key: 'whatsappEnabled',
            label: t('settings.fields.whatsappEnabled'),
            type: 'boolean',
            description: t('settings.descriptionsFields.whatsappEnabled'),
          },
          ...(this._values.whatsappEnabled ? [
            {
              key: 'whatsappBridgeUrl',
              label: t('settings.fields.whatsappBridgeUrl'),
              type: 'text' as const,
              description: t('settings.descriptionsFields.whatsappBridgeUrl'),
              placeholder: t('settings.placeholders.whatsappBridgeUrl'),
            },
            {
              key: 'whatsappAllowFrom',
              label: t('settings.fields.whatsappAllowFrom'),
              type: 'text' as const,
              description: t('settings.descriptionsFields.whatsappAllowFrom'),
              placeholder: t('settings.placeholders.whatsappAllowFrom'),
            },
          ] : []),
        ],
      },
      {
        id: 'gateway',
        title: t('settings.sections.gateway'),
        icon: 'globe',
        fields: [
          {
            key: 'gatewayToken',
            label: t('settings.fields.gatewayToken'),
            type: 'password',
            description: t('settings.descriptionsFields.gatewayToken'),
            placeholder: t('settings.placeholders.gatewayToken'),
          },
          {
            key: 'heartbeatEnabled',
            label: t('settings.fields.heartbeatEnabled'),
            type: 'boolean',
            description: t('settings.descriptionsFields.heartbeatEnabled'),
          },
          {
            key: 'heartbeatIntervalMs',
            label: t('settings.fields.heartbeatIntervalMs'),
            type: 'number',
            description: t('settings.descriptionsFields.heartbeatIntervalMs'),
            validation: { min: 1000, max: 600000 },
          },
        ],
      },
    ];
  }

  private async _loadSettings(): Promise<void> {
    this._loading = true;
    const url = window.location.origin;
    const token = this.config?.token;

    try {
      // Load models first to ensure options are available
      await this._loadModels();

      // Load gateway token from localStorage (not from server config)
      const savedSettings = this._loadUiSettings();
      this._values.gatewayToken = savedSettings.token || '';

      // Load server token info
      await this._loadServerToken();

      const response = await fetch(`${url}/api/config`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });

      if (response.ok) {
        const data = await response.json();
        const config = data.payload?.config;

        if (config) {
          // Handle model which can be a string or { primary, fallbacks }
          let modelValue = config.agents?.defaults?.model;
          if (modelValue && typeof modelValue === 'object') {
            modelValue = modelValue.primary || '';
          }
          
          this._values = {
            ...this._values,
            model: modelValue || 'anthropic/claude-sonnet-4-5',
            workspace: config.agents?.defaults?.workspace || '',
            maxTokens: config.agents?.defaults?.maxTokens || 8192,
            temperature: config.agents?.defaults?.temperature ?? 0.7,
            maxToolIterations: config.agents?.defaults?.maxToolIterations || 20,
            // Providers (new models config)
            openaiApiKey: config.models?.providers?.openai?.apiKey || '',
            anthropicApiKey: config.models?.providers?.anthropic?.apiKey || '',
            googleApiKey: config.models?.providers?.google?.apiKey || '',
            qwenApiKey: config.models?.providers?.qwen?.apiKey || '',
            kimiApiKey: config.models?.providers?.kimi?.apiKey || '',
            minimaxApiKey: config.models?.providers?.minimax?.apiKey || '',
            deepseekApiKey: config.models?.providers?.deepseek?.apiKey || '',
            openrouterApiKey: config.models?.providers?.openrouter?.apiKey || '',
            // Telegram
            telegramEnabled: config.channels?.telegram?.enabled || false,
            telegramToken: config.channels?.telegram?.token || '',
            telegramApiRoot: config.channels?.telegram?.apiRoot || '',
            telegramDebug: config.channels?.telegram?.debug || false,
            telegramAllowFrom: (config.channels?.telegram?.allowFrom || []).join(', '),
            // WhatsApp
            whatsappEnabled: config.channels?.whatsapp?.enabled || false,
            whatsappBridgeUrl: config.channels?.whatsapp?.bridgeUrl || 'ws://localhost:3001',
            whatsappAllowFrom: (config.channels?.whatsapp?.allowFrom || []).join(', '),
            // Gateway
            heartbeatEnabled: config.gateway?.heartbeat?.enabled ?? true,
            heartbeatIntervalMs: config.gateway?.heartbeat?.intervalMs || 60000,
          };

          // Load providers with models
          this._loadProvidersFromConfig(config.models?.providers || {});
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      this._loading = false;
    }
  }

  /**
   * Load providers from config.
   */
  private _loadProvidersFromConfig(providersConfig: Record<string, any>): void {
    const providers: ProviderConfig[] = [];
    
    for (const [providerId, providerData] of Object.entries(providersConfig)) {
      const models: ModelConfig[] = (providerData.models || []).map((m: any) => ({
        id: m.id || '',
        name: m.name || m.id || '',
        capabilities: {
          text: m.input?.includes('text') || true,
          image: m.input?.includes('image') || false,
          reasoning: m.reasoning || false,
        },
        contextWindow: m.contextWindow || 128000,
        maxTokens: m.maxTokens || 4096,
        cost: m.cost || { input: 0, output: 0 },
      }));

      providers.push({
        id: providerId,
        baseUrl: providerData.baseUrl || '',
        api: providerData.api || 'openai-completions',
        apiKey: providerData.apiKey || '',
        models,
      });
    }

    this._providers = providers;
  }

  /**
   * Toggle provider expanded state.
   */
  private _toggleProvider(providerId: string): void {
    if (this._expandedProviders.has(providerId)) {
      this._expandedProviders.delete(providerId);
    } else {
      this._expandedProviders.add(providerId);
    }
    this.requestUpdate();
  }

  /**
   * Add a new model to a provider.
   */
  private _addModel(providerId: string, model: ModelConfig): void {
    const providerIndex = this._providers.findIndex(p => p.id === providerId);
    if (providerIndex >= 0) {
      const provider = this._providers[providerIndex];
      const updatedProviders = [...this._providers];
      updatedProviders[providerIndex] = { 
        ...provider, 
        models: [...provider.models, model] 
      };
      this._providers = updatedProviders;
      this._dirtyFields.add(`providers.${providerId}.models`);
      this.requestUpdate();
    }
  }

  /**
   * Update an existing model.
   */
  private _updateModel(providerId: string, modelId: string, updates: Partial<ModelConfig>): void {
    const providerIndex = this._providers.findIndex(p => p.id === providerId);
    if (providerIndex >= 0) {
      const provider = this._providers[providerIndex];
      const modelIndex = provider.models.findIndex(m => m.id === modelId);
      if (modelIndex >= 0) {
        // Create new arrays to trigger Lit reactivity
        const updatedModels = [...provider.models];
        updatedModels[modelIndex] = { ...updatedModels[modelIndex], ...updates };
        
        const updatedProviders = [...this._providers];
        updatedProviders[providerIndex] = { ...provider, models: updatedModels };
        
        this._providers = updatedProviders;
        this._dirtyFields.add(`providers.${providerId}.models`);
        this.requestUpdate();
      }
    }
  }

  /**
   * Delete a model from a provider.
   */
  private _deleteModel(providerId: string, modelId: string): void {
    const providerIndex = this._providers.findIndex(p => p.id === providerId);
    if (providerIndex >= 0) {
      const provider = this._providers[providerIndex];
      const updatedProviders = [...this._providers];
      updatedProviders[providerIndex] = {
        ...provider,
        models: provider.models.filter(m => m.id !== modelId)
      };
      this._providers = updatedProviders;
      this._dirtyFields.add(`providers.${providerId}.models`);
      this.requestUpdate();
    }
  }

  /**
   * Add a new provider.
   */
  private _addProvider(provider: ProviderConfig): void {
    this._providers = [...this._providers, provider];
    this._dirtyFields.add(`providers.${provider.id}`);
    this._expandedProviders.add(provider.id);
    this.requestUpdate();
  }

  /**
   * Delete a provider.
   */
  private _deleteProvider(providerId: string): void {
    if (confirm(t('settings.confirmDeleteProvider', { provider: providerId }))) {
      this._providers = this._providers.filter(p => p.id !== providerId);
      this._dirtyFields.add('providers');
      this._expandedProviders.delete(providerId);
      this.requestUpdate();
    }
  }

  /**
   * Load UI settings from localStorage.
   */
  private _loadUiSettings(): { token: string } {
    try {
      const token = localStorage.getItem('xopcbot.token');
      return { token: token || '' };
    } catch {
      return { token: '' };
    }
  }

  /**
   * Save UI settings to localStorage.
   */
  private _saveUiSettings(token: string): void {
    try {
      localStorage.setItem('xopcbot.token', token);
    } catch (err) {
      console.error('Failed to save UI settings:', err);
    }
  }

  /**
   * Load server token info from API.
   */
  private async _loadServerToken(): Promise<void> {
    try {
      const url = window.location.origin;
      const token = this.config?.token;
      const response = await fetch(`${url}/api/auth/token`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });

      if (response.ok) {
        const data = await response.json();
        if (data.ok && data.payload?.token) {
          this._serverToken = data.payload.token;
        }
      }
    } catch (err) {
      console.error('Failed to load server token:', err);
    }
  }

  /**
   * Refresh server token.
   */
  private async _refreshServerToken(): Promise<void> {
    this._refreshingToken = true;

    try {
      const url = window.location.origin;
      const token = this.config?.token;
      const response = await fetch(`${url}/api/auth/token/refresh`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });

      if (response.ok) {
        const data = await response.json();
        if (data.ok && data.payload?.token) {
          this._serverToken = data.payload.token;
          // Also update local token to match
          this._values.gatewayToken = data.payload.token;
          this._saveUiSettings(data.payload.token);
          this.requestUpdate();

          // Show success message
          alert(t('settings.tokenRefreshed'));
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to refresh token');
      }
    } catch (err) {
      console.error('Failed to refresh token:', err);
      alert(err instanceof Error ? err.message : t('settings.failedToRefreshToken'));
    } finally {
      this._refreshingToken = false;
      this.requestUpdate();
    }
  }

  private async _loadModels(): Promise<void> {
    try {
      const url = window.location.origin;
      const token = this.config?.token;
      const response = await fetch(`${url}/api/models`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });

      if (response.ok) {
        const data = await response.json();
        if (data.payload?.models) {
          this._models = data.payload.models;
        }
      }
    } catch (err) {
      console.error('Failed to load models:', err);
    }

    // Also load dynamic providers for the template selection
    await this._loadDynamicProviders();
  }

  private async _loadDynamicProviders(): Promise<void> {
    this._loadingDynamicProviders = true;
    try {
      // Load configured providers (for model selection)
      this._dynamicProviders = await loadDynamicProviders();
      
      // Load all supported provider templates (for adding new providers)
      this._staticTemplates = await getAllProviderTemplates();
    } catch (err) {
      console.error('Failed to load dynamic providers:', err);
      this._dynamicProviders = [];
      this._staticTemplates = [];
    } finally {
      this._loadingDynamicProviders = false;
    }
  }

  private async _saveSettings(): Promise<void> {
    if (this._errors.size > 0) return;

    this._saving = true;
    this._saveSuccess = false;
    const url = window.location.origin;
    const token = this.config?.token;

    // Build updates
    const updates: any = {};

    if (this._dirtyFields.has('model') || this._dirtyFields.has('imageModel') || this._dirtyFields.has('maxTokens') ||
        this._dirtyFields.has('temperature') || this._dirtyFields.has('maxToolIterations') ||
        this._dirtyFields.has('workspace')) {
      updates.agents = { defaults: {} };
      if (this._dirtyFields.has('model')) {
        updates.agents.defaults.model = this._values.model;
      }
      if (this._dirtyFields.has('imageModel')) {
        updates.agents.defaults.imageModel = this._values.imageModel ? { primary: this._values.imageModel } : undefined;
      }
      if (this._dirtyFields.has('workspace')) {
        updates.agents.defaults.workspace = this._values.workspace;
      }
      if (this._dirtyFields.has('maxTokens')) {
        updates.agents.defaults.maxTokens = Number(this._values.maxTokens);
      }
      if (this._dirtyFields.has('temperature')) {
        updates.agents.defaults.temperature = Number(this._values.temperature);
      }
      if (this._dirtyFields.has('maxToolIterations')) {
        updates.agents.defaults.maxToolIterations = Number(this._values.maxToolIterations);
      }
    }

    // Update models config (new format)
    const providerFields = [
      'openaiApiKey', 'anthropicApiKey', 'googleApiKey', 'qwenApiKey', 
      'kimiApiKey', 'minimaxApiKey', 'deepseekApiKey', 'openrouterApiKey'
    ];
    const dirtyProviders = providerFields.filter(f => this._dirtyFields.has(f));
    if (dirtyProviders.length > 0) {
      updates.models = { mode: 'merge', providers: {} };
      if (this._dirtyFields.has('openaiApiKey')) {
        updates.models.providers.openai = { apiKey: this._values.openaiApiKey, models: [] };
      }
      if (this._dirtyFields.has('anthropicApiKey')) {
        updates.models.providers.anthropic = { apiKey: this._values.anthropicApiKey, models: [] };
      }
      if (this._dirtyFields.has('googleApiKey')) {
        updates.models.providers.google = { apiKey: this._values.googleApiKey, models: [] };
      }
      if (this._dirtyFields.has('qwenApiKey')) {
        updates.models.providers.qwen = { apiKey: this._values.qwenApiKey, models: [] };
      }
      if (this._dirtyFields.has('kimiApiKey')) {
        updates.models.providers.kimi = { apiKey: this._values.kimiApiKey, models: [] };
      }
      if (this._dirtyFields.has('minimaxApiKey')) {
        updates.models.providers.minimax = { apiKey: this._values.minimaxApiKey, models: [] };
      }
      if (this._dirtyFields.has('deepseekApiKey')) {
        updates.models.providers.deepseek = { apiKey: this._values.deepseekApiKey, models: [] };
      }
      if (this._dirtyFields.has('openrouterApiKey')) {
        updates.models.providers.openrouter = { apiKey: this._values.openrouterApiKey, models: [] };
      }
    }

    // Update providers with models (new structure)
    const dirtyProviderModels = Array.from(this._dirtyFields).filter(f => f.startsWith('providers.'));
    const isProvidersDirty = this._dirtyFields.has('providers');
    
    if (dirtyProviderModels.length > 0 || isProvidersDirty) {
      if (!updates.models) {
        updates.models = { mode: 'merge', providers: {} };
      }
      
      // If providers were modified (e.g., deleted), sync all providers
      if (isProvidersDirty) {
        for (const provider of this._providers) {
          updates.models.providers[provider.id] = {
            baseUrl: provider.baseUrl,
            api: provider.api,
            apiKey: provider.apiKey,
            models: provider.models.map(m => ({
              id: m.id,
              name: m.name,
              reasoning: m.capabilities.reasoning,
              input: [
                ...(m.capabilities.text ? ['text'] : []),
                ...(m.capabilities.image ? ['image'] : []),
              ],
              contextWindow: m.contextWindow,
              maxTokens: m.maxTokens,
              cost: m.cost || { input: 0, output: 0 },
            })),
          };
        }
      } else {
        // Only update specific providers
        for (const field of dirtyProviderModels) {
          const match = field.match(/providers\.([^\.]+)\.(.*)/);
          if (match) {
            const providerId = match[1];
            const provider = this._providers.find(p => p.id === providerId);
            if (provider) {
              updates.models.providers[providerId] = {
                baseUrl: provider.baseUrl,
                api: provider.api,
                apiKey: provider.apiKey,
                models: provider.models.map(m => ({
                  id: m.id,
                  name: m.name,
                  reasoning: m.capabilities.reasoning,
                  input: [
                    ...(m.capabilities.text ? ['text'] : []),
                    ...(m.capabilities.image ? ['image'] : []),
                  ],
                  contextWindow: m.contextWindow,
                  maxTokens: m.maxTokens,
                  cost: m.cost || { input: 0, output: 0 },
                })),
              };
            }
          }
        }
      }
    }

    // Update channels
    if (this._dirtyFields.has('telegramEnabled') || this._dirtyFields.has('whatsappEnabled') ||
        this._dirtyFields.has('telegramToken') || this._dirtyFields.has('telegramApiRoot') ||
        this._dirtyFields.has('telegramDebug') || this._dirtyFields.has('telegramAllowFrom') ||
        this._dirtyFields.has('whatsappBridgeUrl') || this._dirtyFields.has('whatsappAllowFrom')) {
      updates.channels = {};
      
      // Telegram
      if (this._dirtyFields.has('telegramEnabled') || this._dirtyFields.has('telegramToken') ||
        this._dirtyFields.has('telegramApiRoot') || this._dirtyFields.has('telegramDebug') ||
        this._dirtyFields.has('telegramAllowFrom')) {
        updates.channels = { ...updates.channels, telegram: {} };
        if (this._dirtyFields.has('telegramEnabled')) {
          updates.channels.telegram.enabled = Boolean(this._values.telegramEnabled);
        }
        if (this._dirtyFields.has('telegramToken')) {
          updates.channels.telegram.token = this._values.telegramToken;
        }
        if (this._dirtyFields.has('telegramApiRoot')) {
          updates.channels.telegram.apiRoot = this._values.telegramApiRoot || undefined;
        }
        if (this._dirtyFields.has('telegramDebug')) {
          updates.channels.telegram.debug = Boolean(this._values.telegramDebug);
        }
        if (this._dirtyFields.has('telegramAllowFrom')) {
          updates.channels.telegram.allowFrom = this._values.telegramAllowFrom
            ? this._values.telegramAllowFrom.split(',').map((s: string) => s.trim()).filter((s: string) => s)
            : [];
        }
      }

      // WhatsApp
      if (this._dirtyFields.has('whatsappEnabled') || this._dirtyFields.has('whatsappBridgeUrl') ||
        this._dirtyFields.has('whatsappAllowFrom')) {
        updates.channels = { ...updates.channels, whatsapp: {} };
        if (this._dirtyFields.has('whatsappEnabled')) {
          updates.channels.whatsapp.enabled = Boolean(this._values.whatsappEnabled);
        }
        if (this._dirtyFields.has('whatsappBridgeUrl')) {
          updates.channels.whatsapp.bridgeUrl = this._values.whatsappBridgeUrl;
        }
        if (this._dirtyFields.has('whatsappAllowFrom')) {
          updates.channels.whatsapp.allowFrom = this._values.whatsappAllowFrom
            ? this._values.whatsappAllowFrom.split(',').map((s: string) => s.trim()).filter((s: string) => s)
            : [];
        }
      }
    }

    if (this._dirtyFields.has('heartbeatEnabled') || this._dirtyFields.has('heartbeatIntervalMs')) {
      updates.gateway = { heartbeat: {} };
      if (this._dirtyFields.has('heartbeatEnabled')) {
        updates.gateway.heartbeat.enabled = Boolean(this._values.heartbeatEnabled);
      }
      if (this._dirtyFields.has('heartbeatIntervalMs')) {
        updates.gateway.heartbeat.intervalMs = Number(this._values.heartbeatIntervalMs);
      }
    }

    try {
      const response = await fetch(`${url}/api/config`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save settings');
      }

      this._dirtyFields.clear();
      
      // Save gateway token to localStorage (not to server config)
      if (this._dirtyFields.has('gatewayToken')) {
        this._saveUiSettings(this._values.gatewayToken || '');
      }
      
      this._saveSuccess = true;
      setTimeout(() => { this._saveSuccess = false; }, 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
      alert(err instanceof Error ? err.message : t('settings.failedToSaveSettings'));
    } finally {
      this._saving = false;
    }
  }

  private _handleInput(key: string, value: any): void {
    this._values = { ...this._values, [key]: value };
    this._dirtyFields.add(key);
    this.requestUpdate();
  }

  override render(): unknown {
    return html`
      <div class="settings-page">
        <div class="settings-sidebar">
          <div class="sidebar-header">
            <h3>${t('settings.title')}</h3>
          </div>
          <nav class="sidebar-nav">
            ${this._sections.map(section => html`
              <button
                class="nav-item ${this._activeSection === section.id ? 'active' : ''}"
                @click=${() => this._activeSection = section.id}
              >
                ${getIcon(section.icon)}
                <span>${section.title}</span>
              </button>
            `)}
          </nav>
        </div>

        <div class="settings-main">
          ${this._loading ? html`
            <div class="loading-state">
              <div class="spinner"></div>
              <p>${t('settings.loading')}</p>
            </div>
          ` : this._renderSection()}
        </div>

        <!-- Save button floating -->
        ${this._dirtyFields.size > 0 ? html`
          <div class="floating-save">
            <span class="dirty-count">${t('settings.unsaved', { count: this._dirtyFields.size })}</span>
            <button 
              class="btn btn-primary"
              ?disabled=${this._saving || this._errors.size > 0}
              @click=${this._saveSettings}
            >
              ${this._saving ? html`
                <span class="spinner-sm"></span>
                ${t('settings.saving')}
              ` : html`
                <span>${getIcon('save')}</span>
                ${t('settings.saveChanges')}
              `}
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  private _renderSection(): unknown {
    const section = this._sections.find(s => s.id === this._activeSection);
    if (!section) return html`<div>${t('settings.noSection')}</div>`;

    const descKey = `settings.descriptions.${section.id}` as const;

    return html`
      <div class="section-content">
        <div class="section-header">
          <h2>${section.title}</h2>
          <p class="section-desc">${t(descKey)}</p>
        </div>

        ${section.id === 'gateway' ? this._renderGatewaySection() : ''}
        ${section.id === 'providers' ? this._renderProvidersSection() : ''}

        <div class="fields-grid">
          ${section.id !== 'providers' ? section.fields.map(field => this._renderField(field)) : ''}
        </div>
      </div>
    `;
  }

  private _renderGatewaySection(): unknown {
    const tokenPreview = this._serverToken 
      ? `${this._serverToken.slice(0, 8)}...${this._serverToken.slice(-8)}`
      : 'Not available';
    
    return html`
      <div class="gateway-token-section" style="margin-bottom: 24px; padding: 16px; background: var(--muted); border-radius: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <h4 style="margin: 0; font-size: 14px; font-weight: 600;">${t('settings.serverAuthToken')}</h4>
          <button
            class="btn btn-sm btn-secondary"
            ?disabled=${this._refreshingToken}
            @click=${this._refreshServerToken}
            style="display: flex; align-items: center; gap: 6px;"
          >
            ${this._refreshingToken ? html`
              <span class="spinner-sm"></span>
              ${t('settings.refreshing')}
            ` : html`
              ${getIcon('refreshCw')}
              ${t('settings.refreshToken')}
            `}
          </button>
        </div>
        
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
          <code style="flex: 1; padding: 8px 12px; background: var(--background); border-radius: 4px; font-family: monospace; font-size: 13px; word-break: break-all;">
            ${this._showToken ? this._serverToken || t('settings.notAvailable') : tokenPreview}
          </code>
          <button
            class="btn btn-icon"
            @click=${() => this._showToken = !this._showToken}
            title=${this._showToken ? t('settings.hideToken') : t('settings.showToken')}
          >
            ${this._showToken ? getIcon('eyeOff') : getIcon('eye')}
          </button>
          <button
            class="btn btn-icon"
            ?disabled=${!this._serverToken}
            @click=${() => {
              if (this._serverToken) {
                navigator.clipboard.writeText(this._serverToken);
                alert(t('settings.tokenCopied'));
              }
            }}
            title=${t('settings.copyToken')}
          >
            ${getIcon('copy')}
          </button>
        </div>
        
        <p style="margin: 0; font-size: 12px; color: var(--muted-foreground);">
          ${t('settings.tokenDescription')}
        </p>
      </div>
    `;
  }

  private _renderProvidersSection(): unknown {
    return html`
      <div class="providers-section">
        ${this._providers.map(provider => html`
          <div class="provider-card">
            <div 
              class="provider-header"
              @click=${() => this._toggleProvider(provider.id)}
            >
              <div class="provider-title">
                <span class="provider-icon">${getIcon('cloud')}</span>
                <span class="provider-name">${provider.id}</span>
                <span class="provider-model-count">${provider.models.length} models</span>
              </div>
              <div class="provider-actions">
                <button
                  class="btn btn-sm btn-ghost"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this._editingProvider = { ...provider };
                  }}
                >
                  ${getIcon('settings')}
                </button>
                <button
                  class="btn btn-sm btn-ghost btn-danger"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this._deleteProvider(provider.id);
                  }}
                >
                  ${getIcon('trash')}
                </button>
                <span class="expand-icon ${this._expandedProviders.has(provider.id) ? 'expanded' : ''}">
                  ${getIcon('chevronRight')}
                </span>
              </div>
            </div>
            
            ${this._expandedProviders.has(provider.id) ? html`
              <div class="provider-body">
                <!-- API Configuration -->
                <div class="provider-config">
                  <div class="field-group">
                    <label class="field-label">${t('settings.baseUrl')}</label>
                    <input
                      type="text"
                      class="text-input"
                      .value=${provider.baseUrl}
                      @change=${(e: Event) => {
                        const target = e.target as HTMLInputElement;
                        provider.baseUrl = target.value;
                        this._dirtyFields.add(`providers.${provider.id}.baseUrl`);
                      }}
                    />
                  </div>
                  <div class="field-group">
                    <label class="field-label">${t('settings.apiKey')}</label>
                    <div class="input-wrapper">
                      <input
                        type="password"
                        class="text-input"
                        .value=${provider.apiKey}
                        placeholder="sk-..."
                        @change=${(e: Event) => {
                          const target = e.target as HTMLInputElement;
                          provider.apiKey = target.value;
                          this._dirtyFields.add(`providers.${provider.id}.apiKey`);
                        }}
                      />
                    </div>
                  </div>
                </div>

                <!-- Models List -->
                <div class="models-section">
                  <div class="models-header">
                    <h4>${t('settings.models')}</h4>
                    <button
                      class="btn btn-sm btn-primary"
                      @click=${() => {
                        this._editingModel = {
                          providerId: provider.id,
                          model: {
                            id: '',
                            name: '',
                            capabilities: { text: true, image: false, reasoning: false },
                            contextWindow: 128000,
                            maxTokens: 4096,
                          },
                        };
                      }}
                    >
                      ${getIcon('plus')} ${t('settings.addModel')}
                    </button>
                  </div>
                  
                  <div class="models-list">
                    ${provider.models.map(model => html`
                      <div class="model-item">
                        <div class="model-info">
                          <span class="model-name">${model.name}</span>
                          <span class="model-id">${model.id}</span>
                          <div class="model-capabilities">
                            ${model.capabilities.text ? html`<span class="capability-tag">Text</span>` : ''}
                            ${model.capabilities.image ? html`<span class="capability-tag image">Image</span>` : ''}
                            ${model.capabilities.reasoning ? html`<span class="capability-tag reasoning">Reasoning</span>` : ''}
                          </div>
                        </div>
                        <div class="model-actions">
                          <button
                            class="btn btn-icon btn-sm"
                            @click=${() => {
                              this._editingModel = { providerId: provider.id, model: { ...model } };
                            }}
                          >
                            ${getIcon('edit')}
                          </button>
                          <button
                            class="btn btn-icon btn-sm btn-danger"
                            @click=${() => this._deleteModel(provider.id, model.id)}
                          >
                            ${getIcon('trash')}
                          </button>
                        </div>
                      </div>
                    `)}
                  </div>
                </div>
              </div>
            ` : ''}
          </div>
        `)}
        
        <!-- Add Provider Button -->
        <button
          class="btn btn-outline btn-full"
          @click=${() => this._showAddProviderModal = true}
        >
          ${getIcon('plus')} ${t('settings.addProvider')}
        </button>

        <!-- Model Edit Modal -->
        ${this._editingModel ? this._renderModelModal() : ''}
        
        <!-- Add Provider Modal -->
        ${this._showAddProviderModal ? this._renderAddProviderModal() : ''}
      </div>
    `;
  }

  private _renderModelModal(): unknown {
    const { providerId, model } = this._editingModel!;
    const isNew = !model.id;

    const updateModel = (updates: Partial<ModelConfig>) => {
      this._editingModel = {
        providerId,
        model: { ...model, ...updates }
      };
    };

    const updateCapabilities = (updates: Partial<ModelConfig['capabilities']>) => {
      this._editingModel = {
        providerId,
        model: {
          ...model,
          capabilities: { ...model.capabilities, ...updates }
        }
      };
    };

    return html`
      <div class="modal-overlay" @click=${() => this._editingModel = null}>
        <div class="modal-content" @click=${(e: Event) => e.stopPropagation()}>
          <div class="modal-header">
            <h3>${isNew ? t('settings.addModel') : t('settings.editModel')}</h3>
            <button class="btn btn-icon" @click=${() => this._editingModel = null}>
              ${getIcon('x')}
            </button>
          </div>
          
          <div class="modal-body">
            <div class="field-group">
              <label class="field-label">${t('settings.modelId')}</label>
              <input
                type="text"
                class="text-input"
                .value=${model.id}
                ?disabled=${!isNew}
                placeholder="e.g., gpt-4o"
                @change=${(e: Event) => {
                  const id = (e.target as HTMLInputElement).value;
                  // Only auto-fill name if it's empty and this is a new model
                  const shouldAutoFillName = isNew && !model.name;
                  updateModel({ 
                    id, 
                    ...(shouldAutoFillName ? { name: id } : {})
                  });
                }}
              />
            </div>
            
            <div class="field-group">
              <label class="field-label">${t('settings.displayName')}</label>
              <input
                type="text"
                class="text-input"
                .value=${model.name}
                placeholder="e.g., GPT-4o"
                @change=${(e: Event) => updateModel({ name: (e.target as HTMLInputElement).value })}
              />
            </div>
            
            <div class="field-group">
              <label class="field-label">${t('settings.capabilities')}</label>
              <div class="checkbox-group">
                <label class="checkbox-label">
                  <input
                    type="checkbox"
                    .checked=${model.capabilities.text}
                    @change=${(e: Event) => updateCapabilities({ text: (e.target as HTMLInputElement).checked })}
                  />
                  <span>${t('settings.capabilityText')}</span>
                </label>
                <label class="checkbox-label">
                  <input
                    type="checkbox"
                    .checked=${model.capabilities.image}
                    @change=${(e: Event) => updateCapabilities({ image: (e.target as HTMLInputElement).checked })}
                  />
                  <span>${t('settings.capabilityImage')}</span>
                </label>
                <label class="checkbox-label">
                  <input
                    type="checkbox"
                    .checked=${model.capabilities.reasoning}
                    @change=${(e: Event) => updateCapabilities({ reasoning: (e.target as HTMLInputElement).checked })}
                  />
                  <span>${t('settings.capabilityReasoning')}</span>
                </label>
              </div>
            </div>
            
            <div class="field-row">
              <div class="field-group">
                <label class="field-label">${t('settings.contextWindow')}</label>
                <input
                  type="number"
                  class="text-input"
                  .value=${model.contextWindow}
                  @change=${(e: Event) => updateModel({ contextWindow: Number((e.target as HTMLInputElement).value) })}
                />
              </div>
              <div class="field-group">
                <label class="field-label">${t('settings.maxTokens')}</label>
                <input
                  type="number"
                  class="text-input"
                  .value=${model.maxTokens}
                  @change=${(e: Event) => updateModel({ maxTokens: Number((e.target as HTMLInputElement).value) })}
                />
              </div>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-ghost" @click=${() => this._editingModel = null}>
              ${t('settings.cancel')}
            </button>
            <button 
              class="btn btn-primary"
              ?disabled=${!model.id || !model.name}
              @click=${() => {
                if (isNew) {
                  this._addModel(providerId, model);
                } else {
                  this._updateModel(providerId, model.id, model);
                }
                this._editingModel = null;
              }}
            >
              ${isNew ? t('settings.addModel') : t('settings.saveChanges')}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderAddProviderModal(): unknown {
    if (this._showTemplateSelection) {
      return this._renderTemplateSelectionModal();
    }

    if (this._selectedTemplate?.authType === 'oauth') {
      return this._renderOAuthProviderModal();
    }

    return this._renderApiKeyProviderModal();
  }

  private _renderTemplateSelectionModal(): unknown {
    // Use dynamic providers from backend, and pre-loaded static templates
    const dynamicApiKeyProviders = this._dynamicProviders
      .filter(p => p.authType === 'api_key')
      .map(toProviderTemplate);
    const dynamicOauthProviders = this._dynamicProviders
      .filter(p => p.authType === 'oauth')
      .map(toProviderTemplate);
    const staticApiKeyTemplates = this._staticTemplates.filter(t => t.authType === 'api_key');
    const staticOauthTemplates = this._staticTemplates.filter(t => t.authType === 'oauth');

    // Show loading state if dynamic providers are being loaded
    if (this._loadingDynamicProviders) {
      return html`
        <div class="modal-overlay" @click=${() => this._showAddProviderModal = false}>
          <div class="modal-content modal-lg" @click=${(e: Event) => e.stopPropagation()}>
            <div class="modal-header">
              <h3>${t('settings.addProvider') || 'Add Provider'}</h3>
              <button class="btn btn-icon" @click=${() => this._showAddProviderModal = false}>
                ${getIcon('x')}
              </button>
            </div>
            <div class="modal-body" style="display: flex; align-items: center; justify-content: center; min-height: 200px;">
              <div style="text-align: center;">
                <div class="spinner"></div>
                <p style="margin-top: 12px; color: var(--muted-foreground);">Loading providers...</p>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    return html`
      <div class="modal-overlay" @click=${() => this._showAddProviderModal = false}>
        <div class="modal-content modal-lg" @click=${(e: Event) => e.stopPropagation()}>
          <div class="modal-header">
            <h3>${t('settings.addProvider') || 'Add Provider'}</h3>
            <button class="btn btn-icon" @click=${() => this._showAddProviderModal = false}>
              ${getIcon('x')}
            </button>
          </div>
          
          <div class="modal-body">
            <p class="modal-description">${t('settings.selectProviderTemplate') || 'Select a provider to quickly configure with pre-filled settings'}</p>
            
            ${dynamicApiKeyProviders.length > 0 ? html`
              <div class="template-section">
                <h4 class="template-section-title">
                  <span class="template-icon">${getIcon('cloud')}</span>
                  ${t('settings.availableProviders') || 'Available Providers'}
                  <span style="font-weight: normal; font-size: 12px; color: var(--muted-foreground);">(from backend)</span>
                </h4>
                <div class="template-grid">
                  ${dynamicApiKeyProviders.map(template => html`
                    <button
                      class="template-card"
                      @click=${() => this._selectTemplate(template)}
                    >
                      <div class="template-card-header">
                        <span class="template-card-name">${template.name}</span>
                        <span class="template-card-badge api-key">API Key</span>
                      </div>
                      <div class="template-card-models">
                        ${template.models.slice(0, 3).map(m => html`
                          <span class="template-model-tag">${m.name}</span>
                        `)}
                        ${template.models.length > 3 ? html`
                          <span class="template-model-tag more">+${template.models.length - 3}</span>
                        ` : ''}
                      </div>
                    </button>
                  `)}
                </div>
              </div>
            ` : ''}

            ${dynamicOauthProviders.length > 0 ? html`
              <div class="template-section">
                <h4 class="template-section-title">
                  <span class="template-icon">${getIcon('cloud')}</span>
                  ${t('settings.oauthProviders') || 'OAuth Providers'}
                  <span style="font-weight: normal; font-size: 12px; color: var(--muted-foreground);">(from backend)</span>
                </h4>
                <div class="template-grid">
                  ${dynamicOauthProviders.map(template => html`
                    <button
                      class="template-card"
                      @click=${() => this._selectTemplate(template)}
                    >
                      <div class="template-card-header">
                        <span class="template-card-name">${template.name}</span>
                        <span class="template-card-badge oauth">OAuth</span>
                      </div>
                      <div class="template-card-models">
                        ${template.models.slice(0, 3).map(m => html`
                          <span class="template-model-tag">${m.name}</span>
                        `)}
                        ${template.models.length > 3 ? html`
                          <span class="template-model-tag more">+${template.models.length - 3}</span>
                        ` : ''}
                      </div>
                    </button>
                  `)}
                </div>
              </div>
            ` : ''}
            
            ${staticApiKeyTemplates.length > 0 ? html`
              <div class="template-section">
                <h4 class="template-section-title">
                  <span class="template-icon">${getIcon('key')}</span>
                  ${t('settings.apiKeyProviders') || 'API Key Providers'}
                </h4>
                <div class="template-grid">
                  ${staticApiKeyTemplates.map(template => html`
                    <button
                      class="template-card"
                      @click=${() => this._selectTemplate(template)}
                    >
                      <div class="template-card-header">
                        <span class="template-card-name">${template.name}</span>
                        <span class="template-card-badge api-key">${t('settings.apiKeyBadge')}</span>
                      </div>
                      <div class="template-card-models">
                        ${template.models.slice(0, 3).map(m => html`
                          <span class="template-model-tag">${m.name}</span>
                        `)}
                        ${template.models.length > 3 ? html`
                          <span class="template-model-tag more">+${template.models.length - 3}</span>
                        ` : ''}
                      </div>
                    </button>
                  `)}
                </div>
              </div>
            ` : ''}
            
            ${staticOauthTemplates.length > 0 ? html`
              <div class="template-section">
                <h4 class="template-section-title">
                  <span class="template-icon">${getIcon('lock')}</span>
                  ${t('settings.oauthProviders') || 'OAuth Providers'}
                </h4>
                <div class="template-grid">
                  ${staticOauthTemplates.map(template => html`
                    <button
                      class="template-card"
                      @click=${() => this._selectTemplate(template)}
                    >
                      <div class="template-card-header">
                        <span class="template-card-name">${template.name}</span>
                        <span class="template-card-badge oauth">${t('settings.oauthBadge')}</span>
                      </div>
                      <div class="template-card-models">
                        ${template.models.slice(0, 3).map(m => html`
                          <span class="template-model-tag">${m.name}</span>
                        `)}
                        ${template.models.length > 3 ? html`
                          <span class="template-model-tag more">+${template.models.length - 3}</span>
                        ` : ''}
                      </div>
                    </button>
                  `)}
                </div>
              </div>
            ` : ''}
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-ghost" @click=${() => this._showAddProviderModal = false}>
              ${t('settings.cancel') || 'Cancel'}
            </button>
            <button 
              class="btn btn-secondary"
              @click=${() => {
                this._showTemplateSelection = false;
                this._selectedTemplate = null;
              }}
            >
              ${t('settings.customProvider') || 'Custom Provider'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderApiKeyProviderModal(): unknown {
    const template = this._selectedTemplate;
    const isCustom = !template || template.id === 'custom';

    return html`
      <div class="modal-overlay" @click=${() => this._closeAddProviderModal()}>
        <div class="modal-content" @click=${(e: Event) => e.stopPropagation()}>
          <div class="modal-header">
            <h3>${isCustom ? t('settings.customProvider') : `${t('settings.addProvider')} ${template?.name}`}</h3>
            <button class="btn btn-icon" @click=${() => this._closeAddProviderModal()}>
              ${getIcon('x')}
            </button>
          </div>
          
          <div class="modal-body">
            ${template ? html`
              <div class="template-info">
                <p class="template-info-text">
                  <span class="template-info-label">${t('settings.baseUrl')}:</span>
                  <code>${template.baseUrl}</code>
                </p>
                <p class="template-info-text">
                  <span class="template-info-label">${t('settings.apiType')}:</span>
                  <span>${template.api}</span>
                </p>
              </div>
            ` : ''}

            ${isCustom ? html`
              <div class="field-group">
                <label class="field-label">${t('settings.providerId')}</label>
                <input
                  type="text"
                  class="text-input"
                  .value=${this._newProvider.id}
                  placeholder="e.g., my-provider"
                  @change=${(e: Event) => {
                    this._newProvider = { ...this._newProvider, id: (e.target as HTMLInputElement).value };
                  }}
                />
              </div>

              <div class="field-group">
                <label class="field-label">${t('settings.baseUrl')}</label>
                <input
                  type="text"
                  class="text-input"
                  .value=${this._newProvider.baseUrl}
                  placeholder="https://api.example.com/v1"
                  @change=${(e: Event) => {
                    this._newProvider = { ...this._newProvider, baseUrl: (e.target as HTMLInputElement).value };
                  }}
                />
              </div>

              <div class="field-group">
                <label class="field-label">${t('settings.apiType')}</label>
                <select
                  class="select-input"
                  .value=${this._newProvider.api}
                  @change=${(e: Event) => {
                    this._newProvider = { ...this._newProvider, api: (e.target as HTMLSelectElement).value };
                  }}
                >
                  <option value="openai-completions">OpenAI Completions</option>
                  <option value="openai-responses">OpenAI Responses</option>
                  <option value="anthropic-messages">Anthropic Messages</option>
                  <option value="google-generative-ai">Google Generative AI</option>
                  <option value="ollama">Ollama</option>
                </select>
              </div>
            ` : ''}
            
            <div class="field-group">
              <label class="field-label">${t('settings.apiKey')}</label>
              <input
                type="password"
                class="text-input"
                .value=${this._templateApiKey}
                placeholder=${template ? `${template.id}-...` : 'sk-...'}
                @change=${(e: Event) => this._templateApiKey = (e.target as HTMLInputElement).value}
              />
              <p class="field-help">${t('settings.apiKeyHelp') || 'Your API key will be stored securely in the configuration'}</p>
            </div>

            ${template && template.models.length > 0 ? html`
              <div class="field-group">
                <label class="field-label">${t('settings.modelsToInclude')}</label>
                <div class="checkbox-group-vertical">
                  ${template.models.map((model, index) => html`
                    <label class="checkbox-label">
                      <input
                        type="checkbox"
                        .checked=${true}
                        @change=${(e: Event) => this._toggleTemplateModel(index, (e.target as HTMLInputElement).checked)}
                      />
                      <span>${model.name}</span>
                    </label>
                  `)}
                </div>
              </div>
            ` : ''}
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-ghost" @click=${() => this._backToTemplateSelection()}>
              ${t('settings.back') || 'Back'}
            </button>
            <button 
              class="btn btn-primary"
              ?disabled=${isCustom ? !this._newProvider.id || !this._newProvider.baseUrl : !this._templateApiKey}
              @click=${() => this._addProviderFromTemplate()}
            >
              ${t('settings.addProvider') || 'Add Provider'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderOAuthProviderModal(): unknown {
    const template = this._selectedTemplate!;

    return html`
      <div class="modal-overlay" @click=${() => this._closeAddProviderModal()}>
        <div class="modal-content" @click=${(e: Event) => e.stopPropagation()}>
          <div class="modal-header">
            <h3>${t('settings.addProvider')} ${template.name}</h3>
            <button class="btn btn-icon" @click=${() => this._closeAddProviderModal()}>
              ${getIcon('x')}
            </button>
          </div>
          
          <div class="modal-body">
            <div class="oauth-setup">
              <div class="oauth-info">
                <p class="template-info-text">
                  <span class="template-info-label">${t('settings.baseUrl')}:</span>
                  <code>${template.baseUrl}</code>
                </p>
                <p class="template-info-text">
                  <span class="template-info-label">${t('settings.authentication')}:</span>
                  <span>${t('settings.oauth')}</span>
                </p>
              </div>

              <div class="oauth-login-section">
                <p class="oauth-description">
                  ${t('settings.oauthDescription', { provider: template.name })}
                </p>
                
                <button class="btn btn-primary btn-oauth" @click=${() => this._startOAuthLogin(template)}>
                  <span class="oauth-icon">${getIcon('lock')}</span>
                  ${t('settings.loginWithProvider', { provider: template.name })}
                </button>
              </div>

              ${template.models.length > 0 ? html`
                <div class="field-group">
                  <label class="field-label">${t('settings.modelsToInclude')}</label>
                  <div class="checkbox-group-vertical">
                    ${template.models.map((model, index) => html`
                      <label class="checkbox-label">
                        <input
                          type="checkbox"
                          .checked=${true}
                          @change=${(e: Event) => this._toggleTemplateModel(index, (e.target as HTMLInputElement).checked)}
                        />
                        <span>${model.name}</span>
                      </label>
                    `)}
                  </div>
                </div>
              ` : ''}
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-ghost" @click=${() => this._backToTemplateSelection()}>
              ${t('settings.back') || 'Back'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _selectTemplate(template: ProviderTemplate): void {
    this._selectedTemplate = template;
    this._showTemplateSelection = false;
    
    // Pre-fill custom provider fields if using custom template
    if (template.id === 'custom' || template.id === 'ollama') {
      this._newProvider = {
        id: '',
        baseUrl: template.baseUrl,
        api: template.api,
        apiKey: '',
        models: [],
      };
    }
  }

  private _backToTemplateSelection(): void {
    this._showTemplateSelection = true;
    this._selectedTemplate = null;
    this._templateApiKey = '';
    this._newProvider = { id: '', baseUrl: '', api: 'openai-completions', apiKey: '', models: [] };
  }

  private _closeAddProviderModal(): void {
    this._showAddProviderModal = false;
    this._showTemplateSelection = true;
    this._selectedTemplate = null;
    this._templateApiKey = '';
    this._newProvider = { id: '', baseUrl: '', api: 'openai-completions', apiKey: '', models: [] };
  }

  private _toggleTemplateModel(index: number, checked: boolean): void {
    if (!this._selectedTemplate) return;
    
    // Create a copy of the template with toggled model
    const updatedModels = [...this._selectedTemplate.models];
    // We don't actually remove the model, just mark it for exclusion
    // This will be handled when creating the provider
  }

  private _addProviderFromTemplate(): void {
    if (!this._selectedTemplate) return;

    const template = this._selectedTemplate;
    const providerId = template.id === 'custom' ? this._newProvider.id : template.id;
    const baseUrl = template.id === 'custom' ? this._newProvider.baseUrl : template.baseUrl;
    const api = template.id === 'custom' ? this._newProvider.api : template.api;

    if (!providerId || !baseUrl) return;

    const newProvider: ProviderConfig = {
      id: providerId,
      baseUrl,
      api,
      apiKey: this._templateApiKey,
      models: template.models.length > 0 ? template.models : [],
    };

    this._addProvider(newProvider);
    this._closeAddProviderModal();
  }

  private async _startOAuthLogin(template: ProviderTemplate): Promise<void> {
    // TODO: Implement OAuth flow
    // This would typically:
    // 1. Call backend to start OAuth flow
    // 2. Open a popup or redirect to OAuth provider
    // 3. Wait for callback
    // 4. Get API key/token from backend
    // 5. Create provider with the token
    
    alert(`OAuth login for ${template.name} will be implemented in Phase 2`);
  }

  private _renderField(field: SettingsField): unknown {
    const value = this._values[field.key];
    const error = this._errors.get(field.key);

    return html`
      <div class="field-group ${error ? 'has-error' : ''}">
        <div class="field-header">
          <label class="field-label">${field.label}</label>
          ${field.validation?.required ? html`<span class="required-mark">*</span>` : ''}
        </div>
        
        ${field.description ? html`<p class="field-desc">${field.description}</p>` : ''}

        ${field.type === 'boolean' ? this._renderBooleanField(field, value) : ''}
        ${field.type === 'select' ? this._renderSelectField(field, value) : ''}
        ${['text', 'password', 'number'].includes(field.type) ? this._renderInputField(field, value) : ''}

        ${error ? html`
          <div class="field-error">
            <span>${error}</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  private _renderInputField(field: SettingsField, value: any): unknown {
    return html`
      <input
        type=${field.type === 'number' ? 'number' : 'text'}
        class="text-input"
        .value=${String(value ?? '')}
        placeholder=${field.placeholder || ''}
        minlength=${field.validation?.min}
        maxlength=${field.validation?.max}
        min=${field.validation?.min}
        max=${field.validation?.max}
        @input=${(e: Event) => this._handleInput(field.key, (e.target as HTMLInputElement).value)}
      />
    `;
  }

  private _renderSelectField(field: SettingsField, value: any): unknown {
    // Check if this select field has search enabled
    const hasSearch = field.searchQuery !== undefined && field.onSearchChange;
    
    // Check if options have groups (contain disabled options with group markers)
    const hasGroups = field.options?.some(opt => opt.group === undefined && opt.label.startsWith('──'));

    if (hasSearch) {
      return html`
        <div class="select-with-search">
          <input
            type="text"
            class="text-input search-input"
            .value=${field.searchQuery || ''}
            placeholder="Search models..."
            @input=${(e: Event) => field.onSearchChange?.((e.target as HTMLInputElement).value)}
          />
          <select
            class="select-input"
            .value=${String(value ?? '')}
            @change=${(e: Event) => this._handleInput(field.key, (e.target as HTMLSelectElement).value)}
            size=${Math.min(field.options?.length || 10, 15)}
          >
            ${field.options?.map(opt => html`
              <option 
                value=${opt.value} 
                ?selected=${value === opt.value}
                ?disabled=${!opt.value && opt.label.startsWith('──')}
                class=${opt.group ? 'group-header' : ''}
              >
                ${opt.label}
              </option>
            `)}
          </select>
        </div>
      `;
    }

    return html`
      <select
        class="select-input"
        .value=${String(value ?? '')}
        @change=${(e: Event) => this._handleInput(field.key, (e.target as HTMLSelectElement).value)}
      >
        ${field.options?.map(opt => html`
          <option value=${opt.value} ?selected=${value === opt.value}>${opt.label}</option>
        `)}
      </select>
    `;
  }

  private _renderBooleanField(field: SettingsField, value: any): unknown {
    return html`
      <label class="toggle-label">
        <input
          type="checkbox"
          class="toggle-input"
          .checked=${Boolean(value)}
          @change=${(e: Event) => this._handleInput(field.key, (e.target as HTMLInputElement).checked)}
        />
        <span class="toggle-switch"></span>
        <span class="toggle-text">${field.description || t('settings.enableFeature')}</span>
      </label>
    `;
  }
}
