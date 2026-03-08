/**
 * Provider config component with API key input and OAuth login support.
 */

import { html, LitElement, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';

export interface ProviderConfigChangeEvent {
  provider: string;
  apiKey: string;
}

export interface ProviderOAuthEvent {
  provider: string;
}

@customElement('provider-config')
export class ProviderConfig extends LitElement {
  @property({ type: String }) provider!: string;
  @property({ type: String }) apiKey: string = '';
  @property({ type: Boolean }) configured: boolean = false;
  @property({ type: Boolean }) supportsOAuth: boolean = false;
  @property({ type: String }) displayName: string = '';
  @property({ type: String }) category: string = 'common';
  
  @state() private _showKey: boolean = false;
  @state() private _copied: boolean = false;
  @state() private _loading: boolean = false;
  
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
  
  private _onOAuthClick() {
    this.dispatchEvent(new CustomEvent<ProviderOAuthEvent>('oauth', {
      detail: { provider: this.provider },
      bubbles: true,
      composed: true,
    }));
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
              .value=${this.apiKey}
              placeholder="${this.configured ? 'Configured (leave empty to keep)' : 'sk-...'}"
              @change=${this._onApiKeyChange}
              ?disabled=${this._loading}
            />
            <div class="input-actions">
              ${this.apiKey ? html`
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
              >
                ${getIcon(this._showKey ? 'eyeOff' : 'eye')}
              </button>
            </div>
          </div>
          
          ${this.supportsOAuth ? html`
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
          ` : ''}
        </div>
        
        ${this.supportsOAuth ? html`
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
