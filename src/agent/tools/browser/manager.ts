import type { Browser, BrowserContext, Page } from 'playwright-core';

import { createLogger } from '../../../utils/logger.js';

const log = createLogger('browser-manager');

const MAX_PAGES = 3;
const PAGE_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export interface BrowserManagerOptions {
  getHeadless: () => boolean;
}

/**
 * One Chromium context shared by all sessions; one {@link Page} per task/session key (max {@link MAX_PAGES}).
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages = new Map<string, { page: Page; lastUsed: number }>();
  private readonly options: BrowserManagerOptions;

  constructor(options: BrowserManagerOptions) {
    this.options = options;
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
    if (!this.context) {
      const { chromium } = await import('playwright-core');
      const headless = this.options.getHeadless() !== false;
      this.browser = await chromium.launch({
        headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      log.info({ headless }, 'Browser launched');
    }
    return this.context;
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
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = null;
    this.browser = null;
    log.info('Browser shut down');
  }
}
