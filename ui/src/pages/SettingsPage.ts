/**
 * Settings page component (refactored) - uses ProviderList and ModelSelector.
 */

import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';
import { t } from '../utils/i18n.js';
import '../components/ProviderList.js';
import '../components/ModelSelector.js';
import { fetchConfiguredModels, fetchProviderMeta, type Model } from '../config/registry-client.js';
import type { ProviderInfo, ProviderListChangeEvent, ProviderListOAuthEvent } from '../components/ProviderList.js';
import '../components/ModelJsonEditor.js';
import type { ModelsJsonConfig } from '../config/models-json-client.js';
import { fetchModelsJson, saveModelsJson } from '../config/models-json-client.js';

export interface SettingsPageConfig {
  token?: string;
}

type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
type GroupPolicy = 'open' | 'disabled' | 'allowlist';
type StreamMode = 'off' | 'partial' | 'block';
type ReplyToMode = 'off' | 'first' | 'all';

interface TelegramAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  token: string;
  allowFrom: (string | number)[];
  groupAllowFrom?: (string | number)[];
  dmPolicy: DmPolicy;
  groupPolicy: GroupPolicy;
  replyToMode: ReplyToMode;
  apiRoot: string;
  proxy: string;
  historyLimit: number;
  textChunkLimit: number;
  streamMode: StreamMode;
}

interface TelegramConfig {
  enabled: boolean;
  token: string;
  apiRoot: string;
  debug: boolean;
  allowFrom: (string | number)[];
  groupAllowFrom: (string | number)[];
  dmPolicy: DmPolicy;
  groupPolicy: GroupPolicy;
  replyToMode: ReplyToMode;
  streamMode: StreamMode;
  historyLimit: number;
  textChunkLimit: number;
  proxy: string;
  accounts: Record<string, TelegramAccount>;
  advancedMode: boolean;
}

interface SettingsData {
  model: string;
  maxTokens: number;
  temperature: number;
  maxToolIterations: number;
  workspace: string;
  providers: Record<string, string>;
  telegram: TelegramConfig;
  whatsapp: {
    enabled: boolean;
    bridgeUrl: string;
    allowFrom: string[];
  };
  gateway: {
    heartbeat: {
      enabled: boolean;
      intervalMs: number;
    };
    auth?: {
      mode: 'none' | 'token';
      token?: string;
    };
  };
}

@customElement('settings-page')
export class SettingsPage extends LitElement {
  @property({ attribute: false }) config?: SettingsPageConfig;

  @state() private _activeSection: 'agent' | 'providers' | 'models' | 'channels' | 'gateway' = 'agent';
  @state() private _loading = false;
  @state() private _saving = false;
  @state() private _saveSuccess = false;
  @state() private _dirty = false;
  
  // Telegram token UI state
  @state() private _showTelegramToken: boolean = false;
  @state() private _copiedTelegramToken: boolean = false;
  // Gateway token UI state
  @state() private _showGatewayToken: boolean = false;
  @state() private _copiedGatewayToken: boolean = false;

  @state() private _settings: SettingsData = {
    model: '',
    maxTokens: 8192,
    temperature: 0.7,
    maxToolIterations: 20,
    workspace: '~/.xopcbot/workspace',
    providers: {},
    telegram: {
      enabled: false,
      token: '',
      apiRoot: '',
      debug: false,
      allowFrom: [],
      groupAllowFrom: [],
      dmPolicy: 'pairing',
      groupPolicy: 'open',
      replyToMode: 'off',
      streamMode: 'partial',
      historyLimit: 50,
      textChunkLimit: 4000,
      proxy: '',
      accounts: {},
      advancedMode: false,
    },
    whatsapp: {
      enabled: false,
      bridgeUrl: 'ws://localhost:3001',
      allowFrom: [],
    },
    gateway: {
      heartbeat: {
        enabled: true,
        intervalMs: 60000,
      },
      auth: {
        mode: 'token',
        token: '',
      },
    },
  };

  @state() private _providers: ProviderInfo[] = [];
  @state() private _loadingProviders = false;
  @state() private _models: Model[] = [];
  
  // Models.json state
  @state() private _modelsJsonConfig: ModelsJsonConfig = { providers: {} };
  @state() private _modelsJsonError?: string;
  @state() private _loadingModelsJson = false;

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadSettings();
    this._loadProviders();
    this._loadModelsJson();
  }

  private async _loadModelsJson() {
    this._loadingModelsJson = true;
    const token = this.config?.token;

    try {
      const { config, loadError } = await fetchModelsJson(token);
      this._modelsJsonConfig = config;
      this._modelsJsonError = loadError;
    } catch (err) {
      console.error('Failed to load models.json:', err);
      this._modelsJsonError = err instanceof Error ? err.message : 'Failed to load models.json';
    } finally {
      this._loadingModelsJson = false;
    }
  }

  private async _loadSettings() {
    this._loading = true;
    const token = this.config?.token;

    try {
      const response = await fetch(`${window.location.origin}/api/config`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (response.ok) {
        const data = await response.json();
        const config = data.payload?.config;

        if (config) {
          let modelValue = config.agents?.defaults?.model;
          if (modelValue && typeof modelValue === 'object') {
            modelValue = modelValue.primary || '';
          }

          this._settings = {
            model: modelValue || 'anthropic/claude-sonnet-4-5',
            maxTokens: config.agents?.defaults?.maxTokens || 8192,
            temperature: config.agents?.defaults?.temperature ?? 0.7,
            maxToolIterations: config.agents?.defaults?.maxToolIterations || 20,
            workspace: config.agents?.defaults?.workspace || '~/.xopcbot/workspace',
            providers: config.providers || {},
            telegram: {
              enabled: config.channels?.telegram?.enabled || false,
              token: config.channels?.telegram?.token || '',
              apiRoot: config.channels?.telegram?.apiRoot || '',
              debug: config.channels?.telegram?.debug || false,
              allowFrom: config.channels?.telegram?.allowFrom || [],
              groupAllowFrom: config.channels?.telegram?.groupAllowFrom || [],
              dmPolicy: config.channels?.telegram?.dmPolicy || 'pairing',
              groupPolicy: config.channels?.telegram?.groupPolicy || 'open',
              replyToMode: config.channels?.telegram?.replyToMode || 'off',
              streamMode: config.channels?.telegram?.streamMode || 'partial',
              historyLimit: config.channels?.telegram?.historyLimit || 50,
              textChunkLimit: config.channels?.telegram?.textChunkLimit || 4000,
              proxy: config.channels?.telegram?.proxy || '',
              accounts: config.channels?.telegram?.accounts || {},
              advancedMode: false,
            },
            whatsapp: {
              enabled: config.channels?.whatsapp?.enabled || false,
              bridgeUrl: config.channels?.whatsapp?.bridgeUrl || 'ws://localhost:3001',
              allowFrom: config.channels?.whatsapp?.allowFrom || [],
            },
            gateway: {
              heartbeat: {
                enabled: config.gateway?.heartbeat?.enabled ?? true,
                intervalMs: config.gateway?.heartbeat?.intervalMs || 60000,
              },
              auth: {
                mode: config.gateway?.auth?.mode || 'token',
                token: config.gateway?.auth?.token || '',
              },
            },
          };
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadProviders() {
    this._loadingProviders = true;
    const token = this.config?.token;

    try {
      // Load models and provider metadata in parallel
      const [models, providerMeta] = await Promise.all([
        fetchConfiguredModels(token),
        fetchProviderMeta(token),
      ]);
      
      this._models = models;

      // Use metadata from backend to build provider list
      // If provider has configured models, mark as configured
      const configuredProviders = new Set(models.map(m => m.provider));
      
      this._providers = providerMeta.map(meta => ({
        id: meta.id,
        name: meta.name,
        category: meta.category,
        supportsOAuth: meta.supportsOAuth,
        // Check if either has API key configured OR has available models
        configured: meta.configured || configuredProviders.has(meta.id),
      }));
    } catch (err) {
      console.error('Failed to load providers:', err);
    } finally {
      this._loadingProviders = false;
    }
  }

  private _updateSettings(path: string, value: unknown) {
    const keys = path.split('.');
    const newSettings = { ...this._settings };
    let current: Record<string, unknown> = newSettings;

    for (let i = 0; i < keys.length - 1; i++) {
      current[keys[i]] = { ...(current[keys[i]] as Record<string, unknown>) };
      current = current[keys[i]] as Record<string, unknown>;
    }

    current[keys[keys.length - 1]] = value;
    this._settings = newSettings as SettingsData;
    this._dirty = true;
  }

  private _onProviderChange(e: CustomEvent<ProviderListChangeEvent>) {
    const { provider, apiKey } = e.detail;
    this._updateSettings('providers', {
      ...this._settings.providers,
      [provider]: apiKey,
    });
  }

  private _onProviderOAuth(e: CustomEvent<ProviderListOAuthEvent>) {
    const { provider, success, message, error } = e.detail;
    
    if (success) {
      console.log('OAuth login successful for:', provider, message);
      // Page will reload automatically
    } else if (error) {
      console.error('OAuth login failed for:', provider, error);
      alert(`OAuth login failed: ${error}`);
    }
  }

  private _toggleTelegramTokenVisibility() {
    this._showTelegramToken = !this._showTelegramToken;
  }

  private async _copyTelegramToken() {
    if (!this._settings.telegram.token) return;
    try {
      await navigator.clipboard.writeText(this._settings.telegram.token);
      this._copiedTelegramToken = true;
      setTimeout(() => {
        this._copiedTelegramToken = false;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  private _toggleGatewayTokenVisibility() {
    this._showGatewayToken = !this._showGatewayToken;
  }

  private async _copyGatewayToken() {
    if (!this._settings.gateway.auth?.token) return;
    try {
      await navigator.clipboard.writeText(this._settings.gateway.auth.token);
      this._copiedGatewayToken = true;
      setTimeout(() => {
        this._copiedGatewayToken = false;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  private async _saveSettings() {
    this._saving = true;
    this._saveSuccess = false;
    const token = this.config?.token;

    const updates = {
      agents: {
        defaults: {
          model: this._settings.model,
          maxTokens: this._settings.maxTokens,
          temperature: this._settings.temperature,
          maxToolIterations: this._settings.maxToolIterations,
          workspace: this._settings.workspace,
        },
      },
      providers: this._settings.providers,
      channels: {
        telegram: {
          enabled: this._settings.telegram.enabled,
          token: this._settings.telegram.token,
          apiRoot: this._settings.telegram.apiRoot || undefined,
          debug: this._settings.telegram.debug,
          allowFrom: this._settings.telegram.allowFrom,
          groupAllowFrom: this._settings.telegram.groupAllowFrom.length > 0 ? this._settings.telegram.groupAllowFrom : undefined,
          dmPolicy: this._settings.telegram.dmPolicy,
          groupPolicy: this._settings.telegram.groupPolicy,
          replyToMode: this._settings.telegram.replyToMode,
          streamMode: this._settings.telegram.streamMode,
          historyLimit: this._settings.telegram.historyLimit,
          textChunkLimit: this._settings.telegram.textChunkLimit,
          proxy: this._settings.telegram.proxy || undefined,
          accounts: Object.keys(this._settings.telegram.accounts).length > 0 ? this._settings.telegram.accounts : undefined,
        },
        whatsapp: {
          enabled: this._settings.whatsapp.enabled,
          bridgeUrl: this._settings.whatsapp.bridgeUrl,
          allowFrom: this._settings.whatsapp.allowFrom,
        },
      },
      gateway: {
        heartbeat: this._settings.gateway.heartbeat,
        auth: this._settings.gateway.auth?.token ? {
          mode: this._settings.gateway.auth.mode,
          token: this._settings.gateway.auth.token || undefined,
        } : {
          mode: this._settings.gateway.auth?.mode || 'token',
        },
      },
    };

    try {
      // Save config.json
      const response = await fetch(`${window.location.origin}/api/config`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save settings');
      }

      // Also save models.json if it was modified
      if (this._modelsJsonConfig) {
        try {
          await saveModelsJson(this._modelsJsonConfig, token);
        } catch (modelsErr) {
          console.warn('Failed to save models.json:', modelsErr);
          // Don't fail the whole save if models.json fails
        }
      }

      this._dirty = false;
      this._saveSuccess = true;
      setTimeout(() => (this._saveSuccess = false), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
      alert(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      this._saving = false;
    }
  }

  private _renderNav() {
    const sections = [
      { id: 'agent', title: t('settings.sections.agent'), icon: 'bot' },
      { id: 'providers', title: t('settings.sections.providers'), icon: 'cloud' },
      { id: 'models', title: t('settings.sections.models') || 'Models', icon: 'cpu' },
      { id: 'channels', title: t('settings.sections.channels'), icon: 'plug' },
      { id: 'gateway', title: t('settings.sections.gateway'), icon: 'globe' },
    ] as const;

    return html`
      <nav class="sidebar-nav">
        ${sections.map(
          (section) => html`
            <button
              class="sidebar-item ${this._activeSection === section.id ? 'active' : ''}"
              @click=${() => (this._activeSection = section.id)}
            >
              ${getIcon(section.icon)}
              <span>${section.title}</span>
            </button>
          `
        )}
      </nav>
    `;
  }

  private _renderAgentSection() {
    return html`
      <div class="section-content">
        <div class="section-header">
          <h2>${t('settings.sections.agent')}</h2>
        </div>

        <div class="fields-grid">
          <div class="field-group">
            <div class="field-header">
              <label class="field-label">${t('settings.fields.model')}</label>
            </div>
            <model-selector
              .value=${this._settings.model}
              .filter=${'configured'}
              .token=${this.config?.token}
              @change=${(e: CustomEvent) => this._updateSettings('model', e.detail.modelId)}
            ></model-selector>
            <p class="field-desc">${t('settings.descriptionsFields.model')}</p>
          </div>

          <div class="field-group">
            <div class="field-header">
              <label class="field-label">${t('settings.fields.workspace')}</label>
            </div>
            <input
              class="text-input"
              type="text"
              .value=${this._settings.workspace}
              @change=${(e: Event) =>
                this._updateSettings('workspace', (e.target as HTMLInputElement).value)
              }
            />
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="field-group">
              <div class="field-header">
                <label class="field-label">${t('settings.fields.maxTokens')}</label>
              </div>
              <input
                class="text-input"
                type="number"
                .value=${this._settings.maxTokens}
                @change=${(e: Event) =>
                  this._updateSettings('maxTokens', parseInt((e.target as HTMLInputElement).value))
                }
              />
            </div>

            <div class="field-group">
              <div class="field-header">
                <label class="field-label">${t('settings.fields.temperature')}</label>
              </div>
              <input
                class="text-input"
                type="number"
                step="0.1"
                min="0"
                max="2"
                .value=${this._settings.temperature}
                @change=${(e: Event) =>
                  this._updateSettings('temperature', parseFloat((e.target as HTMLInputElement).value))
                }
              />
            </div>
          </div>

          <div class="field-group">
            <div class="field-header">
              <label class="field-label">${t('settings.fields.maxToolIterations')}</label>
            </div>
            <input
              class="text-input"
              type="number"
              .value=${this._settings.maxToolIterations}
              @change=${(e: Event) =>
                this._updateSettings(
                  'maxToolIterations',
                  parseInt((e.target as HTMLInputElement).value)
                )
              }
            />
          </div>
        </div>
      </div>
    `;
  }

  private _renderModelsSection() {
    return html`
      <div class="section-content">
        <div class="section-header">
          <h2>${t('settings.sections.models') || 'Custom Models'}</h2>
          <p class="section-desc">
            Configure custom model providers (Ollama, vLLM, OpenRouter, etc.) via models.json.
            <a href="https://github.com/xopc/xopcbot/blob/main/docs/models.md" target="_blank">Learn more</a>
          </p>
        </div>

        ${this._modelsJsonError ? html`
          <div class="alert alert-error" style="margin-bottom: 1rem; padding: 0.75rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 0.375rem; color: #dc2626;">
            ${getIcon('alertCircle')}
            <span>${this._modelsJsonError}</span>
          </div>
        ` : ''}

        ${this._loadingModelsJson ? html`
          <div class="loading-state">
            <span class="spinner"></span>
            <p>Loading models.json...</p>
          </div>
        ` : html`
          <model-json-editor
            .config=${this._modelsJsonConfig}
            .token=${this.config?.token}
            @change=${(e: CustomEvent<{ config: typeof this._modelsJsonConfig }>) => {
              this._modelsJsonConfig = e.detail.config;
              this._dirty = true;
            }}
            @save=${() => {
              this._saveSuccess = true;
              setTimeout(() => this._saveSuccess = false, 3000);
              this._loadModelsJson();
            }}
            @reload=${() => {
              this._loadModelsJson();
            }}
          ></model-json-editor>
        `}
      </div>
    `;
  }

  private _renderProvidersSection() {
    const providers: ProviderInfo[] = this._providers.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      supportsOAuth: p.supportsOAuth,
      // Use configured from providerMeta (which checks env vars + config + registry)
      configured: p.configured,
      // Show API key only if set in config file (don't show env var values)
      // If configured via env var, show placeholder to indicate it's set
      apiKey: this._settings.providers[p.id] || (p.configured ? '••••••••••••' : ''),
    }));

    return html`
      <div class="section-content">
        <div class="section-header">
          <h2>${t('settings.sections.providers')}</h2>
          <p class="section-desc">
            Configure API keys for the providers you want to use. Models from configured providers
            will be available for selection.
          </p>
        </div>

        <provider-list
          .providers=${providers}
          .loading=${this._loadingProviders}
          @change=${this._onProviderChange}
          @oauth=${this._onProviderOAuth}
        ></provider-list>
      </div>
    `;
  }

  private _renderChannelsSection() {
    return html`
      <div class="section-content">
        <div class="section-header">
          <h2>${t('settings.sections.channels')}</h2>
        </div>

        <div class="fields-grid">
          ${this._renderTelegramSection()}
          ${this._renderWhatsAppSection()}
        </div>
      </div>
    `;
  }

  private _renderTelegramSection() {
    const dmPolicyOptions: { value: DmPolicy; label: string }[] = [
      { value: 'pairing', label: 'Pairing (Start bot to authorize)' },
      { value: 'allowlist', label: 'Allowlist (Only configured IDs)' },
      { value: 'open', label: 'Open (Accept all DMs)' },
      { value: 'disabled', label: 'Disabled (No DMs)' },
    ];

    const groupPolicyOptions: { value: GroupPolicy; label: string }[] = [
      { value: 'open', label: 'Open (All groups)' },
      { value: 'disabled', label: 'Disabled (No groups)' },
      { value: 'allowlist', label: 'Allowlist (Only configured groups)' },
    ];

    const replyToModeOptions: { value: ReplyToMode; label: string }[] = [
      { value: 'off', label: 'Off' },
      { value: 'first', label: 'First (Reply to first message)' },
      { value: 'all', label: 'All (Reply to all messages)' },
    ];

    const streamModeOptions: { value: StreamMode; label: string }[] = [
      { value: 'off', label: 'Off (No streaming)' },
      { value: 'partial', label: 'Partial (Chunked updates)' },
      { value: 'block', label: 'Block (Edit final message)' },
    ];

    return html`
      <div class="channel-section">
        <label class="toggle-label">
          <input
            class="toggle-input"
            type="checkbox"
            .checked=${this._settings.telegram.enabled}
            @change=${(e: Event) =>
              this._updateSettings(
                'telegram.enabled',
                (e.target as HTMLInputElement).checked
              )
            }
          />
          <span class="toggle-switch"></span>
          <span class="toggle-text">Enable Telegram</span>
        </label>

        ${this._settings.telegram.enabled
          ? html`
              <div class="channel-fields" style="margin-top: 1.5rem; padding-left: 1rem; border-left: 2px solid var(--border-color);">
                <!-- Simple Mode -->
                ${!this._settings.telegram.advancedMode
                  ? html`
                      <!-- Bot Token (Required) -->
                      <div class="field-group">
                        <div class="field-header">
                          <label class="field-label">Bot Token <span class="required-mark">*</span></label>
                        </div>
                        <div class="input-with-actions">
                          <input
                            class="text-input"
                            type="${this._showTelegramToken ? 'text' : 'password'}"
                            .value=${this._settings.telegram.token}
                            @change=${(e: Event) =>
                              this._updateSettings(
                                'telegram.token',
                                (e.target as HTMLInputElement).value
                              )
                            }
                            placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                          />
                          <div class="input-actions">
                            ${this._settings.telegram.token ? html`
                              <button
                                class="btn-icon"
                                @click=${this._copyTelegramToken}
                                title="${this._copiedTelegramToken ? 'Copied!' : 'Copy Token'}"
                              >
                                ${getIcon(this._copiedTelegramToken ? 'check' : 'copy')}
                              </button>
                            ` : ''}
                            <button
                              class="btn-icon"
                              @click=${this._toggleTelegramTokenVisibility}
                              title="${this._showTelegramToken ? 'Hide' : 'Show'} Token"
                            >
                              ${getIcon(this._showTelegramToken ? 'eyeOff' : 'eye')}
                            </button>
                          </div>
                        </div>
                        <p class="field-desc">Get your token from @BotFather</p>
                      </div>

                      <!-- Allow From -->
                      <div class="field-group">
                        <div class="field-header">
                          <label class="field-label">Allow From (User IDs)</label>
                        </div>
                        <textarea
                          class="textarea-input"
                          .value=${this._settings.telegram.allowFrom.join(', ')}
                          @change=${(e: Event) =>
                            this._updateSettings(
                              'telegram.allowFrom',
                              (e.target as HTMLTextAreaElement).value
                                .split(/[,\n]/)
                                .map((s) => s.trim())
                                .filter(Boolean)
                            )
                          }
                          placeholder="123456789, 987654321"
                          rows="2"
                        ></textarea>
                        <p class="field-desc">Comma-separated user IDs allowed to use the bot</p>
                      </div>

                      <!-- Switch to Advanced -->
                      <div class="field-group" style="margin-top: 1rem;">
                        <button
                          class="btn btn-ghost"
                          @click=${() => this._updateSettings('telegram.advancedMode', true)}
                        >
                          ${getIcon('settings')} Switch to Advanced Mode
                        </button>
                      </div>
                    `
                  : ''}

                <!-- Advanced Mode -->
                ${this._settings.telegram.advancedMode
                  ? html`
                      <!-- Switch to Simple -->
                      <div class="field-group" style="margin-bottom: 1rem;">
                        <button
                          class="btn btn-ghost"
                          @click=${() => this._updateSettings('telegram.advancedMode', false)}
                        >
                          ${getIcon('arrowLeft')} Back to Simple Mode
                        </button>
                      </div>

                      <!-- Bot Token (Required) -->
                      <div class="field-group">
                        <div class="field-header">
                          <label class="field-label">Bot Token <span class="required-mark">*</span></label>
                        </div>
                        <input
                          class="text-input"
                          type="password"
                          .value=${this._settings.telegram.token}
                          @change=${(e: Event) =>
                            this._updateSettings(
                              'telegram.token',
                              (e.target as HTMLInputElement).value
                            )
                          }
                          placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                        />
                        <p class="field-desc">Get your token from @BotFather</p>
                      </div>

                      <!-- API Root (Optional) -->
                      <div class="field-group">
                        <div class="field-header">
                          <label class="field-label">API Root</label>
                        </div>
                        <input
                          class="text-input"
                          type="text"
                          .value=${this._settings.telegram.apiRoot}
                          @change=${(e: Event) =>
                            this._updateSettings(
                              'telegram.apiRoot',
                              (e.target as HTMLInputElement).value
                            )
                          }
                          placeholder="https://api.telegram.org"
                        />
                        <p class="field-desc">Custom API endpoint (leave empty for default)</p>
                      </div>

                      <!-- Proxy (Optional) -->
                      <div class="field-group">
                        <div class="field-header">
                          <label class="field-label">Proxy</label>
                        </div>
                        <input
                          class="text-input"
                          type="text"
                          .value=${this._settings.telegram.proxy}
                          @change=${(e: Event) =>
                            this._updateSettings(
                              'telegram.proxy',
                              (e.target as HTMLInputElement).value
                            )
                          }
                          placeholder="http://proxy.example.com:8080"
                        />
                        <p class="field-desc">HTTP/HTTPS proxy URL (optional)</p>
                      </div>

                      <!-- DM Policy -->
                      <div class="field-group">
                        <div class="field-header">
                          <label class="field-label">DM Policy</label>
                        </div>
                        <select
                          class="select-input"
                          .value=${this._settings.telegram.dmPolicy}
                          @change=${(e: Event) =>
                            this._updateSettings(
                              'telegram.dmPolicy',
                              (e.target as HTMLSelectElement).value as DmPolicy
                            )
                          }
                        >
                          ${dmPolicyOptions.map(
                            (opt) =>
                              html`<option value=${opt.value}>${opt.label}</option>`
                          )}
                        </select>
                        <p class="field-desc">How to handle direct messages</p>
                      </div>

                      <!-- Group Policy -->
                      <div class="field-group">
                        <div class="field-header">
                          <label class="field-label">Group Policy</label>
                        </div>
                        <select
                          class="select-input"
                          .value=${this._settings.telegram.groupPolicy}
                          @change=${(e: Event) =>
                            this._updateSettings(
                              'telegram.groupPolicy',
                              (e.target as HTMLSelectElement).value as GroupPolicy
                            )
                          }
                        >
                          ${groupPolicyOptions.map(
                            (opt) =>
                              html`<option value=${opt.value}>${opt.label}</option>`
                          )}
                        </select>
                        <p class="field-desc">How to handle group messages</p>
                      </div>

                      <!-- Reply To Mode -->
                      <div class="field-group">
                        <div class="field-header">
                          <label class="field-label">Reply To Mode</label>
                        </div>
                        <select
                          class="select-input"
                          .value=${this._settings.telegram.replyToMode}
                          @change=${(e: Event) =>
                            this._updateSettings(
                              'telegram.replyToMode',
                              (e.target as HTMLSelectElement).value as ReplyToMode
                            )
                          }
                        >
                          ${replyToModeOptions.map(
                            (opt) =>
                              html`<option value=${opt.value}>${opt.label}</option>`
                          )}
                        </select>
                      </div>

                      <!-- Stream Mode -->
                      <div class="field-group">
                        <div class="field-header">
                          <label class="field-label">Stream Mode</label>
                        </div>
                        <select
                          class="select-input"
                          .value=${this._settings.telegram.streamMode}
                          @change=${(e: Event) =>
                            this._updateSettings(
                              'telegram.streamMode',
                              (e.target as HTMLSelectElement).value as StreamMode
                            )
                          }
                        >
                          ${streamModeOptions.map(
                            (opt) =>
                              html`<option value=${opt.value}>${opt.label}</option>`
                          )}
                        </select>
                      </div>

                      <!-- Allow From -->
                      <div class="field-group">
                        <div class="field-header">
                          <label class="field-label">Allow From (User IDs)</label>
                        </div>
                        <textarea
                          class="textarea-input"
                          .value=${this._settings.telegram.allowFrom.join(', ')}
                          @change=${(e: Event) =>
                            this._updateSettings(
                              'telegram.allowFrom',
                              (e.target as HTMLTextAreaElement).value
                                .split(/[,\n]/)
                                .map((s) => s.trim())
                                .filter(Boolean)
                            )
                          }
                          placeholder="123456789, 987654321"
                          rows="2"
                        ></textarea>
                        <p class="field-desc">Comma-separated user IDs allowed to use the bot (for allowlist mode)</p>
                      </div>

                      <!-- Group Allow From -->
                      <div class="field-group">
                        <div class="field-header">
                          <label class="field-label">Allow From Groups (Group IDs)</label>
                        </div>
                        <textarea
                          class="textarea-input"
                          .value=${this._settings.telegram.groupAllowFrom.join(', ')}
                          @change=${(e: Event) =>
                            this._updateSettings(
                              'telegram.groupAllowFrom',
                              (e.target as HTMLTextAreaElement).value
                                .split(/[,\n]/)
                                .map((s) => s.trim())
                                .filter(Boolean)
                            )
                          }
                          placeholder="-1001234567890, -1009876543210"
                          rows="2"
                        ></textarea>
                        <p class="field-desc">Comma-separated group IDs allowed to use the bot</p>
                      </div>

                      <!-- History Limit -->
                      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div class="field-group">
                          <div class="field-header">
                            <label class="field-label">History Limit</label>
                          </div>
                          <input
                            class="text-input"
                            type="number"
                            .value=${this._settings.telegram.historyLimit}
                            @change=${(e: Event) =>
                              this._updateSettings(
                                'telegram.historyLimit',
                                parseInt((e.target as HTMLInputElement).value) || 50
                              )
                            }
                            min="10"
                            max="200"
                          />
                          <p class="field-desc">Messages per session</p>
                        </div>

                        <div class="field-group">
                          <div class="field-header">
                            <label class="field-label">Text Chunk Limit</label>
                          </div>
                          <input
                            class="text-input"
                            type="number"
                            .value=${this._settings.telegram.textChunkLimit}
                            @change=${(e: Event) =>
                              this._updateSettings(
                                'telegram.textChunkLimit',
                                parseInt((e.target as HTMLInputElement).value) || 4000
                              )
                            }
                            min="1000"
                            max="10000"
                            step="100"
                          />
                          <p class="field-desc">Max characters per message</p>
                        </div>
                      </div>

                      <!-- Debug Mode -->
                      <div class="field-group">
                        <label class="toggle-label">
                          <input
                            class="toggle-input"
                            type="checkbox"
                            .checked=${this._settings.telegram.debug}
                            @change=${(e: Event) =>
                              this._updateSettings(
                                'telegram.debug',
                                (e.target as HTMLInputElement).checked
                              )
                            }
                          />
                          <span class="toggle-switch"></span>
                          <span class="toggle-text">Debug Mode</span>
                        </label>
                        <p class="field-desc">Enable verbose logging for troubleshooting</p>
                      </div>
                    `
                  : ''}
              </div>
            `
          : ''}
      </div>
    `;
  }

  private _renderWhatsAppSection() {
    return html`
      <div class="channel-section" style="margin-top: 2rem;">
        <label class="toggle-label">
          <input
            class="toggle-input"
            type="checkbox"
            .checked=${this._settings.whatsapp.enabled}
            @change=${(e: Event) =>
              this._updateSettings(
                'whatsapp.enabled',
                (e.target as HTMLInputElement).checked
              )
            }
          />
          <span class="toggle-switch"></span>
          <span class="toggle-text">Enable WhatsApp</span>
        </label>

        ${this._settings.whatsapp.enabled
          ? html`
              <div class="channel-fields" style="margin-top: 1.5rem; padding-left: 1rem; border-left: 2px solid var(--border-color);">
                <div class="field-group">
                  <div class="field-header">
                    <label class="field-label">Bridge URL</label>
                  </div>
                  <input
                    class="text-input"
                    type="text"
                    .value=${this._settings.whatsapp.bridgeUrl}
                    @change=${(e: Event) =>
                      this._updateSettings(
                        'whatsapp.bridgeUrl',
                        (e.target as HTMLInputElement).value
                      )
                    }
                    placeholder="ws://localhost:3001"
                  />
                </div>

                <div class="field-group">
                  <div class="field-header">
                    <label class="field-label">Allow From</label>
                  </div>
                  <textarea
                    class="textarea-input"
                    .value=${this._settings.whatsapp.allowFrom.join(', ')}
                    @change=${(e: Event) =>
                      this._updateSettings(
                        'whatsapp.allowFrom',
                        (e.target as HTMLTextAreaElement).value
                          .split(/[,\n]/)
                          .map((s) => s.trim())
                          .filter(Boolean)
                      )
                    }
                    placeholder="1234567890, 9876543210"
                    rows="2"
                  ></textarea>
                  <p class="field-desc">Comma-separated phone numbers allowed to use the bot</p>
                </div>
              </div>
            `
          : ''}
      </div>
    `;
  }

  private _renderGatewaySection() {
    return html`
      <div class="section-content">
        <div class="section-header">
          <h2>${t('settings.sections.gateway')}</h2>
        </div>

        <div class="fields-grid">
          <!-- Auth Token -->
          <div class="field-group">
            <div class="field-header">
              <label class="field-label">Access Token</label>
            </div>
            <div class="input-with-actions">
              <input
                class="text-input"
                type="${this._showGatewayToken ? 'text' : 'password'}"
                .value=${this._settings.gateway.auth?.token || ''}
                @change=${(e: Event) =>
                  this._updateSettings('gateway.auth.token', (e.target as HTMLInputElement).value)
                }
                placeholder="Enter access token or leave empty to generate"
              />
              <div class="input-actions">
                ${this._settings.gateway.auth?.token ? html`
                  <button
                    class="btn-icon"
                    @click=${this._copyGatewayToken}
                    title="${this._copiedGatewayToken ? 'Copied!' : 'Copy Token'}"
                  >
                    ${getIcon(this._copiedGatewayToken ? 'check' : 'copy')}
                  </button>
                ` : ''}
                <button
                  class="btn-icon"
                  @click=${this._toggleGatewayTokenVisibility}
                  title="${this._showGatewayToken ? 'Hide' : 'Show'} Token"
                >
                  ${getIcon(this._showGatewayToken ? 'eyeOff' : 'eye')}
                </button>
              </div>
            </div>
            <p class="field-desc">Token used to authenticate API requests. Leave empty to auto-generate.</p>
          </div>

          <!-- Heartbeat Enable -->
          <div class="field-group">
            <label class="toggle-label">
              <input
                class="toggle-input"
                type="checkbox"
                .checked=${this._settings.gateway.heartbeat.enabled}
                @change=${(e: Event) =>
                  this._updateSettings(
                    'gateway.heartbeat.enabled',
                    (e.target as HTMLInputElement).checked
                  )
                }
              />
              <span class="toggle-switch"></span>
              <span class="toggle-text">Enable Heartbeat</span>
            </label>
          </div>

          <!-- Heartbeat Interval -->
          <div class="field-group">
            <div class="field-header">
              <label class="field-label">Heartbeat Interval (ms)</label>
            </div>
            <input
              class="text-input"
              type="number"
              .value=${this._settings.gateway.heartbeat.intervalMs}
              @change=${(e: Event) =>
                this._updateSettings(
                  'gateway.heartbeat.intervalMs',
                  parseInt((e.target as HTMLInputElement).value)
                )
              }
            />
          </div>
        </div>
      </div>
    `;
  }

  private _renderContent() {
    switch (this._activeSection) {
      case 'agent':
        return this._renderAgentSection();
      case 'providers':
        return this._renderProvidersSection();
      case 'models':
        return this._renderModelsSection();
      case 'channels':
        return this._renderChannelsSection();
      case 'gateway':
        return this._renderGatewaySection();
      default:
        return html`<div>Select a section</div>`;
    }
  }

  render() {
    if (this._loading) {
      return html`
        <div class="loading-state">
          <span class="spinner"></span>
          <p>Loading settings...</p>
        </div>
      `;
    }

    return html`
      <div class="settings-page">
        <aside class="settings-sidebar">${this._renderNav()}</aside>

        <main class="settings-main">
          ${this._renderContent()}

          ${this._dirty
            ? html`
                <div class="floating-save">
                  <span class="dirty-count">You have unsaved changes</span>
                  <button
                    class="btn btn-primary"
                    ?disabled=${this._saving}
                    @click=${this._saveSettings}
                  >
                    ${this._saving ? html`<span class="spinner-sm"></span> Saving...` : 'Save Changes'}
                  </button>
                </div>
              `
            : ''}

          ${this._saveSuccess
            ? html`<div class="save-success">Settings saved successfully!</div>`
            : ''}
        </main>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'settings-page': SettingsPage;
  }
}
