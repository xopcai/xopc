/**
 * Provider list component - clean subsection-style layout.
 * Styled to match voice/stt/tts section design.
 */

import { html, LitElement, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getIcon } from '../utils/icons.js';
import './ProviderConfig.js';

export interface ProviderInfo {
  id: string;
  name: string;
  category: 'common' | 'specialty' | 'enterprise' | 'oauth';
  supportsOAuth: boolean;
  configured: boolean;
  apiKey?: string;
}

export interface ProviderListChangeEvent {
  provider: string;
  apiKey: string;
}

export interface ProviderListOAuthEvent {
  provider: string;
  success?: boolean;
  message?: string;
  error?: string;
}

@customElement('provider-list')
export class ProviderList extends LitElement {
  @property({ type: Array }) providers: ProviderInfo[] = [];
  @property({ type: String }) token?: string;
  @property({ type: Boolean }) loading: boolean = false;

  /** Collapsed by default — expand only what you need (calmer density). */
  @state() private _expandedCategories: Set<string> = new Set();

  static styles = css`
    :host { display: block; }

    .section-desc {
      margin: 0 0 1rem 0;
      color: var(--text-secondary, #57534e);
      font-size: 0.8125rem;
      line-height: 1.5;
    }

    .section-desc a {
      color: var(--accent-primary, #2563eb);
      text-decoration: none;
    }

    .section-desc a:hover {
      text-decoration: underline;
    }

    /* Subsection — card on app background (design system §2.1) */
    .subsection {
      margin-bottom: 1rem;
      background: var(--card-bg, #ffffff);
      border-radius: var(--radius-lg, 0.75rem);
      padding: 0;
      border: 1px solid var(--border-default, #e2e8f0);
      overflow: hidden;
    }

    .subsection:last-child {
      margin-bottom: 0;
    }

    .subsection-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      cursor: pointer;
      user-select: none;
      background: var(--border-subtle, #f1f5f9);
      transition: background var(--transition-fast, 150ms) ease;
    }

    .subsection-header:hover {
      background: var(--hover-bg, #f1f5f9);
    }

    .subsection-header:hover .subsection-title {
      color: var(--text-primary, #0f172a);
    }

    .subsection-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
      font-size: 0.875rem;
      color: var(--text-primary, #0f172a);
      transition: color var(--transition-fast, 150ms) ease;
    }

    .subsection-title svg {
      width: 1.125rem;
      height: 1.125rem;
      color: var(--text-tertiary, #64748b);
    }

    .subsection-meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .badge {
      font-size: 0.625rem;
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      background: var(--bg-secondary, #f1f5f9);
      color: var(--text-tertiary, #64748b);
      font-weight: 500;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    .configured-count {
      font-size: 0.6875rem;
      color: var(--text-tertiary, #64748b);
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .configured-count svg {
      width: 14px;
      height: 14px;
    }

    .expand-icon {
      color: var(--text-secondary, #57534e);
    }

    .expand-icon svg {
      width: 18px;
      height: 18px;
      transition: transform 150ms;
    }

    .expand-icon.expanded svg {
      transform: rotate(180deg);
    }

    .subsection-content {
      display: none;
      flex-direction: column;
      gap: 0;
      padding: 0.75rem 0.75rem 0.75rem 0.75rem;
      border-top: 1px solid var(--border-subtle, #f1f5f9);
    }

    .subsection-content.expanded { 
      display: flex; 
    }

    .empty-state {
      padding: 1.5rem;
      text-align: center;
      color: var(--text-secondary, #57534e);
    }

    .loading-state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 1.5rem;
      color: var(--text-secondary, #57534e);
    }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--border-color, #e7e5e4);
      border-top-color: var(--primary-base, #2563eb);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 640px) {
      .subsection-header {
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      
      .subsection-meta {
        width: 100%;
        justify-content: flex-start;
        margin-top: 0.5rem;
      }
    }
  `;

  private _toggleCategory(category: string) {
    if (this._expandedCategories.has(category)) {
      this._expandedCategories.delete(category);
    } else {
      this._expandedCategories.add(category);
    }
    this.requestUpdate();
  }

  private _onProviderChange(e: CustomEvent) {
    const { provider, apiKey } = e.detail;
    this.dispatchEvent(new CustomEvent<ProviderListChangeEvent>('change', {
      detail: { provider, apiKey },
      bubbles: true,
      composed: true,
    }));
  }

  private _onProviderOAuth(e: CustomEvent) {
    const { provider } = e.detail;
    this.dispatchEvent(new CustomEvent<ProviderListOAuthEvent>('oauth', {
      detail: { provider },
      bubbles: true,
      composed: true,
    }));
  }

  private _groupByCategory(providers: ProviderInfo[]): Map<string, ProviderInfo[]> {
    const groups = new Map<string, ProviderInfo[]>();
    const categories = ['common', 'specialty', 'enterprise', 'oauth'];
    categories.forEach(cat => groups.set(cat, []));

    providers.forEach(provider => {
      const category = provider.category || 'specialty';
      const list = groups.get(category) || [];
      list.push(provider);
      groups.set(category, list);
    });

    return groups;
  }

  private _getCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      common: 'Common Providers',
      specialty: 'Specialty Providers',
      enterprise: 'Enterprise / Cloud',
      oauth: 'OAuth Only',
    };
    return labels[category] || category;
  }

  private _getCategoryIcon(category: string): string {
    const icons: Record<string, string> = {
      common: 'cloud',
      specialty: 'cpu',
      enterprise: 'building',
      oauth: 'key',
    };
    return icons[category] || 'cloud';
  }

  render() {
    if (this.loading) {
      return html`
        <div class="loading-state">
          <span class="spinner"></span>
          <span>Loading providers...</span>
        </div>
      `;
    }

    if (this.providers.length === 0) {
      return html`
        <div class="empty-state">
          <p>No providers available.</p>
        </div>
      `;
    }

    const groups = this._groupByCategory(this.providers);

    return html`
      <p class="section-desc">
        Expand a group, then a provider to set an API key or use OAuth where available.
        <a href="https://github.com/xopc/xopcbot/blob/main/docs/models.md" target="_blank" rel="noopener noreferrer">Docs</a>
      </p>

      <div class="provider-list">
        ${Array.from(groups.entries()).map(([category, providers]) => {
          if (providers.length === 0) return null;

          const isExpanded = this._expandedCategories.has(category);
          const configuredCount = providers.filter(p => p.configured).length;

          return html`
            <div class="subsection">
              <div
                class="subsection-header"
                @click=${() => this._toggleCategory(category)}
              >
                <div class="subsection-title">
                  ${getIcon(this._getCategoryIcon(category))}
                  <span>${this._getCategoryLabel(category)}</span>
                  <span class="badge">${providers.length}</span>
                </div>
                
                <div class="subsection-meta">
                  ${configuredCount > 0 ? html`
                    <span class="configured-count">
                      ${getIcon('checkCircle')} ${configuredCount} configured
                    </span>
                  ` : ''}
                  <span class="expand-icon ${isExpanded ? 'expanded' : ''}">
                    ${getIcon('chevronDown')}
                  </span>
                </div>
              </div>

              <div class="subsection-content ${isExpanded ? 'expanded' : ''}">
                ${providers.map((provider, rowIndex) => {
                  const n = providers.length;
                  const listSegment =
                    n === 1 ? 'single' : rowIndex === 0 ? 'first' : rowIndex === n - 1 ? 'last' : 'mid';
                  return html`
                  <provider-config
                    .listSegment=${listSegment}
                    .provider=${provider.id}
                    .displayName=${provider.name}
                    .apiKey=${provider.apiKey || ''}
                    .configured=${provider.configured}
                    .supportsOAuth=${provider.supportsOAuth}
                    .category=${provider.category}
                    .token=${this.token}
                    @change=${this._onProviderChange}
                    @oauth=${this._onProviderOAuth}
                  ></provider-config>
                `;
                })}
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'provider-list': ProviderList;
  }
}
