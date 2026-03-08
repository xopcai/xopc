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
  @state() private _oauthStatus?: 'idle' | 'waiting' | 'waiting_code' | 'success' | 'error';
  @state() private _oauthMessage?: string;
  @state() private _sessionId?: string;
  @state() private _authUrl?: string;
  @state() private _pollingInterval?: number;
  @state() private _expanded: boolean = false;
  
  static styles = css`
    :host { display: block; }

    .provider-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.875rem 1rem;
      background: var(--background, #ffffff);
      border: 1px solid var(--border, #e2e8f0);
      border-radius: 0.5rem;
      transition: all var(--transition-fast, 150ms) ease;
    }

    .provider-row:hover {
      border-color: var(--primary, #3b82f6);
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.08);
    }

    .provider-row.configured {
      border-left: 3px solid var(--accent-success, #059669);
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
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--muted, #f1f5f9);
      border-radius: 0.5rem;
      flex-shrink: 0;
    }

    .provider-icon svg {
      width: 18px;
      height: 18px;
      color: var(--muted-foreground, #64748b);
    }

    .provider-icon.configured svg {
      color: var(--accent-success, #059669);
    }

    .provider-details {
      flex: 1;
      min-width: 0;
    }

    .provider-name {
      font-weight: 600;
      font-size: 0.875rem;
      color: var(--foreground, #0f172a);
      margin-bottom: 0.125rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .provider-category-tag {
      font-size: 0.625rem;
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      background: var(--muted, #f1f5f9);
      color: var(--muted-foreground, #64748b);
      text-transform: uppercase;
      letter-spacing: 0.3px;
      font-weight: 500;
    }

    .provider-category-tag.oauth { 
      background: rgba(245, 158, 11, 0.1); 
      color: #d97706; 
    }
    
    .provider-category-tag.enterprise { 
      background: rgba(139, 92, 246, 0.1); 
      color: #8b5cf6; 
    }
    
    .provider-category-tag.specialty { 
      background: rgba(6, 182, 212, 0.1); 
      color: #0891b2; 
    }

    .provider-meta {
      font-size: 0.75rem;
      color: var(--muted-foreground, #64748b);
    }

    /* Status Indicator */
    .status-indicator {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.25rem 0.625rem;
      border-radius: 9999px;
      font-size: 0.6875rem;
      font-weight: 500;
      flex-shrink: 0;
    }

    .status-indicator.configured {
      background: var(--accent-success-light, #d1fae5);
      color: var(--accent-success, #059669);
    }

    .status-indicator.not-configured {
      background: var(--muted, #f1f5f9);
      color: var(--muted-foreground, #94a3b8);
    }

    .status-indicator svg {
      width: 12px;
      height: 12px;
    }

    /* Expand Button */
    .expand-btn {
      padding: 0.375rem;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: 0.375rem;
      color: var(--muted-foreground, #64748b);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--transition-fast, 150ms);
      flex-shrink: 0;
    }

    .expand-btn:hover {
      background: var(--muted, #f1f5f9);
      color: var(--foreground, #0f172a);
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
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border, #e2e8f0);
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
      border: 1px solid var(--border, #e2e8f0);
      border-radius: 0.5rem;
      font-size: 0.8125rem;
      font-family: var(--font-mono, monospace);
      background: var(--background, #ffffff);
      color: var(--foreground, #0f172a);
      transition: all var(--transition-fast, 150ms);
      box-sizing: border-box;
    }

    .api-key-input:focus {
      outline: none;
      border-color: var(--primary, #3b82f6);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    .api-key-input::placeholder {
      color: var(--muted-foreground, #94a3b8);
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
      color: var(--muted-foreground, #64748b);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--transition-fast, 150ms);
      flex-shrink: 0;
    }

    .btn-icon:hover {
      background: var(--muted, #f1f5f9);
      color: var(--foreground, #0f172a);
    }

    .btn-icon svg {
      width: 14px;
      height: 14px;
    }

    .btn-oauth {
      padding: 0.5rem 0.875rem;
      border: 1px solid var(--primary, #3b82f6);
      background: transparent;
      color: var(--primary, #3b82f6);
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
      background: var(--primary, #3b82f6);
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
      color: var(--muted-foreground, #64748b);
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
      background: rgba(254, 226, 226, 0.5);
      padding: 0.5rem 0.625rem;
      border-radius: 0.375rem;
    }

    .help-text.env-text {
      color: var(--muted-foreground, #64748b);
      background: var(--muted, #f8fafc);
      padding: 0.5rem 0.625rem;
      border-radius: 0.375rem;
      border: 1px dashed var(--border, #e2e8f0);
    }

    /* Spinner */
    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid var(--border, #e2e8f0);
      border-top-color: var(--primary, #3b82f6);
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
      background: var(--primary, #3b82f6);
      color: white;
      border: none;
    }

    .btn-primary:hover {
      background: var(--primary-dark, #2563eb);
    }

    .btn-secondary {
      background: transparent;
      border: 1px solid var(--border, #e2e8f0);
      color: var(--foreground, #0f172a);
    }

    .btn-secondary:hover {
      background: var(--muted, #f1f5f9);
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
      border: 1px solid var(--border, #e2e8f0);
      border-radius: 0.5rem;
      font-size: 0.8125rem;
      background: var(--background, #ffffff);
      color: var(--foreground, #0f172a);
    }

    .code-input input:focus {
      outline: none;
      border-color: var(--primary, #3b82f6);
    }

    .code-input input::placeholder {
      color: var(--muted-foreground, #94a3b8);
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
        
        this._oauthMessage = status.message;
        this._authUrl = status.authUrl;
        
        if (status.status === 'waiting_auth' || status.status === 'waiting_code') {
          this._oauthStatus = status.status === 'waiting_code' ? 'waiting_code' : 'waiting';
          
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
      <div class="provider-row ${this.configured ? 'configured' : ''} ${this._expanded ? 'expanded' : ''}">
        <div class="provider-main">
          <div class="provider-icon ${this.configured ? 'configured' : ''}">
            ${this.configured ? getIcon('checkCircle') : getIcon('key')}
          </div>
          
          <div class="provider-details">
            <div class="provider-name">
              ${this.displayName || this.provider}
              <span class="provider-category-tag ${categoryClass}">${this.category}</span>
            </div>
            <div class="provider-meta">
              ${isMasked 
                ? 'Configured via environment variable' 
                : (this.configured ? 'API key configured' : 'Not configured')
              }
            </div>
          </div>
          
          <div class="status-indicator ${this.configured ? 'configured' : 'not-configured'}">
            ${this.configured 
              ? html`${getIcon('check')} Configured` 
              : html`${getIcon('circle')} Not set`
            }
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

            ${this._oauthStatus === 'waiting_code' ? html`
              <div class="code-input">
                <input 
                  type="text" 
                  placeholder="Paste redirect URL or code..."
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
