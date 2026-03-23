import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';
import { t } from '../utils/i18n.js';
import '../components/ProviderList.js';
import '../components/VoiceConfigSection.js';
import '../components/ModelJsonEditor.js';
import '../settings/AgentSection.js';
import '../settings/ChannelsSection.js';
import '../settings/GatewaySection.js';
import { fetchConfiguredModels, fetchProviderMeta } from '../config/registry-client.js';
import type { Model } from '../config/registry-client.js';
import type { ProviderInfo, ProviderListChangeEvent, ProviderListOAuthEvent } from '../components/ProviderList.js';
import { fetchModelsJson, normalizeModelsJsonConfig, saveModelsJson } from '../config/models-json-client.js';
import type { ModelsJsonConfig } from '../config/models-json-client.js';
import { DEFAULT_SETTINGS } from '../settings/types.js';
import type { SettingsData } from '../settings/types.js';

export interface SettingsPageConfig { token?: string; }

type Section = 'agent' | 'providers' | 'models' | 'channels' | 'voice' | 'gateway';

@customElement('settings-page')
export class SettingsPage extends LitElement {
  @property({ attribute: false }) config?: SettingsPageConfig;

  @state() private _section: Section = 'agent';
  @state() private _loading = false;
  @state() private _saving = false;
  @state() private _saveSuccess = false;
  @state() private _dirty = false;
  @state() private _tokenExpired = false;
  @state() private _settings: SettingsData = { ...DEFAULT_SETTINGS, telegram: { ...DEFAULT_SETTINGS.telegram } };
  @state() private _providers: ProviderInfo[] = [];
  @state() private _loadingProviders = false;
  @state() private _models: Model[] = [];
  @state() private _modelsJson: ModelsJsonConfig = { providers: {} };
  @state() private _modelsJsonError?: string;
  @state() private _loadingModelsJson = false;

  createRenderRoot() { return this; }

  override connectedCallback() {
    super.connectedCallback();
    this._loadSettings();
    this._loadProviders();
    this._loadModelsJson();
    window.addEventListener('token-expired', () => { this._tokenExpired = true; });
    window.addEventListener('token-updated', () => { this._tokenExpired = false; this._loadSettings(); });
  }

  // ── Data loading ──────────────────────────────────────────

  private async _loadSettings() {
    this._loading = true;
    try {
      const res = await fetch(`${window.location.origin}/api/config`, {
        headers: this.config?.token ? { Authorization: `Bearer ${this.config.token}` } : {},
      });
      if (!res.ok) return;
      const { payload } = await res.json();
      const c = payload?.config;
      if (!c) return;

      let model = c.agents?.defaults?.model;
      if (model && typeof model === 'object') model = model.primary || '';

      this._settings = {
        model: model || 'anthropic/claude-sonnet-4-5',
        maxTokens: c.agents?.defaults?.maxTokens || 8192,
        temperature: c.agents?.defaults?.temperature ?? 0.7,
        maxToolIterations: c.agents?.defaults?.maxToolIterations || 20,
        workspace: c.agents?.defaults?.workspace || '~/.xopcbot/workspace',
        thinkingDefault: c.agents?.defaults?.thinkingDefault || 'medium',
        reasoningDefault: c.agents?.defaults?.reasoningDefault || 'off',
        verboseDefault: c.agents?.defaults?.verboseDefault || 'off',
        providers: c.providers || {},
        telegram: {
          enabled: c.channels?.telegram?.enabled || false,
          botToken: c.channels?.telegram?.botToken || '',
          apiRoot: c.channels?.telegram?.apiRoot || '',
          debug: c.channels?.telegram?.debug || false,
          allowFrom: c.channels?.telegram?.allowFrom || [],
          groupAllowFrom: c.channels?.telegram?.groupAllowFrom || [],
          dmPolicy: c.channels?.telegram?.dmPolicy || 'pairing',
          groupPolicy: c.channels?.telegram?.groupPolicy || 'open',
          replyToMode: c.channels?.telegram?.replyToMode || 'off',
          streamMode: c.channels?.telegram?.streamMode ?? 'partial',
          historyLimit: c.channels?.telegram?.historyLimit || 50,
          textChunkLimit: c.channels?.telegram?.textChunkLimit || 4000,
          proxy: c.channels?.telegram?.proxy || '',
          accounts: c.channels?.telegram?.accounts || {},
          advancedMode: false,
        },
        gateway: {
          heartbeat: { enabled: c.gateway?.heartbeat?.enabled ?? true, intervalMs: c.gateway?.heartbeat?.intervalMs || 60000 },
          auth: { mode: c.gateway?.auth?.mode || 'token', token: c.gateway?.auth?.token || '' },
        },
        stt: c.stt || { enabled: false, provider: 'alibaba', alibaba: { model: 'paraformer-v2' }, openai: { model: 'whisper-1' }, fallback: { enabled: true, order: ['alibaba', 'openai'] } },
        tts: {
          enabled: false,
          provider: 'openai',
          trigger: 'always',
          maxTextLength: 4096,
          timeoutMs: 30000,
          alibaba: { model: 'qwen-tts', voice: 'Cherry' },
          openai: { model: 'tts-1', voice: 'alloy' },
          ...(c.tts ?? {}),
        },
      };
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadProviders() {
    this._loadingProviders = true;
    try {
      const [models, meta] = await Promise.all([
        fetchConfiguredModels(this.config?.token),
        fetchProviderMeta(this.config?.token),
      ]);
      this._models = models;
      const configured = new Set(models.map((m: Model) => m.provider));
      this._providers = meta.map((p: any) => ({
        id: p.id, name: p.name, category: p.category, supportsOAuth: p.supportsOAuth,
        configured: p.configured || configured.has(p.id),
      }));
    } catch (err) {
      console.error('Failed to load providers:', err);
    } finally {
      this._loadingProviders = false;
    }
  }

  private async _loadModelsJson() {
    this._loadingModelsJson = true;
    try {
      const payload = await fetchModelsJson(this.config?.token);
      this._modelsJson = normalizeModelsJsonConfig(payload.config);
      this._modelsJsonError = payload.loadError;
    } catch (err) {
      this._modelsJsonError = err instanceof Error ? err.message : 'Failed to load models.json';
    } finally {
      this._loadingModelsJson = false;
    }
  }

  // ── Mutations ─────────────────────────────────────────────

  private _update(path: string, value: unknown) {
    const keys = path.split('.');
    const next = { ...this._settings } as Record<string, unknown>;
    let cur = next;
    for (let i = 0; i < keys.length - 1; i++) {
      cur[keys[i]] = { ...(cur[keys[i]] as Record<string, unknown>) };
      cur = cur[keys[i]] as Record<string, unknown>;
    }
    cur[keys[keys.length - 1]] = value;
    this._settings = next as unknown as SettingsData;
    this._dirty = true;
  }

  private async _save() {
    this._saving = true;
    const token = this.config?.token;
    const s = this._settings;
    const tg = s.telegram;

    const body = {
      agents: { defaults: { model: s.model, maxTokens: s.maxTokens, temperature: s.temperature, maxToolIterations: s.maxToolIterations, workspace: s.workspace, thinkingDefault: s.thinkingDefault, reasoningDefault: s.reasoningDefault, verboseDefault: s.verboseDefault } },
      providers: s.providers,
      channels: {
        telegram: {
          enabled: tg.enabled, botToken: tg.botToken, apiRoot: tg.apiRoot || undefined, debug: tg.debug,
          allowFrom: tg.allowFrom, groupAllowFrom: tg.groupAllowFrom.length ? tg.groupAllowFrom : undefined,
          dmPolicy: tg.dmPolicy, groupPolicy: tg.groupPolicy, replyToMode: tg.replyToMode,
          streamMode: tg.streamMode, historyLimit: tg.historyLimit, textChunkLimit: tg.textChunkLimit,
          proxy: tg.proxy || undefined, accounts: Object.keys(tg.accounts).length ? tg.accounts : undefined,
        },
      },
      gateway: {
        heartbeat: s.gateway.heartbeat,
        auth: s.gateway.auth?.token
          ? { mode: s.gateway.auth.mode, token: s.gateway.auth.token }
          : { mode: s.gateway.auth?.mode || 'token' },
      },
      stt: s.stt,
      tts: s.tts,
    };

    try {
      const res = await fetch(`${window.location.origin}/api/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to save'); }

      if (this._modelsJson) {
        await saveModelsJson(this._modelsJson, token).catch(e => console.warn('models.json save failed:', e));
      }

      this._dirty = false;
      this._saveSuccess = true;
      setTimeout(() => { this._saveSuccess = false; }, 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      this._saving = false;
    }
  }

  // ── Render ────────────────────────────────────────────────

  override render() {
    if (this._loading) {
      return html`
        <div class="settings-page">
          <div class="loading-state"><span class="spinner"></span><p>${t('settings.loading')}</p></div>
        </div>`;
    }

    return html`
      <div class="settings-page">
        <aside class="settings-sidebar">${this._renderNav()}</aside>
        <main class="settings-main">
          ${this._renderSection()}
          ${this._dirty ? html`
            <div class="floating-save">
              <span class="dirty-count">${t('settings.page.unsavedBanner')}</span>
              <button class="btn btn-primary" ?disabled=${this._saving} @click=${this._save}>
                ${this._saving ? html`<span class="spinner-sm"></span> ${t('settings.saving')}` : t('settings.saveChanges')}
              </button>
            </div>` : ''}
          ${this._saveSuccess ? html`<div class="save-success" role="status">${t('settings.page.saveSuccess')}</div>` : ''}
        </main>
      </div>
    `;
  }

  private _renderNav() {
    const items: { id: Section; title: string; icon: string }[] = [
      { id: 'agent', title: t('settings.sections.agent'), icon: 'bot' },
      { id: 'providers', title: t('settings.sections.providers'), icon: 'cloud' },
      { id: 'models', title: t('settings.sections.models') || 'Models', icon: 'cpu' },
      { id: 'channels', title: t('settings.sections.channels'), icon: 'plug' },
      { id: 'voice', title: t('settings.sections.voice') || 'Voice', icon: 'mic' },
      { id: 'gateway', title: t('settings.sections.gateway'), icon: 'globe' },
    ];
    return html`
      <nav class="sidebar-nav">
        ${items.map(item => html`
          <button class="sidebar-item ${this._section === item.id ? 'active' : ''}" @click=${() => { this._section = item.id; }}>
            ${getIcon(item.icon)}<span>${item.title}</span>
          </button>`)}
      </nav>`;
  }

  private _renderSection() {
    const s = this._settings;
    switch (this._section) {
      case 'agent': return html`<agent-section .settings=${s} .token=${this.config?.token} .onChange=${(p: string, v: unknown) => this._update(p, v)}></agent-section>`;
      case 'providers': return this._renderProviders();
      case 'models': return this._renderModels();
      case 'channels': return html`<channels-section .settings=${s} .onChange=${(p: string, v: unknown) => this._update(p, v)}></channels-section>`;
      case 'voice': return html`<voice-config-section .config=${{ stt: s.stt, tts: s.tts }} .token=${this.config?.token} .onChange=${(p: string, v: unknown) => this._update(p, v)}></voice-config-section>`;
      case 'gateway': return html`<gateway-section .settings=${s} .tokenExpired=${this._tokenExpired} .onChange=${(p: string, v: unknown) => this._update(p, v)}></gateway-section>`;
      default: return html`<div class="section-content"><p class="section-desc">${t('settings.page.selectSection')}</p></div>`;
    }
  }

  private _renderProviders() {
    const providers: ProviderInfo[] = this._providers.map(p => ({
      ...p,
      apiKey: this._settings.providers[p.id] || (p.configured ? '***' : ''),
    }));
    return html`
      <div class="section-content">
        <div class="section-header">
          <h2>${t('settings.sections.providers')}</h2>
          <p class="section-desc">${t('settings.page.providersIntro')}</p>
        </div>
        <provider-list
          .providers=${providers}
          .loading=${this._loadingProviders}
          .token=${this.config?.token}
          @change=${(e: CustomEvent<ProviderListChangeEvent>) => this._update('providers', { ...this._settings.providers, [e.detail.provider]: e.detail.apiKey })}
          @oauth=${(e: CustomEvent<ProviderListOAuthEvent>) => { if (e.detail.error) alert(`OAuth failed: ${e.detail.error}`); }}
        ></provider-list>
      </div>`;
  }

  private _renderModels() {
    return html`
      <div class="section-content">
        <div class="section-header">
          <h2>${t('settings.sections.models')}</h2>
          <p class="section-desc">${t('settings.page.modelsIntro')}</p>
        </div>
        ${this._modelsJsonError ? html`<div class="alert alert-error" role="alert">${this._modelsJsonError}</div>` : ''}
        ${this._loadingModelsJson ? html`<div class="loading-state"><span class="spinner"></span><p>${t('settings.page.modelsJsonLoading')}</p></div>` : html`
          <model-json-editor
            .config=${this._modelsJson}
            .token=${this.config?.token}
            @change=${(e: CustomEvent<{ config: ModelsJsonConfig }>) => { this._modelsJson = e.detail.config; this._dirty = true; }}
            @save=${() => { this._saveSuccess = true; setTimeout(() => { this._saveSuccess = false; }, 3000); this._loadModelsJson(); }}
            @reload=${() => this._loadModelsJson()}
          ></model-json-editor>`}
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { 'settings-page': SettingsPage; }
}
