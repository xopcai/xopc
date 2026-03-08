/**
 * Provider config component with API key input and OAuth login support.
 */

import { html, LitElement, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';
import { startOAuthLogin, revokeOAuth } from '../utils/oauth-api.js';

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
  @state() private _oauthStatus?: 'idle' | 'waiting' | 'success' | 'error';
  @state() private _oauthMessage?: string;
  
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
  `;
  
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
    
    try {
      const result = await startOAuthLogin(this.provider, this.token);
      
      if (result.success) {
        this._oauthStatus = 'success';
        
        // Handle callback server providers (Google Antigravity, Gemini CLI, OpenAI Codex)
        if (result.usesCallbackServer) {
          if (result.authUrl) {
            // Open authorization URL
            window.open(result.authUrl, '_blank');
            this._oauthMessage = `1. Click "Open Authorization Page" below to authenticate in your browser.\n2. After authorization, the page will automatically detect completion.`;
          } else if (result.manualCodeRequested) {
            // Manual code input needed
            this._oauthMessage = `Please complete authorization at: ${result.verificationUri}\n\nEnter the code when prompted.`;
          }
        } else {
          // Standard OAuth flow
          this._oauthMessage = result.message;
          
          // If there's an auth URL, open it in a new window
          if (result.authUrl) {
            window.open(result.authUrl, '_blank');
            this._oauthMessage = `Opening authorization page... ${result.instructions || ''}`;
          }
          
          // Show device code if available
          if (result.deviceCode && result.verificationUri) {
            this._oauthMessage = `Go to ${result.verificationUri} and enter code: ${result.deviceCode}`;
          }
        }
        
        // Notify parent of success
        this.dispatchEvent(new CustomEvent<ProviderOAuthEvent>('oauth', {
          detail: { provider: this.provider, success: true, message: result.message },
          bubbles: true,
          composed: true,
        }));
        
        // Reload page after short delay to reflect new config
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      }
    } catch (err) {
      this._oauthStatus = 'error';
      this._oauthMessage = err instanceof Error ? err.message : 'OAuth login failed';
      
      this.dispatchEvent(new CustomEvent<ProviderOAuthEvent>('oauth', {
        detail: { provider: this.provider, success: false, error: this._oauthMessage },
        bubbles: true,
        composed: true,
      }));
    } finally {
      this._loading = false;
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

        ${this._oauthStatus === 'waiting' && this._oauthMessage?.includes('authorization page') ? html`
          <div style="margin-top: 0.75rem;">
            <button 
              class="btn btn-primary"
              @click=${() => {
                // Auth URL already opened in _onOAuthClick
                this._oauthMessage = 'Waiting for authorization completion...';
              }}
            >
              ${getIcon('externalLink')} Open Authorization Page
            </button>
          </div>
        ` : ''}
        
        ${this._oauthMessage ? html`
          <div class="help-text ${this._oauthStatus === 'error' ? 'error-text' : ''}" style="margin-top: 0.5rem;">
            ${this._oauthStatus === 'success' ? getIcon('check') : (this._oauthStatus === 'error' ? getIcon('alertCircle') : getIcon('info'))}
            ${this._oauthMessage}
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
