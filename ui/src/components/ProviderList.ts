/**
 * Provider list component - categorized collapsible list.
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
}

@customElement('provider-list')
export class ProviderList extends LitElement {
  @property({ type: Array }) providers: ProviderInfo[] = [];
  @property({ type: String }) token?: string;
  @property({ type: Boolean }) loading: boolean = false;

  @state() private _expandedCategories: Set<string> = new Set(['common']);

  static styles = css`
    :host { display: block; }

    .provider-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .category {
      border: 1px solid var(--border-color, #e7e5e4);
      border-radius: var(--radius-md, 0.5rem);
      overflow: hidden;
      background: var(--bg-primary, #fafaf9);
    }

    .category-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      background: var(--bg-secondary, #f5f5f4);
      cursor: pointer;
      user-select: none;
      transition: background var(--transition-fast, 150ms) ease;
    }

    .category-header:hover { background: var(--bg-tertiary, #e7e5e4); }

    .category-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
      font-size: 0.875rem;
      color: var(--text-primary, #1c1917);
    }

    .category-badge {
      font-size: 0.6875rem;
      padding: 0.125rem 0.5rem;
      border-radius: var(--radius-full, 9999px);
      background: var(--text-muted, #a8a29e);
      color: white;
      font-weight: 500;
    }

    .category-badge.common { background: var(--accent-success, #059669); }
    .category-badge.specialty { background: var(--accent-info, #0891b2); }
    .category-badge.enterprise { background: #8b5cf6; }
    .category-badge.oauth { background: var(--accent-warning, #d97706); }

    .category-content {
      padding: 1rem;
      display: none;
    }

    .category-content.expanded { display: block; }

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
      border-top-color: var(--accent-primary, #4f46e5);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .configured-count {
      font-size: 0.75rem;
      color: var(--text-secondary, #57534e);
      margin-left: 0.5rem;
      font-weight: 500;
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
      <div class="provider-list">
        ${Array.from(groups.entries()).map(([category, providers]) => {
          if (providers.length === 0) return null;

          const isExpanded = this._expandedCategories.has(category);
          const configuredCount = providers.filter(p => p.configured).length;

          return html`
            <div class="category">
              <div
                class="category-header"
                @click=${() => this._toggleCategory(category)}
              >
                <div class="category-title">
                  ${getIcon(isExpanded ? 'chevronDown' : 'chevronRight')}
                  <span>${this._getCategoryLabel(category)}</span>
                  <span class="category-badge ${category}">
                    ${providers.length}
                  </span>
                  ${configuredCount > 0 ? html`
                    <span class="configured-count">
                      (${configuredCount} configured)
                    </span>
                  ` : ''}
                </div>
              </div>

              <div class="category-content ${isExpanded ? 'expanded' : ''}">
                ${providers.map(provider => html`
                  <provider-config
                    .provider=${provider.id}
                    .displayName=${provider.name}
                    .apiKey=${provider.apiKey || ''}
                    .configured=${provider.configured}
                    .supportsOAuth=${provider.supportsOAuth}
                    .category=${provider.category}
                    @change=${this._onProviderChange}
                    @oauth=${this._onProviderOAuth}
                  ></provider-config>
                `)}
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
