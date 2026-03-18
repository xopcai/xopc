import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';
import type { SettingsData } from './types.js';

@customElement('gateway-section')
export class GatewaySection extends LitElement {
  @property({ attribute: false }) settings!: SettingsData;
  @property({ attribute: false }) onChange!: (path: string, value: unknown) => void;
  @property({ type: Boolean }) tokenExpired = false;

  @state() private _showToken = false;
  @state() private _copied = false;

  createRenderRoot() { return this; }

  private _field(path: string, value: unknown) { this.onChange(path, value); }

  private _toggleToken() { this._showToken = !this._showToken; }

  private async _copyToken() {
    const token = this.settings.gateway.auth?.token;
    if (!token) return;
    await navigator.clipboard.writeText(token).catch(() => {});
    this._copied = true;
    setTimeout(() => { this._copied = false; }, 2000);
  }

  private _openTokenDialog() {
    window.dispatchEvent(new CustomEvent('show-token-dialog'));
  }

  override render() {
    const gw = this.settings.gateway;
    return html`
      <div class="settings-section">
        <h3 class="section-title">Gateway Configuration</h3>

        ${this.tokenExpired ? html`
          <div class="alert alert-error" style="margin-bottom:1rem;padding:.75rem;background:#fef2f2;border:1px solid #fecaca;border-radius:.375rem;color:#dc2626;display:flex;align-items:center;gap:.5rem;">
            ${getIcon('alertCircle')}
            <span>Token is invalid or expired. Please update it.</span>
            <button class="btn btn-sm btn-error" @click=${this._openTokenDialog} style="margin-left:auto;">
              ${getIcon('refresh')} Update Token
            </button>
          </div>
        ` : ''}

        <div class="section-content">
          <div class="field-group">
            <div class="field-header"><label class="field-label">Access Token</label></div>
            <div class="input-with-actions">
              <input class="text-input" type="${this._showToken ? 'text' : 'password'}"
                .value=${gw.auth?.token || ''}
                placeholder="Enter access token or leave empty to generate"
                @change=${(e: Event) => this._field('gateway.auth.token', (e.target as HTMLInputElement).value)} />
              <div class="input-actions">
                ${gw.auth?.token ? html`
                  <button class="btn-icon" @click=${this._copyToken} title="${this._copied ? 'Copied!' : 'Copy Token'}">
                    ${getIcon(this._copied ? 'check' : 'copy')}
                  </button>` : ''}
                <button class="btn-icon" @click=${this._toggleToken} title="${this._showToken ? 'Hide' : 'Show'} Token">
                  ${getIcon(this._showToken ? 'eyeOff' : 'eye')}
                </button>
              </div>
            </div>
            <p class="field-desc">Token used to authenticate API requests. Leave empty to auto-generate.</p>
          </div>

          <div class="field-group">
            <button class="btn btn-secondary" @click=${this._openTokenDialog} style="display:inline-flex;align-items:center;gap:.5rem;">
              ${getIcon('refresh')} Change Token
            </button>
          </div>

          <div class="field-group">
            <label class="toggle-label">
              <input class="toggle-input" type="checkbox" .checked=${gw.heartbeat.enabled}
                @change=${(e: Event) => this._field('gateway.heartbeat.enabled', (e.target as HTMLInputElement).checked)} />
              <span class="toggle-switch"></span>
              <span class="toggle-text">Enable Heartbeat</span>
            </label>
          </div>

          <div class="field-group">
            <div class="field-header"><label class="field-label">Heartbeat Interval (ms)</label></div>
            <input class="text-input" type="number" .value=${gw.heartbeat.intervalMs}
              @change=${(e: Event) => this._field('gateway.heartbeat.intervalMs', parseInt((e.target as HTMLInputElement).value))} />
          </div>
        </div>
      </div>
    `;
  }
}
