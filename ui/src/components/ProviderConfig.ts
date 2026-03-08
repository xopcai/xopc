/**
 * Provider config component with API key input and OAuth login support.
 */

import { html, LitElement, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';
import { 
  startAsyncOAuthLogin, 
  fetchOAuthSessionStatus, 
  submitOAuthCode, 
  cancelOAuth,
  cleanupOAuthSession,
  revokeOAuth 
} from '../utils/oauth-api.js';

export interface ProviderConfigChangeEvent {
  provider: string;
  apiKey: string;
}

export interface ProviderOAuthEvent {
  provider: string;
  success: boolean;
  message?: string;
  error?: string;
}

@customElement('provider-config')
export class ProviderConfig extends LitElement {
  @property({ type: String }) provider!: string;
  @property({ type: String }) apiKey: string = '';
  @property({ type: Boolean }) configured: boolean = false;
  @property({ type: Boolean }) supportsOAuth: boolean = false;
  @property({ type: String }) displayName: string = '';
  @property({ type: String }) category: string = 'common';
  @property({ type: String }) token?: string;
  
  @state() private _showKey: boolean = false;
  @state() private _copied: boolean = false;
  @state() private _loading: boolean = false;
  @state() private _localValue: string = '';
  @state() private _oauthStatus?: 'idle' | 'waiting' | 'waiting_code' | 'success' | 'error';
  @state() private _oauthMessage?: string;
  @state() private _sessionId?: string;
  @state() private _authUrl?: string;
  @state() private _pollingInterval?: number;
  
  static styles = css`
    :host { display: block; }

    .provider-item {
      background: var(--bg-secondary, #f5f5f4);
      border: 1px solid var(--border-color, #e7e5e4);
      border-radius: var(--radius-md, 0.5rem);
      padding: 1rem;
      margin-bottom: 0.75rem;
      transition: all var(--transition-fast, 150ms) ease;
    }

    .provider-item:hover { border-color: var(--accent-primary, #4f46e5); }
    .provider-item.configured { border-left: 3px solid var(--accent-success, #059669); }

    .provider-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.75rem;
    }

    .provider-name {
      font-weight: 600;
      font-size: 0.875rem;
      color: var(--text-primary, #1c1917);
    }

    .provider-category {
      font-size: 0.6875rem;
      padding: 0.125rem 0.5rem;
      border-radius: var(--radius-sm, 0.375rem);
      background: var(--text-muted, #a8a29e);
      color: white;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .provider-category.oauth { background: #f59e0b; }
    .provider-category.enterprise { background: #8b5cf6; }
    .provider-category.specialty { background: #06b6d4; }

    .badge {
      font-size: 0.75rem;
      padding: 0.125rem 0.5rem;
      border-radius: var(--radius-sm, 0.375rem);
      background: var(--bg-tertiary, #e7e5e4);
      color: var(--text-secondary, #57534e);
    }

    .badge.success {
      background: var(--accent-success-light, #d1fae5);
      color: var(--accent-success, #059669);
    }

    .provider-input {
      display: flex;
      gap: 0.5rem;
      align-items: stretch;
    }

    .input-wrapper {
      flex: 1;
      position: relative;
      display: flex;
      align-items: center;
    }

    .api-key-input {
      width: 100%;
      height: 100%;
      padding: 0.5rem 0.75rem;
      padding-right: 4.5rem;
      border: 1px solid var(--border-color, #e7e5e4);
      border-radius: var(--radius-md, 0.5rem);
      font-size: 0.8125rem;
      font-family: var(--font-mono, monospace);
      background: var(--bg-primary, #fafaf9);
      color: var(--text-primary, #1c1917);
      transition: all var(--transition-fast, 150ms);
      box-sizing: border-box;
    }

    .api-key-input:focus {
      outline: none;
      border-color: var(--accent-primary, #4f46e5);
      box-shadow: 0 0 0 2px var(--accent-primary-light, #e0e7ff);
    }

    .input-actions {
      position: absolute;
      right: 0.25rem;
      display: flex;
      gap: 0.125rem;
      align-items: center;
    }

    .btn-icon {
      padding: 0.375rem;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: var(--radius-sm, 0.375rem);
      color: var(--text-muted, #a8a29e);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--transition-fast, 150ms);
      flex-shrink: 0;
    }

    .btn-icon:hover {
      background: var(--bg-secondary, #f5f5f4);
      color: var(--text-primary, #1c1917);
    }

    .btn-icon svg {
      width: 16px;
      height: 16px;
    }

    .btn-oauth {
      padding: 0.5rem 1rem;
      border: 1px solid var(--accent-primary, #4f46e5);
      background: transparent;
      color: var(--accent-primary, #4f46e5);
      border-radius: var(--radius-md, 0.5rem);
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.375rem;
      white-space: nowrap;
      transition: all var(--transition-fast, 150ms);
    }

    .btn-oauth:hover {
      background: var(--accent-primary, #4f46e5);
      color: white;
    }

    .btn-oauth:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .help-text {
      margin-top: 0.5rem;
      font-size: 0.75rem;
      color: var(--text-secondary, #57534e);
      display: flex;
      align-items: center;
      gap: 0.375rem;
      white-space: pre-line;
    }

    .help-text.error-text {
      color: var(--accent-error, #dc2626);
      background: var(--accent-error-light, #fee2e2);
      padding: 0.5rem;
      border-radius: var(--radius-md, 0.5rem);
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid var(--border-color, #e7e5e4);
      border-top-color: var(--accent-primary, #4f46e5);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .oauth-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }

    .btn {
      padding: 0.5rem 1rem;
      border-radius: var(--radius-md, 0.5rem);
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.375rem;
      transition: all var(--transition-fast, 150ms);
    }

    .btn-primary {
      background: var(--accent-primary, #4f46e5);
      color: white;
      border: none;
    }

    .btn-primary:hover {
      background: var(--accent-primary-dark, #4338ca);
    }

    .btn-secondary {
      background: transparent;
      border: 1px solid var(--border-color, #e7e5e4);
      color: var(--text-secondary, #57534e);
    }

    .btn-secondary:hover {
      background: var(--bg-secondary, #f5f5f4);
    }

    .code-input {
      margin-top: 0.75rem;
      display: flex;
      gap: 0.5rem;
    }

    .code-input input {
      flex: 1;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--border-color, #e7e5e4);
      border-radius: var(--radius-md, 0.5rem);
      font-size: 0.8125rem;
    }
  `;
  
  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopPolling();
    if (this._sessionId) {
      cleanupOAuthSession(this._sessionId, this.token).catch(() => {});
    }
  }
  
  private _onApiKeyChange(e: Event) {
    const target = e.target as HTMLInputElement;
    this.dispatchEvent(new CustomEvent<ProviderConfigChangeEvent>('change', {
      detail: { provider: this.provider, apiKey: target.value },
      bubbles: true,
      composed: true,
    }));
  }
  
  private async _onOAuthClick() {
    this._loading = true;
    this._oauthStatus = 'waiting';
    this._oauthMessage = 'Starting OAuth login...';
    this._sessionId = undefined;
    
    try {
      // Start async OAuth flow
      const result = await startAsyncOAuthLogin(this.provider, this.token);
      this._sessionId = result.sessionId;
      
      // Start polling for status
      this._startPolling();
    } catch (err) {
      this._oauthStatus = 'error';
      this._oauthMessage = err instanceof Error ? err.message : 'OAuth login failed';
      this._loading = false;
      
      this.dispatchEvent(new CustomEvent<ProviderOAuthEvent>('oauth', {
        detail: { provider: this.provider, success: false, error: this._oauthMessage },
        bubbles: true,
        composed: true,
      }));
    }
  }

  private _startPolling() {
    this._pollingInterval = window.setInterval(async () => {
      if (!this._sessionId) return;

      try {
        const status = await fetchOAuthSessionStatus(this._sessionId, this.token);
        
        this._oauthMessage = status.message;
        this._authUrl = status.authUrl;
        
        if (status.status === 'waiting_auth' || status.status === 'waiting_code') {
          this._oauthStatus = status.status === 'waiting_code' ? 'waiting_code' : 'waiting';
          
          // Open auth URL if available
          if (status.authUrl && !this._authUrl) {
            window.open(status.authUrl, '_blank');
          }
        } else if (status.status === 'completed') {
          this._stopPolling();
          this._oauthStatus = 'success';
          this._loading = false;
          
          this.dispatchEvent(new CustomEvent<ProviderOAuthEvent>('oauth', {
            detail: { provider: this.provider, success: true, message: status.message },
            bubbles: true,
            composed: true,
          }));
          
          // Reload page after short delay
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } else if (status.status === 'failed' || status.status === 'cancelled') {
          this._stopPolling();
          this._oauthStatus = 'error';
          this._loading = false;
          this._oauthMessage = status.error || status.message || 'OAuth flow failed';
          
          this.dispatchEvent(new CustomEvent<ProviderOAuthEvent>('oauth', {
            detail: { provider: this.provider, success: false, error: this._oauthMessage },
            bubbles: true,
            composed: true,
          }));
        }
      } catch (err) {
        console.error('Failed to poll OAuth status:', err);
      }
    }, 1000); // Poll every second
  }

  private _stopPolling() {
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = undefined;
    }
  }

  private async _onSubmitCode(code: string) {
    if (!this._sessionId || !code) return;

    try {
      await submitOAuthCode(this._sessionId, code, this.token);
      this._oauthMessage = 'Processing authorization code...';
    } catch (err) {
      this._oauthStatus = 'error';
      this._oauthMessage = err instanceof Error ? err.message : 'Failed to submit code';
    }
  }

  private async _onCancelOAuth() {
    if (!this._sessionId) return;

    try {
      await cancelOAuth(this._sessionId, this.token);
      this._stopPolling();
      this._oauthStatus = 'idle';
      this._loading = false;
      this._oauthMessage = 'OAuth cancelled';
      this._sessionId = undefined;
    } catch (err) {
      console.error('Failed to cancel OAuth:', err);
    }
  }
  
  private _onRevokeOAuth() {
    if (confirm(`Revoke OAuth credentials for ${this.displayName}?`)) {
      revokeOAuth(this.provider, this.token).then(() => {
        window.location.reload();
      }).catch(err => {
        alert(`Failed to revoke: ${err instanceof Error ? err.message : 'Unknown error'}`);
      });
    }
  }
  
  private async _copyToClipboard() {
    if (!this.apiKey) return;
    
    try {
      await navigator.clipboard.writeText(this.apiKey);
      this._copied = true;
      setTimeout(() => {
        this._copied = false;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }
  
  render() {
    const categoryClass = this.category.toLowerCase();
    const isMasked = this.apiKey === '••••••••••••';
    const inputValue = isMasked && !this._showKey ? '' : this.apiKey;
    const isOAuthConfigured = this.configured && !isMasked;
    
    return html`
      <div class="provider-item ${this.configured ? 'configured' : ''}">
        <div class="provider-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="provider-name">${this.displayName || this.provider}</span>
            <span class="provider-category ${categoryClass}">${this.category}</span>
          </div>
          ${this.configured 
            ? html`<span class="badge success">${getIcon('check')} Configured</span>` 
            : html`<span class="badge">Not configured</span>`
          }
        </div>
        
        <div class="provider-input">
          <div class="input-wrapper">
            <input
              class="api-key-input"
              type="${this._showKey ? 'text' : 'password'}"
              .value=${inputValue}
              placeholder="${isMasked ? 'Configured via environment variable' : (this.configured ? 'Configured (leave empty to keep)' : 'sk-...')}"
              @change=${this._onApiKeyChange}
              ?disabled=${this._loading}
            />
            <div class="input-actions">
              ${this.apiKey && !isMasked ? html`
                <button 
                  class="btn-icon" 
                  @click=${this._copyToClipboard}
                  title="${this._copied ? 'Copied!' : 'Copy API Key'}"
                >
                  ${getIcon(this._copied ? 'check' : 'copy')}
                </button>
              ` : ''}
              <button 
                class="btn-icon" 
                @click=${() => this._showKey = !this._showKey}
                title="${this._showKey ? 'Hide' : 'Show'} API Key"
                ?disabled=${isMasked}
              >
                ${getIcon(this._showKey ? 'eyeOff' : 'eye')}
              </button>
            </div>
          </div>
          
          ${this.supportsOAuth ? html`
            ${isOAuthConfigured
              ? html`
                  <button 
                    class="btn-oauth" 
                    @click=${this._onRevokeOAuth}
                    ?disabled=${this._loading}
                    style="border-color: var(--accent-error, #dc2626); color: var(--accent-error, #dc2626);"
                  >
                    ${getIcon('logOut')} Revoke
                  </button>
                `
              : html`
                  <button 
                    class="btn-oauth" 
                    @click=${this._onOAuthClick}
                    ?disabled=${this._loading}
                  >
                    ${this._loading 
                      ? html`<span class="spinner"></span> Processing...` 
                      : html`${getIcon('externalLink')} OAuth Login`
                    }
                  </button>
                `
            }
          ` : ''}
        </div>

        ${this._oauthMessage ? html`
          <div class="help-text ${this._oauthStatus === 'error' ? 'error-text' : ''}">
            ${this._oauthStatus === 'success' ? getIcon('check') : (this._oauthStatus === 'error' ? getIcon('alertCircle') : getIcon('info'))}
            ${this._oauthMessage}
          </div>
        ` : ''}

        ${this._oauthStatus === 'waiting' || this._oauthStatus === 'waiting_code' ? html`
          <div class="oauth-actions">
            ${this._authUrl ? html`
              <a 
                class="btn btn-primary" 
                href="${this._authUrl}" 
                target="_blank"
                rel="noopener noreferrer"
              >
                ${getIcon('externalLink')} Open Authorization Page
              </a>
            ` : ''}
            <button 
              class="btn btn-secondary" 
              @click=${this._onCancelOAuth}
            >
              ${getIcon('x')} Cancel
            </button>
          </div>
        ` : ''}

        ${this._oauthStatus === 'waiting_code' ? html`
          <div class="code-input">
            <input 
              type="text" 
              placeholder="Paste redirect URL or authorization code..."
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  const input = e.target as HTMLInputElement;
                  this._onSubmitCode(input.value);
                  input.value = '';
                }
              }}
            />
            <button 
              class="btn btn-primary"
              @click=${() => {
                const input = this.shadowRoot?.querySelector('.code-input input') as HTMLInputElement;
                if (input?.value) {
                  this._onSubmitCode(input.value);
                  input.value = '';
                }
              }}
            >
              Submit
            </button>
          </div>
        ` : ''}
        
        ${isMasked ? html`
          <div class="help-text">
            ${getIcon('info')} API key is configured via environment variable and cannot be displayed.
            Enter a new key above to override, or leave empty to keep the current configuration.
          </div>
        ` : ''}
        ${this.supportsOAuth && !isMasked && !isOAuthConfigured ? html`
          <div class="help-text">
            This provider supports OAuth login. Click "OAuth Login" to authenticate via browser, 
            or enter an API key manually above.
          </div>
        ` : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'provider-config': ProviderConfig;
  }
}
