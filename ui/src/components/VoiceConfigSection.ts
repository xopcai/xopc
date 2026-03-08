/**
 * Voice (STT/TTS) configuration section
 */

import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';
import { t } from '../utils/i18n.js';

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
    provider: 'openai' | 'alibaba';
    trigger: 'auto' | 'never';
    alibaba?: { apiKey?: string; model?: string; voice?: string };
    openai?: { apiKey?: string; model?: string; voice?: string };
  };
}

@customElement('voice-config-section')
export class VoiceConfigSection extends LitElement {
  @property({ attribute: false }) config: VoiceSectionConfig = {};
  @property({ attribute: false }) onChange?: (path: string, value: unknown) => void;

  private _updateConfig(path: string, value: unknown) {
    this.onChange?.(path, value);
  }

  render() {
    const sttEnabled = this.config.stt?.enabled ?? false;
    const ttsEnabled = this.config.tts?.enabled ?? false;
    const sttProvider = this.config.stt?.provider || 'alibaba';
    const ttsProvider = this.config.tts?.provider || 'openai';
    const ttsTrigger = this.config.tts?.trigger || 'auto';

    return html`
      <div class="section-content">
        <div class="section-header">
          <h2>Voice (STT/TTS)</h2>
          <p class="section-desc">Configure speech-to-text and text-to-speech for voice messages</p>
        </div>

        <!-- STT Configuration -->
        <div class="subsection-header">
          <h3>${getIcon('mic')} Speech-to-Text (STT)</h3>
          <p class="subsection-desc">Convert voice messages to text</p>
        </div>

        <div class="fields-grid">
          <!-- STT Enable -->
          <div class="field-group">
            <div class="field-header">
              <label class="field-label">Enable STT</label>
            </div>
            <label class="switch">
              <input
                type="checkbox"
                .checked=${sttEnabled}
                @change=${(e: Event) => this._updateConfig('stt.enabled', (e.target as HTMLInputElement).checked)}
              />
              <span class="switch-slider"></span>
            </label>
            <p class="field-desc">Convert Telegram voice messages to text</p>
          </div>

          ${sttEnabled ? html`
            <!-- STT Provider -->
            <div class="field-group">
              <div class="field-header">
                <label class="field-label">Provider</label>
              </div>
              <select
                class="select-input"
                .value=${sttProvider}
                @change=${(e: Event) => this._updateConfig('stt.provider', (e.target as HTMLSelectElement).value)}
              >
                <option value="alibaba">Alibaba Paraformer (中文推荐)</option>
                <option value="openai">OpenAI Whisper</option>
              </select>
            </div>

            <!-- Alibaba STT Config -->
            ${sttProvider === 'alibaba' ? html`
              <div class="field-group">
                <div class="field-header">
                  <label class="field-label">Alibaba API Key</label>
                </div>
                <input
                  class="text-input"
                  type="password"
                  .value=${this.config.stt?.alibaba?.apiKey || ''}
                  @change=${(e: Event) => this._updateConfig('stt.alibaba.apiKey', (e.target as HTMLInputElement).value)}
                  placeholder="sk-..."
                />
                <p class="field-desc">DashScope API key. Leave empty to use DASHSCOPE_API_KEY env var</p>
              </div>
              <div class="field-group">
                <div class="field-header">
                  <label class="field-label">Model</label>
                </div>
                <select
                  class="select-input"
                  .value=${this.config.stt?.alibaba?.model || 'paraformer-v1'}
                  @change=${(e: Event) => this._updateConfig('stt.alibaba.model', (e.target as HTMLSelectElement).value)}
                >
                  <option value="paraformer-v1">paraformer-v1 (16kHz+)</option>
                  <option value="paraformer-8k-v1">paraformer-8k-v1 (电话)</option>
                  <option value="paraformer-mtl-v1">paraformer-mtl-v1 (多语言)</option>
                </select>
              </div>
            ` : ''}

            <!-- OpenAI STT Config -->
            ${sttProvider === 'openai' ? html`
              <div class="field-group">
                <div class="field-header">
                  <label class="field-label">OpenAI API Key</label>
                </div>
                <input
                  class="text-input"
                  type="password"
                  .value=${this.config.stt?.openai?.apiKey || ''}
                  @change=${(e: Event) => this._updateConfig('stt.openai.apiKey', (e.target as HTMLInputElement).value)}
                  placeholder="sk-..."
                />
                <p class="field-desc">Leave empty to use OPENAI_API_KEY env var</p>
              </div>
              <div class="field-group">
                <div class="field-header">
                  <label class="field-label">Model</label>
                </div>
                <select
                  class="select-input"
                  .value=${this.config.stt?.openai?.model || 'whisper-1'}
                  @change=${(e: Event) => this._updateConfig('stt.openai.model', (e.target as HTMLSelectElement).value)}
                >
                  <option value="whisper-1">whisper-1</option>
                </select>
              </div>
            ` : ''}

            <!-- Fallback -->
            <div class="field-group">
              <div class="field-header">
                <label class="field-label">Enable Fallback</label>
              </div>
              <label class="switch">
                <input
                  type="checkbox"
                  .checked=${this.config.stt?.fallback?.enabled ?? true}
                  @change=${(e: Event) => this._updateConfig('stt.fallback.enabled', (e.target as HTMLInputElement).checked)}
                />
                <span class="switch-slider"></span>
              </label>
              <p class="field-desc">Switch to backup provider on failure</p>
            </div>
          ` : ''}
        </div>

        <!-- TTS Configuration -->
        <div class="subsection-header">
          <h3>${getIcon('volume-2')} Text-to-Speech (TTS)</h3>
          <p class="subsection-desc">Convert agent responses to voice</p>
        </div>

        <div class="fields-grid">
          <!-- TTS Enable -->
          <div class="field-group">
            <div class="field-header">
              <label class="field-label">Enable TTS</label>
            </div>
            <label class="switch">
              <input
                type="checkbox"
                .checked=${ttsEnabled}
                @change=${(e: Event) => this._updateConfig('tts.enabled', (e.target as HTMLInputElement).checked)}
              />
              <span class="switch-slider"></span>
            </label>
            <p class="field-desc">Send voice replies when user sends voice messages</p>
          </div>

          ${ttsEnabled ? html`
            <!-- TTS Trigger -->
            <div class="field-group">
              <div class="field-header">
                <label class="field-label">Trigger Mode</label>
              </div>
              <select
                class="select-input"
                .value=${ttsTrigger}
                @change=${(e: Event) => this._updateConfig('tts.trigger', (e.target as HTMLSelectElement).value)}
              >
                <option value="auto">Auto (reply with voice to voice messages)</option>
                <option value="never">Never (text only)</option>
              </select>
            </div>

            <!-- TTS Provider -->
            <div class="field-group">
              <div class="field-header">
                <label class="field-label">Provider</label>
              </div>
              <select
                class="select-input"
                .value=${ttsProvider}
                @change=${(e: Event) => this._updateConfig('tts.provider', (e.target as HTMLSelectElement).value)}
              >
                <option value="openai">OpenAI TTS</option>
                <option value="alibaba">Alibaba CosyVoice (中文推荐)</option>
              </select>
            </div>

            <!-- OpenAI TTS Config -->
            ${ttsProvider === 'openai' ? html`
              <div class="field-group">
                <div class="field-header">
                  <label class="field-label">OpenAI API Key</label>
                </div>
                <input
                  class="text-input"
                  type="password"
                  .value=${this.config.tts?.openai?.apiKey || ''}
                  @change=${(e: Event) => this._updateConfig('tts.openai.apiKey', (e.target as HTMLInputElement).value)}
                  placeholder="sk-..."
                />
                <p class="field-desc">Leave empty to use OPENAI_API_KEY env var</p>
              </div>
              <div class="field-group">
                <div class="field-header">
                  <label class="field-label">Model</label>
                </div>
                <select
                  class="select-input"
                  .value=${this.config.tts?.openai?.model || 'tts-1'}
                  @change=${(e: Event) => this._updateConfig('tts.openai.model', (e.target as HTMLSelectElement).value)}
                >
                  <option value="tts-1">tts-1 (fast)</option>
                  <option value="tts-1-hd">tts-1-hd (high quality)</option>
                </select>
              </div>
              <div class="field-group">
                <div class="field-header">
                  <label class="field-label">Voice</label>
                </div>
                <select
                  class="select-input"
                  .value=${this.config.tts?.openai?.voice || 'alloy'}
                  @change=${(e: Event) => this._updateConfig('tts.openai.voice', (e.target as HTMLSelectElement).value)}
                >
                  <option value="alloy">Alloy</option>
                  <option value="echo">Echo</option>
                  <option value="fable">Fable</option>
                  <option value="onyx">Onyx</option>
                  <option value="nova">Nova</option>
                  <option value="shimmer">Shimmer</option>
                </select>
              </div>
            ` : ''}

            <!-- Alibaba TTS Config -->
            ${ttsProvider === 'alibaba' ? html`
              <div class="field-group">
                <div class="field-header">
                  <label class="field-label">Alibaba API Key</label>
                </div>
                <input
                  class="text-input"
                  type="password"
                  .value=${this.config.tts?.alibaba?.apiKey || ''}
                  @change=${(e: Event) => this._updateConfig('tts.alibaba.apiKey', (e.target as HTMLInputElement).value)}
                  placeholder="sk-..."
                />
                <p class="field-desc">DashScope API key. Leave empty to use DASHSCOPE_API_KEY env var</p>
              </div>
              <div class="field-group">
                <div class="field-header">
                  <label class="field-label">Model</label>
                </div>
                <select
                  class="select-input"
                  .value=${this.config.tts?.alibaba?.model || 'cosyvoice-v1'}
                  @change=${(e: Event) => this._updateConfig('tts.alibaba.model', (e.target as HTMLSelectElement).value)}
                >
                  <option value="cosyvoice-v1">cosyvoice-v1</option>
                </select>
              </div>
              <div class="field-group">
                <div class="field-header">
                  <label class="field-label">Voice</label>
                </div>
                <input
                  class="text-input"
                  .value=${this.config.tts?.alibaba?.voice || 'longxiaochun'}
                  @change=${(e: Event) => this._updateConfig('tts.alibaba.voice', (e.target as HTMLInputElement).value)}
                  placeholder="longxiaochun"
                />
                <p class="field-desc">Voice ID (e.g., longxiaochun, longcheng)</p>
              </div>
            ` : ''}
          ` : ''}
        </div>

        <!-- Info -->
        <div class="info-box">
          <p><strong>Note:</strong> Voice messages longer than 60 seconds will not be transcribed.</p>
          <p>Environment variables supported: <code>DASHSCOPE_API_KEY</code>, <code>OPENAI_API_KEY</code></p>
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