import { html, LitElement, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import './gateway-chat';
import './dialogs/SettingsDialog';
import { 
  TAB_GROUPS, 
  type Tab, 
  titleForTab, 
  subtitleForTab, 
  renderNavItem
} from './navigation';
import { getIcon } from './utils/icons';
import { t } from './utils/i18n';
import type { XopcbotGatewayChat } from './gateway-chat';
import type { XopcbotSettings, SettingsSection, SettingsValue } from './dialogs/SettingsDialog';

export type { Tab } from './navigation';

export interface AppSettings {
  navCollapsed: boolean;
  theme: 'light' | 'dark' | 'system';
}

@customElement('xopcbot-app')
export class XopcbotApp extends LitElement {
  @property({ attribute: false }) gatewayConfig?: {
    url: string;
    token?: string;
  };
  
  @property({ attribute: false }) settingsSections: SettingsSection[] = [];
  @property({ attribute: false }) settingsValues: SettingsValue = {};
  @property({ attribute: false }) onSettingsSave?: (values: SettingsValue) => void;
  
  @state() private _activeTab: Tab = 'chat';
  @state() private _navCollapsed = false;
  @state() private _theme: 'light' | 'dark' | 'system' = 'system';
  @state() private _showSettings = false;

  @query('xopcbot-gateway-chat') private _chatElement!: XopcbotGatewayChat;
  @query('xopcbot-settings') private _settingsElement!: XopcbotSettings;

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._loadTheme();
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this._theme === 'system') {
        this._applyTheme();
      }
    });
  }

  private _loadTheme(): void {
    const saved = localStorage.getItem('xopcbot-theme') as 'light' | 'dark' | 'system' | null;
    if (saved) {
      this._theme = saved;
    }
    this._applyTheme();
  }

  private _applyTheme(): void {
    const html = document.documentElement;
    
    // Remove both classes first
    html.classList.remove('light', 'dark');
    
    let isDark = false;
    if (this._theme === 'dark') {
      isDark = true;
    } else if (this._theme === 'system') {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    // For 'light' or when system is light, isDark remains false
    
    if (isDark) {
      html.classList.add('dark');
    } else {
      html.classList.add('light');
    }
    
    // Dispatch event for other components
    window.dispatchEvent(new CustomEvent('themechange', { 
      detail: { theme: isDark ? 'dark' : 'light' } 
    }));
  }

  private _toggleTheme(): void {
    const themes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(this._theme);
    this._theme = themes[(currentIndex + 1) % themes.length];
    localStorage.setItem('xopcbot-theme', this._theme);
    this._applyTheme();
  }

  private _toggleNav(): void {
    this._navCollapsed = !this._navCollapsed;
  }

  override render(): unknown {
    return html`
      <div class="shell ${this._activeTab === 'chat' ? 'shell--chat' : ''} ${this._navCollapsed ? 'shell--nav-collapsed' : ''}">
        <!-- Topbar -->
        <header class="topbar">
          <div class="topbar-left">
            <button 
              class="nav-collapse-toggle"
              @click=${this._toggleNav}
              title="${this._navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}"
              aria-label="${this._navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}"
            >
              <span class="nav-collapse-toggle__icon">${getIcon('menu')}</span>
            </button>
            
            <div class="brand">
              <div class="brand-logo">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="24" height="24" rx="6" fill="url(#logo-gradient)"/>
                  <path d="M8 12L11 15L16 9" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <defs>
                    <linearGradient id="logo-gradient" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                      <stop stop-color="#3b82f6"/>
                      <stop offset="1" stop-color="#8b5cf6"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div class="brand-text">
                <div class="brand-title">XOPCBOT</div>
                <div class="brand-sub">Gateway</div>
              </div>
            </div>
          </div>
          
          <div class="topbar-status">
            <button 
              class="theme-toggle"
              @click=${this._toggleTheme}
              title="Toggle theme (current: ${this._theme})"
            >
              ${this._renderThemeIcon()}
            </button>
          </div>
        </header>

        <div class="shell-main">
          <!-- Sidebar Navigation -->
          <aside class="nav ${this._navCollapsed ? 'nav--collapsed' : ''}">
            ${TAB_GROUPS.map((group) => {
              const hasActiveTab = group.tabs.some((tab) => tab === this._activeTab);
              return html`
                <div class="nav-group">
                  <div class="nav-label nav-label--static">
                    <span class="nav-label__text">${group.label}</span>
                  </div>
                  <div class="nav-group__items">
                    ${group.tabs.map((tab) => 
                      renderNavItem(
                        tab, 
                        this._activeTab === tab, 
                        () => this._activeTab = tab
                      )
                    )}
                  </div>
                </div>
              `;
            })}
          </aside>

          <!-- Main Content -->
          <main class="content ${this._activeTab === 'chat' ? 'content--chat' : ''}">
            <section class="content-header">
              <div>
                <div class="page-title">${titleForTab(this._activeTab)}</div>
                <div class="page-sub">${subtitleForTab(this._activeTab)}</div>
              </div>
            </section>

            ${this._activeTab === 'chat' ? this._renderChat() : nothing}
          </main>
        </div>

        <!-- Settings Dialog -->
        ${this._showSettings ? this._renderSettingsDialog() : nothing}
      </div>
    `;
  }

  private _renderThemeIcon(): unknown {
    if (this._theme === 'light') {
      return html`
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      `;
    }
    if (this._theme === 'dark') {
      return html`
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      `;
    }
    // System
    return html`
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
        <line x1="8" y1="21" x2="16" y2="21"></line>
        <line x1="12" y1="17" x2="12" y2="21"></line>
      </svg>
    `;
  }

  private _renderChat(): unknown {
    return html`
      <xopcbot-gateway-chat
        .config=${this.gatewayConfig}
        .enableAttachments=${true}
        .enableModelSelector=${true}
        .enableThinkingSelector=${true}
      ></xopcbot-gateway-chat>
    `;
  }

  private _renderSettingsDialog(): unknown {
    return html`
      <xopcbot-settings
        .sections=${this.settingsSections}
        .values=${this.settingsValues}
        .onSave=${(values: SettingsValue) => {
          if (this.onSettingsSave) {
            this.onSettingsSave(values);
          }
          this._showSettings = false;
        }}
        .onClose=${() => this._showSettings = false}
      ></xopcbot-settings>
    `;
  }

  // Public method to show settings
  public showSettings(): void {
    this._showSettings = true;
  }

  // Public method to show chat
  public showChat(): void {
    this._activeTab = 'chat';
  }

  // Get chat element for external access
  public get chatElement(): XopcbotGatewayChat | undefined {
    return this._chatElement;
  }
}

// Export as both named and default for flexibility
export { XopcbotApp as default };
