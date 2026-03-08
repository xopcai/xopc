/**
 * Voice (STT/TTS) configuration section
 */

import { html, LitElement, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';
import { t } from '../utils/i18n.js';

export interface VoiceModel {
  id: string;
  name: string;
  description?: string;
}

export interface VoiceModels {
  stt: {
    alibaba: VoiceModel[];
    openai: VoiceModel[];
  };
  tts: {
    alibaba: VoiceModel[];
    openai: VoiceModel[];
    edge: VoiceModel[];
  };
  ttsVoices: {
    alibaba: VoiceModel[];
    openai: VoiceModel[];
    edge: VoiceModel[];
  };
}

export interface VoiceSectionConfig {
  stt?: {
    enabled: boolean;
    provider: 'alibaba' | 'openai';
    alibaba?: { apiKey?: string; model?: string };
    openai?: { apiKey?: string; model?: string };
    fallback?: { enabled: boolean; order: ('alibaba' | 'openai')[] };
  };
  tts?: {
    enabled: boolean;
    provider: 'openai' | 'alibaba' | 'edge';
    trigger: 'off' | 'always' | 'inbound' | 'tagged';
    alibaba?: { apiKey?: string; model?: string; voice?: string };
    openai?: { apiKey?: string; model?: string; voice?: string };
    edge?: { voice?: string; lang?: string };
  };
}

@customElement('voice-config-section')
export class VoiceConfigSection extends LitElement {
  @property({ attribute: false }) config: VoiceSectionConfig = {};
  @property({ attribute: false }) onChange?: (path: string, value: unknown) => void;
  @property({ attribute: false }) token?: string;

  @state() private _voiceModels: VoiceModels | null = null;

  async connectedCallback() {
    super.connectedCallback();
    await this._fetchVoiceModels();
  }

  private async _fetchVoiceModels() {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }
      
      const response = await fetch(`${window.location.origin}/api/voice/models`, { headers });
      const data = await response.json();
      if (data.ok && data.payload?.models) {
        this._voiceModels = data.payload.models;
        this.requestUpdate();
      }
    } catch (error) {
      console.error('Failed to fetch voice models:', error);
    }
  }

  static styles = css`
    :host {
      display: block;
    }

    .section-content {
      padding: 0;
    }

    .section-header {
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border, #e2e8f0);
    }

    .section-header h2 {
      margin: 0 0 0.5rem 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--foreground, #0f172a);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .section-desc {
      margin: 0;
      color: var(--muted-foreground, #64748b);
      font-size: 0.875rem;
    }

    .subsection {
      margin-bottom: 2rem;
      background: var(--muted, #f8fafc);
      border-radius: 0.75rem;
      padding: 1.25rem;
      border: 1px solid var(--border, #e2e8f0);
    }

    .subsection:last-child {
      margin-bottom: 0;
    }

    .subsection-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.25rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border, #e2e8f0);
    }

    .subsection-header h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: var(--foreground, #0f172a);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .subsection-header h3 svg {
      width: 1.25rem;
      height: 1.25rem;
      color: var(--primary, #3b82f6);
    }

    .subsection-desc {
      margin: 0;
      color: var(--muted-foreground, #64748b);
      font-size: 0.8125rem;
    }

    .enable-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      background: var(--background, #ffffff);
      border-radius: 0.5rem;
      border: 1px solid var(--border, #e2e8f0);
      margin-bottom: 1rem;
    }

    .enable-row .field-label {
      font-weight: 500;
      color: var(--foreground, #0f172a);
    }

    .enable-row .field-desc {
      margin: 0.25rem 0 0 0;
      font-size: 0.75rem;
      color: var(--muted-foreground, #64748b);
    }

    .config-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1rem;
    }

    .field-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .field-group.full-width {
      grid-column: 1 / -1;
    }

    .field-label {
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--foreground, #0f172a);
    }

    .field-desc {
      margin: 0;
      font-size: 0.75rem;
      color: var(--muted-foreground, #64748b);
    }

    .text-input,
    .select-input {
      padding: 0.625rem 0.875rem;
      border: 1px solid var(--border, #e2e8f0);
      border-radius: 0.5rem;
      font-size: 0.875rem;
      background: var(--background, #ffffff);
      color: var(--foreground, #0f172a);
      width: 100%;
      box-sizing: border-box;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    .text-input:focus,
    .select-input:focus {
      outline: none;
      border-color: var(--primary, #3b82f6);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    .select-input {
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 0.75rem center;
      padding-right: 2.5rem;
    }

    .switch {
      position: relative;
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }

    .switch input {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
    }

    .switch-slider {
      position: relative;
      width: 2.75rem;
      height: 1.5rem;
      background: var(--muted-foreground, #94a3b8);
      border-radius: 9999px;
      transition: background 0.2s;
    }

    .switch-slider::after {
      content: '';
      position: absolute;
      top: 0.125rem;
      left: 0.125rem;
      width: 1.25rem;
      height: 1.25rem;
      background: white;
      border-radius: 50%;
      transition: transform 0.2s;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .switch input:checked + .switch-slider {
      background: var(--primary, #3b82f6);
    }

    .switch input:checked + .switch-slider::after {
      transform: translateX(1.25rem);
    }

    .info-box {
      margin-top: 1.5rem;
      padding: 1rem 1.25rem;
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(99, 102, 241, 0.05) 100%);
      border: 1px solid rgba(59, 130, 246, 0.2);
      border-radius: 0.75rem;
    }

    .info-box p {
      margin: 0 0 0.5rem 0;
      font-size: 0.8125rem;
      color: var(--foreground, #0f172a);
      line-height: 1.5;
    }

    .info-box p:last-child {
      margin-bottom: 0;
    }

    .info-box strong {
      color: var(--primary, #3b82f6);
    }

    .info-box code {
      display: inline-block;
      padding: 0.125rem 0.375rem;
      background: rgba(59, 130, 246, 0.1);
      border-radius: 0.25rem;
      font-family: ui-monospace, monospace;
      font-size: 0.75rem;
      color: var(--primary, #3b82f6);
    }

    .provider-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.25rem 0.625rem;
      background: var(--primary, #3b82f6);
      color: white;
      font-size: 0.75rem;
      font-weight: 500;
      border-radius: 9999px;
    }

    .fallback-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      background: var(--background, #ffffff);
      border-radius: 0.5rem;
      border: 1px solid var(--border, #e2e8f0);
      margin-top: 0.5rem;
    }

    @media (max-width: 640px) {
      .config-grid {
        grid-template-columns: 1fr;
      }

      .subsection {
        padding: 1rem;
      }
    }
  `;

  private _updateConfig(path: string, value: unknown) {
    this.onChange?.(path, value);
  }

  private _getTriggerDescription(trigger: string): string {
    switch (trigger) {
      case 'off':
        return 'TTS is completely disabled';
      case 'always':
        return 'Apply TTS to all messages';
      case 'inbound':
        return 'Only reply with voice when user sends voice';
      case 'tagged':
        return 'Only when [[tts]] directive is used';
      default:
        return '';
    }
  }

  render() {
    const sttEnabled = this.config.stt?.enabled ?? false;
    const ttsEnabled = this.config.tts?.enabled ?? false;
    const sttProvider = this.config.stt?.provider || 'alibaba';
    const ttsProvider = this.config.tts?.provider || 'openai';
    const ttsTrigger = this.config.tts?.trigger || 'always';

    return html`
      <div class="section-content">
        <div class="section-header">
          <h2>${getIcon('mic')} ${t('settings.voice.title')}</h2>
          <p class="section-desc">${t('settings.voice.description')}</p>
        </div>

        <!-- STT Configuration -->
        <div class="subsection">
          <div class="subsection-header">
            <h3>${getIcon('mic')} ${t('settings.voice.stt.title')}</h3>
            <p class="subsection-desc">${t('settings.voice.stt.description')}</p>
          </div>

          <!-- STT Enable -->
          <div class="enable-row">
            <div>
              <label class="field-label">${t('settings.voice.stt.enable')}</label>
              <p class="field-desc">${t('settings.voice.stt.enableDesc')}</p>
            </div>
            <label class="switch">
              <input
                type="checkbox"
                .checked=${sttEnabled}
                @change=${(e: Event) => this._updateConfig('stt.enabled', (e.target as HTMLInputElement).checked)}
              />
              <span class="switch-slider"></span>
            </label>
          </div>

          ${sttEnabled ? html`
            <div class="config-grid">
              <!-- STT Provider -->
              <div class="field-group">
                <label class="field-label">${t('settings.voice.stt.provider')}</label>
                <select
                  class="select-input"
                  .value=${sttProvider}
                  @change=${(e: Event) => this._updateConfig('stt.provider', (e.target as HTMLSelectElement).value)}
                >
                  <option value="alibaba">${t('settings.voice.stt.alibaba')}</option>
                  <option value="openai">${t('settings.voice.stt.openai')}</option>
                </select>
              </div>

              ${sttProvider === 'alibaba' ? html`
                <div class="field-group">
                  <label class="field-label">${t('settings.voice.stt.apiKey')}</label>
                  <input
                    class="text-input"
                    type="password"
                    .value=${this.config.stt?.alibaba?.apiKey || ''}
                    @change=${(e: Event) => this._updateConfig('stt.alibaba.apiKey', (e.target as HTMLInputElement).value)}
                    placeholder="sk-..."
                  />
                  <p class="field-desc">${t('settings.voice.stt.apiKeyDesc')} (DASHSCOPE_API_KEY)</p>
                </div>
                <div class="field-group">
                  <label class="field-label">${t('settings.voice.stt.model')}</label>
                  <select
                    class="select-input"
                    .value=${this.config.stt?.alibaba?.model || ''}
                    @change=${(e: Event) => this._updateConfig('stt.alibaba.model', (e.target as HTMLSelectElement).value)}
                  >
                    ${this._voiceModels?.stt?.alibaba?.length 
                      ? this._voiceModels.stt.alibaba.map(model => html`
                          <option value=${model.id} ?selected=${model.id === this.config.stt?.alibaba?.model}>${model.name}</option>
                        `)
                      : html`
                          <option value="paraformer-v2">Paraformer v2</option>
                          <option value="paraformer-v1">Paraformer v1</option>
                        `}
                  </select>
                </div>
              ` : ''}

              ${sttProvider === 'openai' ? html`
                <div class="field-group">
                  <label class="field-label">${t('settings.voice.stt.apiKey')}</label>
                  <input
                    class="text-input"
                    type="password"
                    .value=${this.config.stt?.openai?.apiKey || ''}
                    @change=${(e: Event) => this._updateConfig('stt.openai.apiKey', (e.target as HTMLInputElement).value)}
                    placeholder="sk-..."
                  />
                  <p class="field-desc">${t('settings.voice.stt.apiKeyDesc')} (OPENAI_API_KEY)</p>
                </div>
                <div class="field-group">
                  <label class="field-label">${t('settings.voice.stt.model')}</label>
                  <select
                    class="select-input"
                    .value=${this.config.stt?.openai?.model || ''}
                    @change=${(e: Event) => this._updateConfig('stt.openai.model', (e.target as HTMLSelectElement).value)}
                  >
                    ${this._voiceModels?.stt?.openai?.length
                      ? this._voiceModels.stt.openai.map(model => html`
                          <option value=${model.id} ?selected=${model.id === this.config.stt?.openai?.model}>${model.name}</option>
                        `)
                      : html`
                          <option value="whisper-1">Whisper-1</option>
                        `}
                  </select>
                </div>
              ` : ''}
            </div>

            <!-- Fallback -->
            <div class="fallback-row">
              <div>
                <label class="field-label">${t('settings.voice.stt.fallback')}</label>
                <p class="field-desc">${t('settings.voice.stt.fallbackDesc')}</p>
              </div>
              <label class="switch">
                <input
                  type="checkbox"
                  .checked=${this.config.stt?.fallback?.enabled ?? true}
                  @change=${(e: Event) => this._updateConfig('stt.fallback.enabled', (e.target as HTMLInputElement).checked)}
                />
                <span class="switch-slider"></span>
              </label>
            </div>
          ` : ''}
        </div>

        <!-- TTS Configuration -->
        <div class="subsection">
          <div class="subsection-header">
            <h3>${getIcon('volume-2')} ${t('settings.voice.tts.title')}</h3>
            <p class="subsection-desc">${t('settings.voice.tts.description')}</p>
          </div>

          <!-- TTS Enable -->
          <div class="enable-row">
            <div>
              <label class="field-label">${t('settings.voice.tts.enable')}</label>
              <p class="field-desc">${t('settings.voice.tts.enableDesc')}</p>
            </div>
            <label class="switch">
              <input
                type="checkbox"
                .checked=${ttsEnabled}
                @change=${(e: Event) => this._updateConfig('tts.enabled', (e.target as HTMLInputElement).checked)}
              />
              <span class="switch-slider"></span>
            </label>
          </div>

          ${ttsEnabled ? html`
            <div class="config-grid">
              <!-- TTS Trigger -->
              <div class="field-group">
                <label class="field-label">${t('settings.voice.tts.trigger')}</label>
                <select
                  class="select-input"
                  .value=${ttsTrigger}
                  @change=${(e: Event) => this._updateConfig('tts.trigger', (e.target as HTMLSelectElement).value)}
                >
                  <option value="off">${t('settings.voice.tts.triggerOff')}</option>
                  <option value="always">${t('settings.voice.tts.triggerAlways')}</option>
                  <option value="inbound">${t('settings.voice.tts.triggerInbound')}</option>
                  <option value="tagged">${t('settings.voice.tts.triggerTagged')}</option>
                </select>
                <p class="field-desc">${this._getTriggerDescription(ttsTrigger)}</p>
              </div>

              <!-- TTS Provider -->
              <div class="field-group">
                <label class="field-label">${t('settings.voice.tts.provider')}</label>
                <select
                  class="select-input"
                  .value=${ttsProvider}
                  @change=${(e: Event) => this._updateConfig('tts.provider', (e.target as HTMLSelectElement).value)}
                >
                  <option value="openai">OpenAI TTS</option>
                  <option value="alibaba">${t('settings.voice.stt.alibaba')}</option>
                  <option value="edge">Microsoft Edge (Free)</option>
                </select>
              </div>

              ${ttsProvider === 'openai' ? html`
                <div class="field-group">
                  <label class="field-label">${t('settings.voice.stt.apiKey')}</label>
                  <input
                    class="text-input"
                    type="password"
                    .value=${this.config.tts?.openai?.apiKey || ''}
                    @change=${(e: Event) => this._updateConfig('tts.openai.apiKey', (e.target as HTMLInputElement).value)}
                    placeholder="sk-..."
                  />
                  <p class="field-desc">${t('settings.voice.stt.apiKeyDesc')} (OPENAI_API_KEY)</p>
                </div>
                <div class="field-group">
                  <label class="field-label">${t('settings.voice.stt.model')}</label>
                  <select
                    class="select-input"
                    .value=${this.config.tts?.openai?.model || ''}
                    @change=${(e: Event) => this._updateConfig('tts.openai.model', (e.target as HTMLSelectElement).value)}
                  >
                    ${this._voiceModels?.tts?.openai?.length
                      ? this._voiceModels.tts.openai.map(model => html`
                          <option value=${model.id} ?selected=${model.id === this.config.tts?.openai?.model}>${model.name}</option>
                        `)
                      : html`
                          <option value="tts-1">TTS-1</option>
                          <option value="tts-1-hd">TTS-1 HD</option>
                        `}
                  </select>
                </div>
                <div class="field-group">
                  <label class="field-label">${t('settings.voice.tts.voice')}</label>
                  <select
                    class="select-input"
                    .value=${this.config.tts?.openai?.voice || ''}
                    @change=${(e: Event) => this._updateConfig('tts.openai.voice', (e.target as HTMLSelectElement).value)}
                  >
                    ${this._voiceModels?.ttsVoices?.openai?.length
                      ? this._voiceModels.ttsVoices.openai.map(voice => html`
                          <option value=${voice.id} ?selected=${voice.id === this.config.tts?.openai?.voice}>${voice.name}</option>
                        `)
                      : html`
                          <option value="alloy">Alloy</option>
                          <option value="echo">Echo</option>
                        `}
                  </select>
                </div>
              ` : ''}

              ${ttsProvider === 'alibaba' ? html`
                <div class="field-group">
                  <label class="field-label">${t('settings.voice.stt.apiKey')}</label>
                  <input
                    class="text-input"
                    type="password"
                    .value=${this.config.tts?.alibaba?.apiKey || ''}
                    @change=${(e: Event) => this._updateConfig('tts.alibaba.apiKey', (e.target as HTMLInputElement).value)}
                    placeholder="sk-..."
                  />
                  <p class="field-desc">${t('settings.voice.stt.apiKeyDesc')} (DASHSCOPE_API_KEY)</p>
                </div>
                <div class="field-group">
                  <label class="field-label">${t('settings.voice.stt.model')}</label>
                  <select
                    class="select-input"
                    .value=${this.config.tts?.alibaba?.model || ''}
                    @change=${(e: Event) => this._updateConfig('tts.alibaba.model', (e.target as HTMLSelectElement).value)}
                  >
                    ${this._voiceModels?.tts?.alibaba?.length
                      ? this._voiceModels.tts.alibaba.map(model => html`
                          <option value=${model.id} ?selected=${model.id === this.config.tts?.alibaba?.model}>${model.name}</option>
                        `)
                      : html`
                          <option value="qwen-tts">Qwen TTS</option>
                          <option value="qwen3-tts-flash">Qwen3 TTS Flash</option>
                        `}
                  </select>
                </div>
                <div class="field-group">
                  <label class="field-label">${t('settings.voice.tts.voice')}</label>
                  <select
                    class="select-input"
                    .value=${this.config.tts?.alibaba?.voice || ''}
                    @change=${(e: Event) => this._updateConfig('tts.alibaba.voice', (e.target as HTMLSelectElement).value)}
                  >
                    ${this._voiceModels?.ttsVoices?.alibaba?.length
                      ? this._voiceModels.ttsVoices.alibaba.map(voice => html`
                          <option value=${voice.id} ?selected=${voice.id === this.config.tts?.alibaba?.voice}>${voice.name}</option>
                        `)
                      : html`
                          <option value="Cherry">Cherry</option>
                          <option value="longxiaochun">Long Xiao Chun</option>
                        `}
                  </select>
                </div>
              ` : ''}

              ${ttsProvider === 'edge' ? html`
                <div class="field-group">
                  <label class="field-label">${t('settings.voice.tts.voice')}</label>
                  <select
                    class="select-input"
                    .value=${this.config.tts?.edge?.voice || ''}
                    @change=${(e: Event) => this._updateConfig('tts.edge.voice', (e.target as HTMLSelectElement).value)}
                  >
                    ${this._voiceModels?.ttsVoices?.edge?.length
                      ? this._voiceModels.ttsVoices.edge.map(voice => html`
                          <option value=${voice.id} ?selected=${voice.id === this.config.tts?.edge?.voice}>${voice.name}</option>
                        `)
                      : html`
                          <option value="en-US-MichelleNeural">Michelle (US English)</option>
                          <option value="zh-CN-XiaoxiaoNeural">Xiaoxiao (Chinese)</option>
                        `}
                  </select>
                  <p class="field-desc">Microsoft Edge TTS - Free, no API key required</p>
                </div>
              ` : ''}
            </div>
          ` : ''}
        </div>

        <!-- Info -->
        <div class="info-box">
          <p><strong>${t('settings.voice.notes.title')}:</strong> ${t('settings.voice.notes.duration')}</p>
          <p>${t('settings.voice.notes.envVars', { vars: 'DASHSCOPE_API_KEY, OPENAI_API_KEY' })}</p>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'voice-config-section': VoiceConfigSection;
  }
}
