import { html, LitElement, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import './gateway-chat';
import './pages/SessionManager';
import './pages/CronManager';
// Pages
import './pages/LogManager';
import './pages/SettingsPage';
// Components
import './components/TokenDialog';
import type { TokenDialog } from './components/TokenDialog';
import {
  getTabGroups,
  type Tab,
  renderNavItem,
  parseChatHash,
  getChatHash,
  type ChatRoute
} from './navigation';
import { getIcon } from './utils/icons';
import { t, setLanguage, getCurrentLanguage, initI18n } from './utils/i18n';
import { getToken, setToken, getTheme, setTheme, getLanguage, setLanguage as setStoredLanguage } from './utils/storage';
import type { XopcbotGatewayChat } from './gateway-chat';

export type { Tab } from './navigation';

export interface AppSettings {
  navCollapsed: boolean;
  theme: 'light' | 'dark' | 'system';
}

// SettingsPage component is imported at top

@customElement('xopcbot-app')
export class XopcbotApp extends LitElement {
  @state() private _gatewayConfig: {
    url: string;
    token?: string;
  } = {
    url: window.location.origin,
    token: getToken() || undefined,
  };

  @state() private _activeTab: Tab = 'chat';
  @state() private _navCollapsed = false;
  @state() private _navMobileOpen = false; // Mobile overlay state
  @state() private _theme: 'light' | 'dark' | 'system' = 'system';
  @state() private _language: 'en' | 'zh' = 'en';
  @state() private _chatRoute: ChatRoute = { type: 'recent' };
  @state() private _showTokenDialog = false;

  @query('xopcbot-gateway-chat') private _chatElement!: XopcbotGatewayChat;

  // Legacy property support
  get gatewayConfig() { return this._gatewayConfig; }
  set gatewayConfig(value) { this._gatewayConfig = value || { url: window.location.origin }; }

  constructor() {
    super();
  }

  private _initializeToken(): void {
    // Check URL for token parameter
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');

    // If token in URL, save it to localStorage and remove from URL
    if (urlToken) {
      setToken(urlToken);
      // Remove token from URL without reloading
      const newUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', newUrl);
    }

    // Read token from localStorage
    const token = getToken();

    // Update gatewayConfig with storage token
    this._gatewayConfig = {
      url: window.location.origin,
      token: token || undefined,
    };

    // Check if we need to show token dialog
    this._showTokenDialog = !token;
  }

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();

    // Initialize token in connectedCallback to ensure localStorage is available
    this._initializeToken();

    this._loadTheme();
    this._loadLanguage();
    this._loadRouteFromHash();

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this._theme === 'system') {
        this._applyTheme();
      }
    });

    // Listen for language changes
    window.addEventListener('languagechange', () => {
      this.requestUpdate();
    });

    // Listen for hash changes (browser back/forward)
    window.addEventListener('hashchange', () => {
      this._loadRouteFromHash();
    });

    // Listen for navigate-to-chat event from session manager
    window.addEventListener('navigate-to-chat', ((e: CustomEvent<{ sessionKey: string }>) => {
      const { sessionKey } = e.detail;
      this._updateChatRoute({ type: 'session', sessionKey });
      this._switchTab('chat');
    }) as EventListener);
  }

  /**
   * Load current tab from URL hash
   */
  private _loadRouteFromHash(): void {
    const hash = location.hash.slice(1);
    
    // Check if it's a chat route with session
    if (hash.startsWith('chat')) {
      const chatRoute = parseChatHash(hash);
      if (chatRoute) {
        if (this._activeTab !== 'chat') {
          this._activeTab = 'chat';
        }
        // Only update if route changed
        if (JSON.stringify(this._chatRoute) !== JSON.stringify(chatRoute)) {
          this._chatRoute = chatRoute;
        }
      }
      return;
    }
    
    const tab = hash as Tab;
    const validTabs: Tab[] = ['sessions', 'cron', 'logs', 'settings'];
    
    if (validTabs.includes(tab)) {
      if (this._activeTab !== tab) {
        this._activeTab = tab;
      }
    }
  }

  /**
   * Update URL hash when switching tabs
   */
  private _switchTab(tab: Tab): void {
    this._activeTab = tab;
    
    // Update URL hash without triggering hashchange
    let newHash: string;
    if (tab === 'chat') {
      newHash = getChatHash(this._chatRoute);
    } else {
      newHash = `#${tab}`;
    }
    
    if (location.hash !== newHash) {
      history.pushState(null, '', newHash);
    }
    
    // Close mobile nav if open
    this._navMobileOpen = false;
  }

  /**
   * Update chat route and URL
   */
  private _updateChatRoute(route: ChatRoute): void {
    this._chatRoute = route;
    const newHash = getChatHash(route);
    history.pushState(null, '', newHash);
  }

  private _loadTheme(): void {
    this._theme = getTheme();
    this._applyTheme();
  }

  private _loadLanguage(): void {
    this._language = getLanguage();
    setLanguage(this._language);
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

  private _setTheme(theme: 'light' | 'dark' | 'system'): void {
    this._theme = theme;
    setTheme(theme);
    this._applyTheme();
  }

  private _setLanguage(lang: 'en' | 'zh'): void {
    this._language = lang;
    setLanguage(lang);
    setStoredLanguage(lang);
    this.requestUpdate();
  }

  private _renderThemeToggle(): unknown {
    return html`
      <div class="pill-toggle">
        <button
          class="pill-btn ${this._theme === 'light' ? 'active' : ''}"
          @click=${() => this._setTheme('light')}
          title="Light"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
        </button>
        <button
          class="pill-btn ${this._theme === 'dark' ? 'active' : ''}"
          @click=${() => this._setTheme('dark')}
          title="Dark"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
        </button>
        <button
          class="pill-btn ${this._theme === 'system' ? 'active' : ''}"
          @click=${() => this._setTheme('system')}
          title="System"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        </button>
      </div>
    `;
  }

  private _renderLanguageToggle(): unknown {
    return html`
      <div class="pill-toggle">
        <button
          class="pill-btn ${this._language === 'en' ? 'active' : ''}"
          @click=${() => this._setLanguage('en')}
          title="English"
        >
          EN
        </button>
        <button
          class="pill-btn ${this._language === 'zh' ? 'active' : ''}"
          @click=${() => this._setLanguage('zh')}
          title="中文"
        >
          中
        </button>
      </div>
    `;
  }

  private _toggleNav(): void {
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      // Mobile: toggle overlay
      this._navMobileOpen = !this._navMobileOpen;
    } else {
      // Desktop: toggle collapsed state
      this._navCollapsed = !this._navCollapsed;
    }
  }

  private _closeNavMobile(): void {
    this._navMobileOpen = false;
  }

  private _handleTokenSave(token: string): void {
    // Save to localStorage
    setToken(token);
    
    // Update gateway config - always use current origin
    this._gatewayConfig = {
      url: window.location.origin,
      token,
    };
    
    // Hide dialog
    this._showTokenDialog = false;
    
    // Force re-render (not needed for @state but kept for clarity)
    this.requestUpdate();
  }

  override render(): unknown {
    // Show token dialog if no token
    if (this._showTokenDialog) {
      return html`
        <token-dialog
          .config=${{
            serverUrl: window.location.origin,
            onSave: (token: string) => this._handleTokenSave(token),
          }}
        ></token-dialog>
      `;
    }
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
            ${this._renderLanguageToggle()}
            ${this._renderThemeToggle()}
          </div>
        </header>

        <!-- Mobile Overlay Backdrop -->
        ${this._navMobileOpen ? html`
          <div class="nav-overlay" @click=${this._closeNavMobile}></div>
        ` : nothing}

        <div class="shell-main">
          <!-- Sidebar Navigation -->
          <aside class="nav ${this._navCollapsed ? 'nav--collapsed' : ''} ${this._navMobileOpen ? 'nav--mobile-open' : ''}">
            ${getTabGroups().map((group) => {
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
                        () => {
                          this._switchTab(tab);
                        }
                      )
                    )}
                  </div>
                </div>
              `;
            })}
          </aside>

          <!-- Main Content -->
          <main class="content ${this._activeTab === 'chat' ? 'content--chat' : ''}">
            ${this._activeTab === 'chat' ? this._renderChat() : nothing}
            ${this._activeTab === 'sessions' ? this._renderSessions() : nothing}
            ${this._activeTab === 'cron' ? this._renderCron() : nothing}
            ${this._activeTab === 'logs' ? this._renderLogs() : nothing}
            ${this._activeTab === 'settings' ? this._renderSettings() : nothing}
          </main>
        </div>
      </div>
    `;
  }

  private _renderChat(): unknown {
    const token = getToken();
    return html`
      <xopcbot-gateway-chat
        .config=${{ url: window.location.origin, token: token || undefined }}
        .route=${this._chatRoute}
        .enableAttachments=${true}
        .enableModelSelector=${true}
        .enableThinkingSelector=${true}
        @route-change=${(e: CustomEvent<ChatRoute>) => this._updateChatRoute(e.detail)}
      ></xopcbot-gateway-chat>
    `;
  }

  private _renderSessions(): unknown {
    const token = getToken() || this._gatewayConfig?.token;

    return html`
      <session-manager
        .config=${{ token }}
      ></session-manager>
    `;
  }

  private _renderCron(): unknown {
    const token = getToken() || this._gatewayConfig?.token;

    return html`
      <cron-manager
        .config=${{ token }}
      ></cron-manager>
    `;
  }

  private _renderLogs(): unknown {
    const token = getToken() || this._gatewayConfig?.token;

    return html`
      <log-manager
        .config=${{ token }}
      ></log-manager>
    `;
  }

  private _renderSettings(): unknown {
    const token = getToken() || this._gatewayConfig?.token;

    return html`
      <settings-page
        .config=${{ token }}
      ></settings-page>
    `;
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
