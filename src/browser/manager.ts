import type { Browser, BrowserContext, Page } from 'playwright-core';

import { createLogger } from '../utils/logger.js';

import { loadPlaywrightCoreModule } from './providers/playwright-doctor.js';
import type { BrowserBackend, CloudBrowserProvider, CloudBrowserProviderConfig, ExtensionConnectionConfig } from './providers/types.js';
import type { ExtensionBrowserProvider } from './providers/extension.js';

const log = createLogger('browser-manager');

const MAX_PAGES = 3;
const PAGE_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export interface BrowserManagerOptions {
  getHeadless: () => boolean;
  /** Backend connection mode. Default: local Playwright. */
  getBackend?: () => BrowserBackend;
}

/**
 * Multi-backend browser manager — supports local Playwright, direct CDP, and cloud providers.
 *
 * One browser context shared by all sessions; one {@link Page} per task/session key (max {@link MAX_PAGES}).
 * Backend is selected at first connection based on {@link BrowserManagerOptions.getBackend}.
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private cloudProvider: CloudBrowserProvider | null = null;
  private extensionProvider: ExtensionBrowserProvider | null = null;
  private extensionRelease: (() => Promise<void>) | null = null;
  private cloakChildProcess: import('node:child_process').ChildProcess | null = null;
  private cloakTempProfileDir: string | null = null;
  private pages = new Map<string, { page: Page; lastUsed: number }>();
  private readonly options: BrowserManagerOptions;
  private activeBackendMode: BrowserBackend['mode'] | null = null;

  constructor(options: BrowserManagerOptions) {
    this.options = options;
  }

  /** Current backend mode (null if not yet connected). */
  get backendMode(): string | null {
    return this.activeBackendMode;
  }

  private evictIdlePages(): void {
    const now = Date.now();
    for (const [id, entry] of this.pages) {
      if (entry.page.isClosed() || now - entry.lastUsed > PAGE_IDLE_TIMEOUT_MS) {
        void entry.page.close().catch(() => {});
        this.pages.delete(id);
        log.debug({ taskId: id }, 'Evicted idle or closed browser page');
      }
    }
  }

  private _isPlaywrightConnectionAlive(): boolean {
    if (!this.browser || !this.context) return false;
    try {
      if (typeof this.browser.isConnected === 'function' && !this.browser.isConnected()) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private _wireBrowserLifecycle(browser: Browser): void {
    browser.on('disconnected', () => {
      log.warn({ mode: this.activeBackendMode }, 'Browser disconnected — clearing stale session');
      this._clearPlaywrightSessionRefs();
    });
  }

  /** Drop Playwright handles without tearing down extension bridge. */
  private _clearPlaywrightSessionRefs(): void {
    this.pages.clear();
    this.context = null;
    this.browser = null;
    this.cloakChildProcess = null;
    this.cloakTempProfileDir = null;
    if (this.cloudProvider) {
      void this.cloudProvider.disconnect().catch(() => {});
      this.cloudProvider = null;
    }
  }

  private async _resetStalePlaywrightSession(): Promise<void> {
    for (const [, entry] of this.pages) {
      await entry.page.close().catch(() => {});
    }
    this.pages.clear();

    if (this.cloudProvider) {
      await this.cloudProvider.disconnect().catch(() => {});
      this.cloudProvider = null;
    }

    if (this.cloakChildProcess || this.cloakTempProfileDir) {
      const { cleanupCloakBrowser } = await import('./providers/cloakbrowser.js');
      await cleanupCloakBrowser(this.cloakChildProcess, this.cloakTempProfileDir).catch(() => {});
      this.cloakChildProcess = null;
      this.cloakTempProfileDir = null;
    }

    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = null;
    this.browser = null;
  }

  /**
   * Ensure Playwright context or Chrome Extension provider is ready.
   * Extension mode does not create a Playwright {@link BrowserContext}.
   */
  async ensureConnected(): Promise<void> {
    if (this.extensionProvider) return;

    if (this.context && this._isPlaywrightConnectionAlive()) {
      return;
    }

    if (this.context || this.browser) {
      log.warn({ mode: this.activeBackendMode }, 'Browser session unavailable — reconnecting');
      await this._resetStalePlaywrightSession();
    }

    const backend = this.options.getBackend?.() ?? { mode: 'local' as const, headless: false };

    switch (backend.mode) {
      case 'cdp':
        await this._connectViaCdp(backend.config.wsEndpoint);
        break;
      case 'cloud':
        await this._connectViaCloud(backend.config);
        break;
      case 'extension':
        await this._connectViaExtension(backend.config);
        break;
      case 'cloakbrowser':
        await this._connectViaCloakBrowser(backend.config);
        break;
      case 'local':
      default:
        await this._launchLocal(backend.mode === 'local' ? backend.headless : this.options.getHeadless() === true);
        break;
    }

    this.activeBackendMode = backend.mode;
    if (this.browser) {
      this._wireBrowserLifecycle(this.browser);
    }
  }

  private async _launchLocal(headless: boolean): Promise<void> {
    const pw = await loadPlaywrightCoreModule();
    const chromium = pw.chromium ?? (pw as { default?: { chromium?: (typeof pw)['chromium'] } }).default?.chromium;
    if (!chromium?.launch) {
      throw new Error(
        'playwright-core did not expose chromium (try reinstall: pnpm install playwright-core; install browser: npx playwright install chromium)',
      );
    }
    this.browser = await chromium.launch({
      headless,
      ...(headless ? { channel: 'chromium' } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    log.info({ headless, mode: 'local' }, 'Browser launched (local)');
  }

  private async _connectViaCdp(wsEndpoint: string): Promise<void> {
    const pw = await loadPlaywrightCoreModule();
    const chromium = pw.chromium ?? (pw as { default?: { chromium?: (typeof pw)['chromium'] } }).default?.chromium;
    if (!chromium?.connectOverCDP) {
      throw new Error('playwright-core does not support connectOverCDP');
    }
    this.browser = await chromium.connectOverCDP(wsEndpoint);
    const contexts = this.browser.contexts();
    this.context = contexts.length > 0 ? contexts[0] : await this.browser.newContext();
    log.info({ mode: 'cdp', wsEndpoint }, 'Browser connected (CDP)');
  }

  private async _connectViaCloud(config: CloudBrowserProviderConfig): Promise<void> {
    const { BrowserbaseProvider } = await import('./providers/browserbase.js');
    const { BrowserUseProvider } = await import('./providers/browser-use.js');

    const provider = config.type === 'browserbase'
      ? new BrowserbaseProvider(config)
      : new BrowserUseProvider(config);

    const { browser, context } = await provider.connect();
    this.browser = browser;
    this.context = context;
    this.cloudProvider = provider;
    log.info({ mode: 'cloud', provider: config.type }, `Browser connected (${config.type})`);
  }

  private async _connectViaExtension(config?: ExtensionConnectionConfig): Promise<void> {
    const { acquireExtensionBrowserServer } = await import('./providers/extension-ws-acquire.js');
    const { provider, release } = await acquireExtensionBrowserServer(config);
    this.extensionProvider = provider;
    this.extensionRelease = release;
    log.info({ port: config?.port ?? 19820 }, 'Extension WS server ready, waiting for Chrome Extension...');
    await provider.waitForConnection();
    // Extension mode does not use Playwright — context stays null.
    // The action registry dispatches directly via extensionProvider.sendCommand().
    log.info({ mode: 'extension' }, 'Browser connected (Chrome Extension)');
  }

  private async _connectViaCloakBrowser(config?: import('./providers/types.js').CloakBrowserConfig): Promise<void> {
    const { launchCloakBrowser } = await import('./providers/cloakbrowser.js');
    const result = await launchCloakBrowser(config);
    if (!result.browser || !result.context) {
      throw new Error('BrowserManager: CloakBrowser launch did not return a Playwright connection');
    }
    this.browser = result.browser;
    this.context = result.context;
    this.cloakChildProcess = result.childProcess;
    this.cloakTempProfileDir = result.temporaryProfileDir;
    log.info({ mode: 'cloakbrowser' }, 'Browser connected (CloakBrowser)');
  }

  async getPage(taskId: string): Promise<Page> {
    if (this.extensionProvider) {
      throw new Error('BrowserManager.getPage is not used in Chrome Extension backend mode');
    }

    this.evictIdlePages();
    await this.ensureConnected();

    const existing = this.pages.get(taskId);
    if (existing && !existing.page.isClosed()) {
      existing.lastUsed = Date.now();
      return existing.page;
    }
    if (existing) {
      this.pages.delete(taskId);
    }

    if (this.pages.size >= MAX_PAGES) {
      const oldest = [...this.pages.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (oldest) {
        await oldest[1].page.close().catch(() => {});
        this.pages.delete(oldest[0]);
      }
    }

    const ctx = this.context;
    if (!ctx) {
      throw new Error('BrowserManager: Playwright context missing after ensureConnected');
    }
    const page = await ctx.newPage();
    this.pages.set(taskId, { page, lastUsed: Date.now() });
    return page;
  }

  async closePage(taskId: string): Promise<void> {
    if (this.extensionProvider) {
      return;
    }
    const entry = this.pages.get(taskId);
    if (entry) {
      await entry.page.close().catch(() => {});
      this.pages.delete(taskId);
    }
  }

  /** Get the extension provider (only available in extension mode). */
  getExtensionProvider(): ExtensionBrowserProvider | null {
    return this.extensionProvider;
  }

  async shutdown(): Promise<void> {
    for (const [, entry] of this.pages) {
      await entry.page.close().catch(() => {});
    }
    this.pages.clear();

    if (this.cloudProvider) {
      await this.cloudProvider.disconnect().catch(() => {});
      this.cloudProvider = null;
    }

    if (this.extensionRelease) {
      await this.extensionRelease().catch(() => {});
      this.extensionRelease = null;
    }
    this.extensionProvider = null;

    // CloakBrowser cleanup — kill child process and remove temp profile
    if (this.cloakChildProcess || this.cloakTempProfileDir) {
      const { cleanupCloakBrowser } = await import('./providers/cloakbrowser.js');
      await cleanupCloakBrowser(this.cloakChildProcess, this.cloakTempProfileDir).catch(() => {});
      this.cloakChildProcess = null;
      this.cloakTempProfileDir = null;
    }

    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = null;
    this.browser = null;
    this.activeBackendMode = null;
    log.info('Browser shut down');
  }
}
