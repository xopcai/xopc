import type { Browser, BrowserContext } from 'playwright-core';

import { createLogger } from '../../utils/logger.js';

import { loadPlaywrightCoreModule } from './playwright-doctor.js';

import type { CloudBrowserProvider, CloudBrowserProviderConfig } from './types.js';

const log = createLogger('BrowserProvider:Browserbase');

/**
 * Browserbase cloud browser provider.
 *
 * Connects to a Browserbase-managed Chromium instance via CDP WebSocket.
 * Requires `BROWSERBASE_API_KEY` or config-level `apiKey`, plus an optional `projectId`.
 *
 * @see https://docs.browserbase.com
 */
export class BrowserbaseProvider implements CloudBrowserProvider {
  readonly name = 'browserbase';

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private sessionId: string | null = null;
  private readonly config: CloudBrowserProviderConfig;

  constructor(config: CloudBrowserProviderConfig) {
    this.config = config;
  }

  async connect(): Promise<{ browser: Browser; context: BrowserContext }> {
    const apiKey = this.config.apiKey || process.env.BROWSERBASE_API_KEY;
    if (!apiKey) {
      throw new Error('Browserbase API key not configured (set BROWSERBASE_API_KEY or browser.cloudProvider config)');
    }

    const projectId = this.config.projectId || process.env.BROWSERBASE_PROJECT_ID;

    // Create a Browserbase session via REST API
    const createUrl = 'https://www.browserbase.com/v1/sessions';
    const body: Record<string, unknown> = {};
    if (projectId) body.projectId = projectId;
    if (this.config.region) body.region = this.config.region;

    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bb-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`Browserbase session creation failed (${response.status}): ${errorText}`);
    }

    const session = (await response.json()) as { id: string; connectUrl?: string };
    this.sessionId = session.id;

    // Connect via CDP
    const connectUrl =
      session.connectUrl || `wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${session.id}`;

    const pw = await loadPlaywrightCoreModule();
    const chromium = pw.chromium ?? (pw as { default?: { chromium?: (typeof pw)['chromium'] } }).default?.chromium;
    if (!chromium?.connectOverCDP) {
      throw new Error('playwright-core does not support connectOverCDP');
    }

    this.browser = await chromium.connectOverCDP(connectUrl);
    const contexts = this.browser.contexts();
    this.context = contexts.length > 0 ? contexts[0] : await this.browser.newContext();

    log.info({ sessionId: this.sessionId }, 'Connected to Browserbase');
    return { browser: this.browser, context: this.context };
  }

  async disconnect(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.context = null;
      log.info({ sessionId: this.sessionId }, 'Disconnected from Browserbase');
      this.sessionId = null;
    }
  }

  isConnected(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }
}
