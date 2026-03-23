/**
 * Provider config component with API key input and OAuth login support.
 * Clean and simple design with clear visual hierarchy.
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

/** Matches GET /api/config masked keys and legacy UI placeholder */
function isMaskedApiKey(value: string): boolean {
  return value === '***' || value === '••••••••••••';
}

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
  /** Stacked list inside provider-list: shared borders between rows */
  @property({ type: String }) listSegment: 'single' | 'first' | 'mid' | 'last' = 'single';
  
  @state() private _showKey: boolean = false;
  @state() private _copied: boolean = false;
  @state() private _loading: boolean = false;
  @state() private _oauthStatus?: 'idle' | 'waiting' | 'waiting_code' | 'success' | 'error';
  @state() private _oauthMessage?: string;
  @state() private _sessionId?: string;
  @state() private _authUrl?: string;
  @state() private _oauthInstructions?: string;
  @state() private _pollingInterval?: number;
  @state() private _expanded: boolean = false;
  
  static styles = css`
    :host { display: block; }

    .provider-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: var(--card-bg, #ffffff);
      border-style: solid;
      border-color: var(--border-default, #e2e8f0);
      transition: background var(--transition-fast, 150ms) ease,
        border-color var(--transition-fast, 150ms) ease;
    }

    .provider-row:hover {
      background: var(--hover-bg, #f8fafc);
    }

    .provider-row.seg-single {
      border-width: 1px;
      border-radius: var(--radius-lg, 0.75rem);
    }

    .provider-row.seg-first {
      border-width: 1px 1px 0 1px;
      border-radius: var(--radius-lg, 0.75rem) var(--radius-lg, 0.75rem) 0 0;
      border-bottom: 1px solid var(--border-subtle, #f1f5f9);
    }

    .provider-row.seg-mid {
      border-width: 0 1px 0 1px;
      border-bottom: 1px solid var(--border-subtle, #f1f5f9);
      border-radius: 0;
    }

    .provider-row.seg-last {
      border-width: 0 1px 1px 1px;
      border-radius: 0 0 var(--radius-lg, 0.75rem) var(--radius-lg, 0.75rem);
    }

    .provider-row.expanded {
      flex-direction: column;
      align-items: stretch;
    }

    /* Provider Info Section */
    .provider-main {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex: 1;
      min-width: 0;
    }

    .provider-icon {
      width: 2rem;
      height: 2rem;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--border-subtle, #f1f5f9);
      border-radius: var(--radius-md, 0.5rem);
      flex-shrink: 0;
    }

    .provider-icon svg {
      width: 1rem;
      height: 1rem;
      color: var(--text-secondary, #64748b);
    }

    .provider-details {
      flex: 1;
      min-width: 0;
    }

    .provider-name {
      font-weight: 600;
      font-size: 0.875rem;
      line-height: 1.25rem;
      color: var(--text-primary, #0f172a);
      margin-bottom: 0.125rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .provider-category-tag {
      font-size: 0.625rem;
      line-height: 1rem;
      padding: 0.0625rem 0.375rem;
      border-radius: var(--radius-xs, 0.25rem);
      background: var(--border-subtle, #f1f5f9);
      color: var(--text-secondary, #64748b);
      text-transform: uppercase;
      letter-spacing: 0.025em;
      font-weight: 500;
    }

    .provider-meta {
      font-size: 0.75rem;
      line-height: 1.125rem;
      color: var(--text-secondary, #64748b);
    }

    /* Expand Button */
    .expand-btn {
      padding: 0.375rem;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: var(--radius-sm, 0.375rem);
      color: var(--text-disabled, #94a3b8);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--transition-fast, 150ms);
      flex-shrink: 0;
    }

    .expand-btn:hover {
      background: var(--border-subtle, #f1f5f9);
      color: var(--text-primary, #0f172a);
    }

    .expand-btn svg {
      width: 16px;
      height: 16px;
      transition: transform 150ms;
    }

    .expand-btn.expanded svg {
      transform: rotate(180deg);
    }

    /* Expanded Content */
    .provider-expanded {
      width: 100%;
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--border-subtle, #f1f5f9);
    }

    /* Input Section */
    .input-section {
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
      padding: 0.5rem 0.75rem;
      padding-right: 4rem;
      border: 1px solid var(--border-default, #e2e8f0);
      border-radius: var(--radius-md, 0.5rem);
      font-size: 0.8125rem;
      line-height: 1.25rem;
      font-family: var(--font-mono, monospace);
      background: var(--card-bg, #ffffff);
      color: var(--text-primary, #0f172a);
      transition: all var(--transition-fast, 150ms);
      box-sizing: border-box;
    }

    .api-key-input:focus {
      outline: none;
      border-color: var(--accent-primary, #2563eb);
      box-shadow: 0 0 0 1px var(--accent-primary, #2563eb);
    }

    .api-key-input::placeholder {
      color: var(--text-disabled, #94a3b8);
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
      border-radius: 0.375rem;
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
      width: 14px;
      height: 14px;
    }

    .btn-oauth {
      padding: 0.5rem 0.875rem;
      border: 1px solid var(--accent-primary, #2563eb);
      background: transparent;
      color: var(--accent-primary, #2563eb);
      border-radius: 0.5rem;
      font-size: 0.75rem;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.375rem;
      white-space: nowrap;
      transition: all var(--transition-fast, 150ms);
      flex-shrink: 0;
    }

    .btn-oauth:hover {
      background: var(--accent-primary, #2563eb);
      color: white;
    }

    .btn-oauth:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-oauth.revoke {
      border-color: var(--accent-error, #dc2626);
      color: var(--accent-error, #dc2626);
    }

    .btn-oauth.revoke:hover {
      background: var(--accent-error, #dc2626);
      color: white;
    }

    /* Help Text */
    .help-text {
      margin-top: 0.625rem;
      font-size: 0.75rem;
      color: var(--text-muted, #a8a29e);
      display: flex;
      align-items: flex-start;
      gap: 0.375rem;
      line-height: 1.4;
    }

    .help-text svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      margin-top: 0.125rem;
    }

    .help-text.error-text {
      color: var(--accent-error, #dc2626);
      background: var(--accent-error-light, #fee2e2);
      padding: 0.5rem 0.625rem;
      border-radius: 0.375rem;
    }

    .help-text.env-text {
      color: var(--text-muted, #a8a29e);
      background: var(--bg-secondary, #f5f5f4);
      padding: 0.5rem 0.625rem;
      border-radius: 0.375rem;
      border: 1px dashed var(--border-color, #e7e5e4);
    }

    /* Spinner */
    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid var(--border-color, #e7e5e4);
      border-top-color: var(--accent-primary, #2563eb);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* OAuth Actions */
    .oauth-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.75rem;
      flex-wrap: wrap;
    }

    .btn {
      padding: 0.5rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.375rem;
      transition: all var(--transition-fast, 150ms);
      text-decoration: none;
    }

    .btn-primary {
      background: var(--accent-primary, #2563eb);
      color: white;
      border: none;
    }

    .btn-primary:hover {
      background: var(--accent-primary-hover, #1d4ed8);
    }

    .btn-secondary {
      background: transparent;
      border: 1px solid var(--border-color, #e7e5e4);
      color: var(--text-primary, #1c1917);
    }

    .btn-secondary:hover {
      background: var(--bg-secondary, #f5f5f4);
    }

    /* Code Input */
    .code-input {
      margin-top: 0.75rem;
      display: flex;
      gap: 0.5rem;
    }

    .code-input input {
      flex: 1;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--border-color, #e7e5e4);
      border-radius: 0.5rem;
      font-size: 0.8125rem;
      background: var(--bg-primary, #fafaf9);
      color: var(--text-primary, #1c1917);
    }

    .code-input input:focus {
      outline: none;
      border-color: var(--accent-primary, #4f46e5);
    }

    .code-input input::placeholder {
      color: var(--text-muted, #a8a29e);
    }

    /* Responsive */
    @media (max-width: 640px) {
      .provider-row {
        flex-wrap: wrap;
      }

      .provider-main {
        flex: 1 1 calc(100% - 60px);
      }

      .input-section {
        flex-direction: column;
      }

      .btn-oauth {
        width: 100%;
        justify-content: center;
      }
    }
  `;

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopPolling();
    if (this._sessionId) {
      cleanupOAuthSession(this._sessionId, this.token).catch(() => {});
    }
  }

  private _toggleExpand() {
    this._expanded = !this._expanded;
  }
  
  private _emitApiKey(target: HTMLInputElement) {
    this.dispatchEvent(new CustomEvent<ProviderConfigChangeEvent>('change', {
      detail: { provider: this.provider, apiKey: target.value },
      bubbles: true,
      composed: true,
    }));
  }

  private _onApiKeyInput(e: Event) {
    this._emitApiKey(e.target as HTMLInputElement);
  }

  private _onApiKeyChange(e: Event) {
    this._emitApiKey(e.target as HTMLInputElement);
  }
  
  private async _onOAuthClick() {
    this._loading = true;
    this._oauthStatus = 'waiting';
    this._oauthMessage = 'Starting OAuth login...';
    this._sessionId = undefined;
    this._authUrl = undefined;
    this._oauthInstructions = undefined;
    
    try {
      const result = await startAsyncOAuthLogin(this.provider, this.token);
      this._sessionId = result.sessionId;
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
        const prevAuthUrl = this._authUrl;

        this._oauthMessage = status.message;
        this._authUrl = status.authUrl;
        this._oauthInstructions = status.instructions;

        if (status.status === 'waiting_auth' || status.status === 'waiting_code') {
          this._oauthStatus = status.status === 'waiting_code' ? 'waiting_code' : 'waiting';

          if (status.authUrl && status.authUrl !== prevAuthUrl) {
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
    }, 1000);
  }

  private _stopPolling() {
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = undefined;
    }
  }

  private async _onSubmitCode(code: string) {
    const trimmed = code.trim();
    if (!this._sessionId || !trimmed) return;

    try {
      await submitOAuthCode(this._sessionId, trimmed, this.token);
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
      this._authUrl = undefined;
      this._oauthInstructions = undefined;
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
    const isMasked = isMaskedApiKey(this.apiKey);
    const inputValue = isMasked && !this._showKey ? '' : this.apiKey;
    const isOAuthConfigured = this.configured && !isMasked;
    
    return html`
      <div class="provider-row ${this._expanded ? 'expanded' : ''} seg-${this.listSegment}">
        <div class="provider-main">
          <div class="provider-icon">
            ${this.configured ? getIcon('checkCircle') : getIcon('key')}
          </div>
          
          <div class="provider-details">
            <div class="provider-name">
              ${this.displayName || this.provider}
              <span class="provider-category-tag">${this.category}</span>
            </div>
            <div class="provider-meta">
              ${this.configured
                ? (isMasked
                  ? 'Credential on file — enter a new key to replace'
                  : 'API key will be saved with Save changes')
                : 'Not configured'}
            </div>
          </div>
          
          <button 
            class="expand-btn ${this._expanded ? 'expanded' : ''}"
            @click=${this._toggleExpand}
            title="${this._expanded ? 'Collapse' : 'Configure'}"
          >
            ${getIcon('chevronDown')}
          </button>
        </div>
        
        ${this._expanded ? html`
          <div class="provider-expanded">
            <div class="input-section">
              <div class="input-wrapper">
                <input
                  class="api-key-input"
                  type="${this._showKey ? 'text' : 'password'}"
                  .value=${inputValue}
                  placeholder="${isMasked ? 'Enter new key to override' : (this.configured ? 'Leave empty to keep current' : 'API key')}"
                  @input=${this._onApiKeyInput}
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
                        class="btn-oauth revoke" 
                        @click=${this._onRevokeOAuth}
                        ?disabled=${this._loading}
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
                          ? html`<span class="spinner"></span>` 
                          : html`${getIcon('logIn')} OAuth`
                        }
                      </button>
                    `
                }
              ` : ''}
            </div>

            ${this._oauthMessage ? html`
              <div class="help-text ${this._oauthStatus === 'error' ? 'error-text' : ''}">
                ${this._oauthStatus === 'success' ? getIcon('checkCircle') : (this._oauthStatus === 'error' ? getIcon('alertCircle') : getIcon('info'))}
                <span>${this._oauthMessage}</span>
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
                    ${getIcon('externalLink')} Open Auth Page
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

            ${this._oauthInstructions ? html`
              <div class="help-text oauth-instructions">
                ${getIcon('info')}
                <span>${this._oauthInstructions}</span>
              </div>
            ` : ''}

            ${this._oauthStatus === 'waiting_code' ? html`
              <div class="help-text oauth-instructions">
                ${getIcon('info')}
                <span>
                  After Google redirects your browser, copy the full address bar URL (it should contain <code>code=</code> and <code>state=</code>) and paste it below.
                  If the gateway runs on another machine, the browser may open there — you must paste the redirect URL here so this server can finish the login.
                </span>
              </div>
              <div class="code-input">
                <input 
                  id="oauthCodeInput"
                  type="text" 
                  placeholder="Paste full redirect URL (http://127.0.0.1:.../oauth-callback?code=...&state=...)"
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
                    const input = this.renderRoot.querySelector('#oauthCodeInput') as HTMLInputElement | null;
                    if (input?.value?.trim()) {
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
              <div class="help-text env-text">
                ${getIcon('info')} API key is set via environment variable. Enter a new key above to override.
              </div>
            ` : ''}
            ${this.supportsOAuth && !isMasked && !isOAuthConfigured ? html`
              <div class="help-text">
                ${getIcon('info')} Use OAuth for secure authentication, or enter API key manually.
              </div>
            ` : ''}
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
