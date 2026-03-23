import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';
import { t } from '../utils/i18n.js';
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
      <div class="section-content">
        <div class="section-header">
          <h2>${t('settings.gatewayEditor.title')}</h2>
          <p class="section-desc">${t('settings.descriptions.gateway')}</p>
        </div>

        ${this.tokenExpired ? html`
          <div class="alert alert-error" role="alert">
            ${getIcon('alertCircle')}
            <span>${t('settings.gatewayEditor.tokenExpired')}</span>
            <div class="alert-actions">
              <button type="button" class="btn btn-secondary btn-sm" @click=${this._openTokenDialog}>
                ${getIcon('refresh')} ${t('settings.gatewayEditor.updateToken')}
              </button>
            </div>
          </div>
        ` : ''}

        <div class="fields-grid">
          <div class="field-group">
            <div class="field-header"><label class="field-label">${t('settings.gatewayEditor.accessToken')}</label></div>
            <div class="input-with-actions">
              <input class="text-input" type="${this._showToken ? 'text' : 'password'}"
                .value=${gw.auth?.token || ''}
                placeholder=${t('settings.gatewayEditor.tokenPlaceholder')}
                @change=${(e: Event) => this._field('gateway.auth.token', (e.target as HTMLInputElement).value)} />
              <div class="input-actions">
                ${gw.auth?.token ? html`
                  <button type="button" class="btn-icon" @click=${this._copyToken} title="${this._copied ? t('settings.tokenCopied') : t('settings.copyToken')}">
                    ${getIcon(this._copied ? 'check' : 'copy')}
                  </button>` : ''}
                <button type="button" class="btn-icon" @click=${this._toggleToken} title="${this._showToken ? t('settings.hideToken') : t('settings.showToken')}">
                  ${getIcon(this._showToken ? 'eyeOff' : 'eye')}
                </button>
              </div>
            </div>
            <p class="field-desc">${t('settings.gatewayEditor.tokenHelp')}</p>
          </div>

          <div class="field-group">
            <button type="button" class="btn btn-secondary" @click=${this._openTokenDialog}>
              ${getIcon('refresh')} ${t('settings.gatewayEditor.changeToken')}
            </button>
          </div>

          <div class="field-group">
            <label class="toggle-label">
              <input class="toggle-input" type="checkbox" .checked=${gw.heartbeat.enabled}
                @change=${(e: Event) => this._field('gateway.heartbeat.enabled', (e.target as HTMLInputElement).checked)} />
              <span class="toggle-switch"></span>
              <span class="toggle-text">${t('settings.gatewayEditor.enableHeartbeat')}</span>
            </label>
          </div>

          <div class="field-group">
            <div class="field-header"><label class="field-label">${t('settings.gatewayEditor.heartbeatInterval')}</label></div>
            <input class="text-input" type="number" .value=${gw.heartbeat.intervalMs}
              @change=${(e: Event) => this._field('gateway.heartbeat.intervalMs', parseInt((e.target as HTMLInputElement).value))} />
          </div>
        </div>
      </div>
    `;
  }
}
