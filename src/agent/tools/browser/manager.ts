import type { Browser, BrowserContext, Page } from 'playwright-core';

import { createLogger } from '../../../utils/logger.js';

import type { BrowserBackend, CloudBrowserProvider, CloudBrowserProviderConfig } from './providers/types.js';

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
      if (now - entry.lastUsed > PAGE_IDLE_TIMEOUT_MS) {
        void entry.page.close().catch(() => {});
        this.pages.delete(id);
        log.debug({ taskId: id }, 'Evicted idle browser page');
      }
    }
  }

  async ensureBrowser(): Promise<BrowserContext> {
    if (this.context) return this.context;

    const backend = this.options.getBackend?.() ?? { mode: 'local' as const, headless: true };

    switch (backend.mode) {
      case 'cdp':
        await this._connectViaCdp(backend.config.wsEndpoint);
        break;
      case 'cloud':
        await this._connectViaCloud(backend.config);
        break;
      case 'local':
      default:
        await this._launchLocal(backend.mode === 'local' ? backend.headless : this.options.getHeadless() !== false);
        break;
    }

    this.activeBackendMode = backend.mode;
    return this.context!;
  }

  private async _launchLocal(headless: boolean): Promise<void> {
    const pw = await import('playwright-core');
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
    const pw = await import('playwright-core');
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

  async getPage(taskId: string): Promise<Page> {
    this.evictIdlePages();

    const existing = this.pages.get(taskId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.page;
    }

    if (this.pages.size >= MAX_PAGES) {
      const oldest = [...this.pages.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (oldest) {
        await oldest[1].page.close().catch(() => {});
        this.pages.delete(oldest[0]);
      }
    }

    const ctx = await this.ensureBrowser();
    const page = await ctx.newPage();
    this.pages.set(taskId, { page, lastUsed: Date.now() });
    return page;
  }

  async closePage(taskId: string): Promise<void> {
    const entry = this.pages.get(taskId);
    if (entry) {
      await entry.page.close().catch(() => {});
      this.pages.delete(taskId);
    }
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

    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = null;
    this.browser = null;
    this.activeBackendMode = null;
    log.info('Browser shut down');
  }
}
