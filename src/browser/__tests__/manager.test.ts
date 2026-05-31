import { describe, expect, it, vi } from 'vitest';
import type { Browser, BrowserContext, Page } from 'playwright-core';

import { BrowserManager } from '../manager.js';

function mockPage(closed = false): Page {
  return {
    isClosed: () => closed,
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Page;
}

describe('BrowserManager stale session recovery', () => {
  it('drops closed cached pages and creates a new one after reconnect', async () => {
    const launchLocal = vi.fn(async (headless: boolean) => {
      const browser = {
        isConnected: () => true,
        on: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
        newContext: vi.fn(),
      } as unknown as Browser;
      const context = {
        newPage: vi.fn().mockResolvedValue(mockPage(false)),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as BrowserContext;
      (manager as unknown as { browser: Browser | null }).browser = browser;
      (manager as unknown as { context: BrowserContext | null }).context = context;
      (manager as unknown as { activeBackendMode: string | null }).activeBackendMode = 'local';
      void headless;
    });

    const manager = new BrowserManager({
      getHeadless: () => false,
      getBackend: () => ({ mode: 'local', headless: false }),
    });

    (manager as unknown as { _launchLocal: typeof launchLocal })._launchLocal = launchLocal;

    const stalePage = mockPage(true);
    (manager as unknown as { pages: Map<string, { page: Page; lastUsed: number }> }).pages.set('task-1', {
      page: stalePage,
      lastUsed: Date.now(),
    });
    (manager as unknown as { browser: Browser | null }).browser = {
      isConnected: () => false,
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Browser;
    (manager as unknown as { context: BrowserContext | null }).context = {
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BrowserContext;

    const page = await manager.getPage('task-1');

    expect(launchLocal).toHaveBeenCalled();
    expect(page.isClosed()).toBe(false);
  });
});
