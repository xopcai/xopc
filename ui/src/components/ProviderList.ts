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
}

@customElement('provider-list')
export class ProviderList extends LitElement {
  @property({ type: Array }) providers: ProviderInfo[] = [];
  @property({ type: String }) token?: string;
  @property({ type: Boolean }) loading: boolean = false;

  @state() private _expandedCategories: Set<string> = new Set(['common']);

  static styles = css`
    :host { display: block; }

    .section-desc {
      margin: 0 0 1.5rem 0;
      color: var(--muted-foreground, #64748b);
      font-size: 0.875rem;
      line-height: 1.5;
    }

    .section-desc a {
      color: var(--primary, #3b82f6);
      text-decoration: none;
    }

    .section-desc a:hover {
      text-decoration: underline;
    }

    /* Subsection style - matching voice/stt/tts */
    .subsection {
      margin-bottom: 1.5rem;
      background: var(--muted, #f8fafc);
      border-radius: 0.75rem;
      padding: 1.25rem;
      border: 1px solid var(--border, #e2e8f0);
    }

    .subsection:last-child {
      margin-bottom: 0;
    }

    .subsection-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border, #e2e8f0);
      margin-bottom: 1rem;
      cursor: pointer;
      user-select: none;
    }

    .subsection-header:hover .subsection-title {
      color: var(--primary, #3b82f6);
    }

    .subsection-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
      font-size: 1rem;
      color: var(--foreground, #0f172a);
      transition: color var(--transition-fast, 150ms) ease;
    }

    .subsection-title svg {
      width: 1.25rem;
      height: 1.25rem;
      color: var(--primary, #3b82f6);
    }

    .subsection-meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .badge {
      font-size: 0.6875rem;
      padding: 0.125rem 0.5rem;
      border-radius: 9999px;
      background: var(--muted-foreground, #94a3b8);
      color: white;
      font-weight: 500;
    }

    .badge.common { background: #059669; }
    .badge.specialty { background: #0891b2; }
    .badge.enterprise { background: #8b5cf6; }
    .badge.oauth { background: #d97706; }

    .configured-count {
      font-size: 0.75rem;
      color: var(--accent-success, #059669);
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
      color: var(--muted-foreground, #64748b);
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
      gap: 0.625rem;
    }

    .subsection-content.expanded { 
      display: flex; 
    }

    .empty-state {
      padding: 1.5rem;
      text-align: center;
      color: var(--muted-foreground, #64748b);
    }

    .loading-state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 1.5rem;
      color: var(--muted-foreground, #64748b);
    }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--border, #e2e8f0);
      border-top-color: var(--primary, #3b82f6);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Info box */
    .info-box {
      margin-top: 1.5rem;
      padding: 1rem 1.25rem;
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(99, 102, 241, 0.05) 100%);
      border: 1px solid rgba(59, 130, 246, 0.2);
      border-radius: 0.75rem;
    }

    .info-box p {
      margin: 0;
      font-size: 0.8125rem;
      color: var(--foreground, #0f172a);
      line-height: 1.5;
    }

    .info-box strong {
      color: var(--primary, #3b82f6);
    }

    @media (max-width: 640px) {
      .subsection {
        padding: 1rem;
      }
      
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

  private _getCategoryDescription(category: string): string {
    const descriptions: Record<string, string> = {
      common: 'Popular AI providers with extensive model support',
      specialty: 'Specialized providers with unique capabilities',
      enterprise: 'Enterprise-grade cloud AI services',
      oauth: 'Providers supporting OAuth authentication',
    };
    return descriptions[category] || '';
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
        Configure API keys for AI providers. Click on a provider to expand and configure.
        <a href="https://github.com/xopc/xopcbot/blob/main/docs/models.md" target="_blank">Learn more</a>
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
                  <span class="badge ${category}">
                    ${providers.length}
                  </span>
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
                ${providers.map(provider => html`
                  <provider-config
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
                `)}
              </div>
            </div>
          `;
        })}
      </div>

      <div class="info-box">
        <p>
          <strong>Tip:</strong> Some providers support OAuth for secure authentication. 
          Click the expand button on a provider to see configuration options.
        </p>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'provider-list': ProviderList;
  }
}
