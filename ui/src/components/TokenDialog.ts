import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons';
import { t } from '../utils/i18n';

export interface TokenDialogConfig {
  serverUrl: string;
  onSave: (token: string) => void;
  onCancel?: () => void;
}

@customElement('token-dialog')
export class TokenDialog extends LitElement {
  @property({ attribute: false }) config?: TokenDialogConfig;
  @state() private _token = '';
  @state() private _showToken = false;
  @state() private _loading = false;
  @state() private _error = '';

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  private _handleSave(): void {
    if (!this._token.trim()) {
      this._error = 'Please enter a token';
      return;
    }
    
    const token = this._token.trim();
    
    // Dispatch event for parent components to handle
    window.dispatchEvent(new CustomEvent('token-saved', { detail: { token } }));
    
    // Call the onSave callback
    this.config?.onSave(token);
  }

  private _handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      this._handleSave();
    }
  }

  override render(): unknown {
    return html`
      <div class="token-dialog-overlay" @click=${this._handleOverlayClick}>
        <div class="token-dialog" @click=${(e: Event) => e.stopPropagation()}>
          <div class="token-dialog-header">
            <h3>🔐 Authentication Required</h3>
            <p>Please enter your gateway authentication token to continue.</p>
          </div>

          <div class="token-dialog-body">
            <div class="field-group">
              <label class="field-label">Gateway URL</label>
              <input
                type="text"
                class="text-input"
                .value=${this.config?.serverUrl || ''}
                disabled
              />
            </div>

            <div class="field-group">
              <label class="field-label">Token</label>
              <div class="token-input-wrapper">
                <input
                  type=${this._showToken ? 'text' : 'password'}
                  class="text-input"
                  .value=${this._token}
                  placeholder="Enter your gateway token (e.g., ea4c67bf...)"
                  @input=${(e: Event) => {
                    this._token = (e.target as HTMLInputElement).value;
                    this._error = '';
                  }}
                  @keydown=${this._handleKeydown}
                />
                <button
                  class="btn btn-icon toggle-visibility"
                  @click=${() => this._showToken = !this._showToken}
                  title=${this._showToken ? 'Hide token' : 'Show token'}
                >
                  ${this._showToken ? getIcon('eyeOff') : getIcon('eye')}
                </button>
              </div>
              ${this._error ? html`<span class="field-error">${this._error}</span>` : ''}
            </div>

            <div class="token-hint">
              <p>💡 <strong>How to get your token:</strong></p>
              <ol>
                <li>Run <code>xopcbot gateway token</code> in your terminal</li>
                <li>Or run <code>xopcbot gateway token --generate</code> to create a new one</li>
                <li>Copy the token and paste it here</li>
              </ol>
            </div>
          </div>

          <div class="token-dialog-footer">
            <button
              class="btn btn-primary"
              ?disabled=${this._loading}
              @click=${this._handleSave}
            >
              ${this._loading ? html`
                <span class="spinner-sm"></span>
                Connecting...
              ` : html`
                ${getIcon('check')}
                Connect
              `}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _handleOverlayClick(e: Event): void {
    // Close on overlay click if cancel is allowed
    if (this.config?.onCancel) {
      this.config.onCancel();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'token-dialog': TokenDialog;
  }
}
