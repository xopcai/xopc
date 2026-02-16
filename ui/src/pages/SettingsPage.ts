// Settings Page Component

import { html, LitElement } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { 
  User, Bot, Plug, Globe, Search, Clock, Puzzle, 
  X, Save, ChevronRight, Check, AlertCircle,
  Settings, Eye, EyeOff, Loader2, RefreshCw
} from 'lucide';
import { getIcon } from '../utils/icons';

export interface SettingsPageConfig {
  url: string;
  token?: string;
}

// Built-in models catalog
const BUILTIN_MODELS = [
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
  { id: 'openai/gpt-4.1', name: 'GPT-4.1', provider: 'openai' },
  { id: 'openai/o1', name: 'o1', provider: 'openai' },
  { id: 'openai/o3', name: 'o3', provider: 'openai' },
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'anthropic/claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'anthropic' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google' },
  { id: 'qwen/qwen-plus', name: 'Qwen Plus', provider: 'qwen' },
  { id: 'qwen/qwen-max', name: 'Qwen Max', provider: 'qwen' },
  { id: 'qwen/qwen3-235b', name: 'Qwen3 235B', provider: 'qwen' },
  { id: 'kimi/kimi-k2.5', name: 'Kimi K2.5', provider: 'kimi' },
  { id: 'kimi/kimi-k2-thinking', name: 'Kimi K2 Thinking', provider: 'kimi' },
  { id: 'minimax/minimax-m2.1', name: 'MiniMax M2.1', provider: 'minimax' },
  { id: 'minimax/minimax-m2', name: 'MiniMax M2', provider: 'minimax' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
  { id: 'deepseek/deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek' },
  { id: 'groq/llama-3.3-70b', name: 'Llama 3.3 70B', provider: 'groq' },
  { id: 'openrouter/openai/gpt-4o', name: 'GPT-4o (OpenRouter)', provider: 'openrouter' },
];

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
  options?: Array<{ value: string; label: string }>;
  validation?: {
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: string;
  };
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
  @state() private _dirtyFields: Set<string> = new Set();
  @state() private _errors: Map<string, string> = new Map();
  @state() private _saveSuccess = false;

  @state() private _values: SettingsValue = {
    model: 'anthropic/claude-sonnet-4-5',
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
    heartbeatEnabled: true,
    heartbeatIntervalMs: 60000,
    // Providers
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
    if (!this.config?.url) {
      return;
    }
    
    // Always try to load settings when config changes
    this._loadSettings();
  }

  // Settings sections definition
  private get _sections(): SettingsSection[] {
    const modelOptions = BUILTIN_MODELS.map(m => ({
      value: m.id,
      label: `${m.provider}/${m.name}`,
    }));

    return [
      {
        id: 'agent',
        title: 'Agent',
        icon: 'bot',
        fields: [
          {
            key: 'model',
            label: 'Model',
            type: 'select',
            description: 'Default AI model to use',
            options: modelOptions,
          },
          {
            key: 'workspace',
            label: 'Workspace',
            type: 'text',
            description: 'Working directory for agent files',
            placeholder: '~/.xopcbot/workspace',
          },
          {
            key: 'maxTokens',
            label: 'Max Tokens',
            type: 'number',
            description: 'Maximum tokens in response',
            validation: { min: 256, max: 128000 },
          },
          {
            key: 'temperature',
            label: 'Temperature',
            type: 'number',
            description: 'Randomness in responses (0-2)',
            validation: { min: 0, max: 2 },
          },
          {
            key: 'maxToolIterations',
            label: 'Max Tool Iterations',
            type: 'number',
            description: 'Maximum tool calls per message',
            validation: { min: 1, max: 100 },
          },
        ],
      },
      {
        id: 'providers',
        title: 'Providers',
        icon: 'cloud',
        fields: [
          {
            key: 'openaiApiKey',
            label: 'OpenAI API Key',
            type: 'password',
            description: 'API key for OpenAI models',
            placeholder: 'sk-...',
          },
          {
            key: 'anthropicApiKey',
            label: 'Anthropic API Key',
            type: 'password',
            description: 'API key for Claude models',
            placeholder: 'sk-ant-...',
          },
          {
            key: 'googleApiKey',
            label: 'Google API Key',
            type: 'password',
            description: 'API key for Gemini models',
            placeholder: 'AIzaSy...',
          },
          {
            key: 'qwenApiKey',
            label: 'Qwen API Key',
            type: 'password',
            description: 'API key for Qwen models',
            placeholder: 'sk-...',
          },
          {
            key: 'kimiApiKey',
            label: 'Kimi API Key',
            type: 'password',
            description: 'API key for Kimi models',
            placeholder: 'sk-kimi-...',
          },
          {
            key: 'minimaxApiKey',
            label: 'MiniMax API Key',
            type: 'password',
            description: 'API key for MiniMax models',
            placeholder: 'sk-cp-...',
          },
          {
            key: 'deepseekApiKey',
            label: 'DeepSeek API Key',
            type: 'password',
            description: 'API key for DeepSeek models',
            placeholder: 'sk-...',
          },
          {
            key: 'openrouterApiKey',
            label: 'OpenRouter API Key',
            type: 'password',
            description: 'API key for OpenRouter models',
            placeholder: 'sk-or-...',
          },
        ],
      },
      {
        id: 'channels',
        title: 'Channels',
        icon: 'plug',
        fields: [
          // Telegram section
          {
            key: 'telegramEnabled',
            label: 'Telegram',
            type: 'boolean',
            description: 'Enable Telegram bot',
          },
          ...(this._values.telegramEnabled ? [
            {
              key: 'telegramToken',
              label: 'Telegram Token',
              type: 'password',
              description: 'Bot API token from @BotFather',
              placeholder: '1234567890:ABCdefGHIjklMNOpqrsTUVwxyz',
            },
            {
              key: 'telegramApiRoot',
              label: 'API Root (Optional)',
              type: 'text',
              description: 'Custom Telegram API root URL',
              placeholder: 'https://api.telegram.org',
            },
            {
              key: 'telegramAllowFrom',
              label: 'Allow From (Optional)',
              type: 'text',
              description: 'Allowed user IDs, comma separated',
              placeholder: '123456789, 987654321',
            },
            {
              key: 'telegramDebug',
              label: 'Debug Mode',
              type: 'boolean',
              description: 'Enable debug logging for Telegram',
            },
          ] : []),
          // WhatsApp section
          {
            key: 'whatsappEnabled',
            label: 'WhatsApp',
            type: 'boolean',
            description: 'Enable WhatsApp bridge',
          },
          ...(this._values.whatsappEnabled ? [
            {
              key: 'whatsappBridgeUrl',
              label: 'Bridge URL',
              type: 'text',
              description: 'WhatsApp bridge WebSocket URL',
              placeholder: 'ws://localhost:3001',
            },
            {
              key: 'whatsappAllowFrom',
              label: 'Allow From (Optional)',
              type: 'text',
              description: 'Allowed phone numbers, comma separated',
              placeholder: '+1234567890, +0987654321',
            },
          ] : []),
        ],
      },
      {
        id: 'gateway',
        title: 'Gateway',
        icon: 'globe',
        fields: [
          {
            key: 'heartbeatEnabled',
            label: 'Heartbeat',
            type: 'boolean',
            description: 'Enable heartbeat monitoring',
          },
          {
            key: 'heartbeatIntervalMs',
            label: 'Heartbeat Interval (ms)',
            type: 'number',
            description: 'Heartbeat check interval in milliseconds',
            validation: { min: 1000, max: 600000 },
          },
        ],
      },
    ];
  }

  private async _loadSettings(): Promise<void> {
    if (!this.config?.url) return;

    this._loading = true;
    const { url, token } = this.config;

    try {
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
            // Providers
            openaiApiKey: config.providers?.openai?.apiKey || '',
            anthropicApiKey: config.providers?.anthropic?.apiKey || '',
            googleApiKey: config.providers?.google?.apiKey || '',
            qwenApiKey: config.providers?.qwen?.apiKey || '',
            kimiApiKey: config.providers?.kimi?.apiKey || '',
            minimaxApiKey: config.providers?.minimax?.apiKey || '',
            deepseekApiKey: config.providers?.deepseek?.apiKey || '',
            openrouterApiKey: config.providers?.openrouter?.apiKey || '',
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
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      this._loading = false;
    }
  }

  private async _saveSettings(): Promise<void> {
    if (!this.config?.url || this._errors.size > 0) return;

    this._saving = true;
    this._saveSuccess = false;
    const { url, token } = this.config;

    // Build updates
    const updates: any = {};

    if (this._dirtyFields.has('model') || this._dirtyFields.has('maxTokens') ||
        this._dirtyFields.has('temperature') || this._dirtyFields.has('maxToolIterations') ||
        this._dirtyFields.has('workspace')) {
      updates.agents = { defaults: {} };
      if (this._dirtyFields.has('model')) {
        updates.agents.defaults.model = this._values.model;
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

    // Update providers
    const providerFields = [
      'openaiApiKey', 'anthropicApiKey', 'googleApiKey', 'qwenApiKey', 
      'kimiApiKey', 'minimaxApiKey', 'deepseekApiKey', 'openrouterApiKey'
    ];
    const dirtyProviders = providerFields.filter(f => this._dirtyFields.has(f));
    if (dirtyProviders.length > 0) {
      updates.providers = {};
      if (this._dirtyFields.has('openaiApiKey')) {
        updates.providers.openai = { apiKey: this._values.openaiApiKey };
      }
      if (this._dirtyFields.has('anthropicApiKey')) {
        updates.providers.anthropic = { apiKey: this._values.anthropicApiKey };
      }
      if (this._dirtyFields.has('googleApiKey')) {
        updates.providers.google = { apiKey: this._values.googleApiKey };
      }
      if (this._dirtyFields.has('qwenApiKey')) {
        updates.providers.qwen = { apiKey: this._values.qwenApiKey };
      }
      if (this._dirtyFields.has('kimiApiKey')) {
        updates.providers.kimi = { apiKey: this._values.kimiApiKey };
      }
      if (this._dirtyFields.has('minimaxApiKey')) {
        updates.providers.minimax = { apiKey: this._values.minimaxApiKey };
      }
      if (this._dirtyFields.has('deepseekApiKey')) {
        updates.providers.deepseek = { apiKey: this._values.deepseekApiKey };
      }
      if (this._dirtyFields.has('openrouterApiKey')) {
        updates.providers.openrouter = { apiKey: this._values.openrouterApiKey };
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
            ? this._values.telegramAllowFrom.split(',').map(s => s.trim()).filter(s => s)
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
            ? this._values.whatsappAllowFrom.split(',').map(s => s.trim()).filter(s => s)
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
      this._saveSuccess = true;
      setTimeout(() => { this._saveSuccess = false; }, 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
      alert(err instanceof Error ? err.message : 'Failed to save settings');
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
            <h3>Settings</h3>
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
              <p>Loading settings...</p>
            </div>
          ` : this._renderSection()}
        </div>

        <!-- Save button floating -->
        ${this._dirtyFields.size > 0 ? html`
          <div class="floating-save">
            <span class="dirty-count">${this._dirtyFields.size} unsaved</span>
            <button 
              class="btn btn-primary"
              ?disabled=${this._saving || this._errors.size > 0}
              @click=${this._saveSettings}
            >
              ${this._saving ? html`
                <span class="spinner-sm"></span>
                Saving...
              ` : html`
                <span>${getIcon('save')}</span>
                Save Changes
              `}
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  private _renderSection(): unknown {
    const section = this._sections.find(s => s.id === this._activeSection);
    if (!section) return html`<div>No section selected</div>`;

    return html`
      <div class="section-content">
        <div class="section-header">
          <h2>${section.title}</h2>
          <p class="section-desc">Configure your ${section.title.toLowerCase()} settings</p>
        </div>

        <div class="fields-grid">
          ${section.fields.map(field => this._renderField(field))}
        </div>
      </div>
    `;
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
        <span class="toggle-text">${field.description || 'Enable this feature'}</span>
      </label>
    `;
  }
}
