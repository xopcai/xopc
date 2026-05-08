import type { Browser, BrowserContext } from 'playwright-core';

import { createLogger } from '../../../../utils/logger.js';

import type { CloudBrowserProvider, CloudBrowserProviderConfig } from './types.js';

const log = createLogger('BrowserProvider:BrowserUse');

/**
 * Browser Use cloud browser provider.
 *
 * Connects to a Browser Use-managed session via CDP WebSocket.
 * Requires `BROWSER_USE_API_KEY` or config-level `apiKey`.
 *
 * @see https://docs.browser-use.com
 */
export class BrowserUseProvider implements CloudBrowserProvider {
  readonly name = 'browser-use';

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private sessionId: string | null = null;
  private readonly config: CloudBrowserProviderConfig;

  constructor(config: CloudBrowserProviderConfig) {
    this.config = config;
  }

  async connect(): Promise<{ browser: Browser; context: BrowserContext }> {
    const apiKey = this.config.apiKey || process.env.BROWSER_USE_API_KEY;
    if (!apiKey) {
      throw new Error('Browser Use API key not configured (set BROWSER_USE_API_KEY or browser.cloudProvider config)');
    }

    // Create a Browser Use session via REST API
    const createUrl = 'https://api.browser-use.com/api/v1/sessions';
    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`Browser Use session creation failed (${response.status}): ${errorText}`);
    }

    const session = (await response.json()) as { session_id: string; ws_url: string };
    this.sessionId = session.session_id;

    const pw = await import('playwright-core');
    const chromium = pw.chromium ?? (pw as { default?: { chromium?: (typeof pw)['chromium'] } }).default?.chromium;
    if (!chromium?.connectOverCDP) {
      throw new Error('playwright-core does not support connectOverCDP');
    }

    this.browser = await chromium.connectOverCDP(session.ws_url);
    const contexts = this.browser.contexts();
    this.context = contexts.length > 0 ? contexts[0] : await this.browser.newContext();

    log.info({ sessionId: this.sessionId }, 'Connected to Browser Use');
    return { browser: this.browser, context: this.context };
  }

  async disconnect(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.context = null;
      log.info({ sessionId: this.sessionId }, 'Disconnected from Browser Use');
      this.sessionId = null;
    }
  }

  isConnected(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }
}
