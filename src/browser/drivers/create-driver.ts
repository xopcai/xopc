import type { Browser, BrowserContext } from 'playwright-core';

import type { Config } from '../../config/schema.js';
import type { EndpointToolRuntime } from '../../endpoint-tools/index.js';
import { createLogger } from '../../utils/logger.js';
import { BrowserbaseProvider } from '../providers/browserbase.js';
import { BrowserUseProvider } from '../providers/browser-use.js';
import { RealtimeExtensionBrowserProvider } from '../providers/realtime-extension.js';
import { loadPlaywrightCoreModule } from '../providers/playwright-doctor.js';
import { ExtensionDriver } from './extension-driver.js';
import type { BrowserDriver } from './browser-driver.js';
import { PlaywrightDriver, type PlaywrightConnection } from './playwright-driver.js';

const log = createLogger('BrowserDriverFactory');

export async function createBrowserDriver(
  config: Config['browser'],
  endpointTools: EndpointToolRuntime,
): Promise<BrowserDriver> {
  const limits = config.limits;
  if (config.driver.kind === 'extension') {
    const provider = new RealtimeExtensionBrowserProvider(endpointTools, {
      connectionTimeout: limits.actionTimeoutMs,
      commandTimeout: limits.actionTimeoutMs,
    });
    return new ExtensionDriver(provider, limits.actionTimeoutMs, config.observation.visualFallback, () => provider.shutdown());
  }
  const driver = config.driver;

  return new PlaywrightDriver({
    connect: () => connectPlaywright(driver),
    maxNodes: config.observation.maxNodes,
    maxCharacters: config.observation.maxCharacters,
    visualFallback: config.observation.visualFallback,
    actionTimeoutMs: limits.actionTimeoutMs,
  });
}

async function connectPlaywright(
  driver: Exclude<Config['browser']['driver'], { kind: 'extension' }>,
): Promise<PlaywrightConnection> {
  if (driver.kind === 'remote') {
    const provider = driver.provider === 'browserbase'
      ? new BrowserbaseProvider({ type: driver.provider, apiKey: driver.apiKey, projectId: driver.projectId, region: driver.region })
      : new BrowserUseProvider({ type: driver.provider, apiKey: driver.apiKey, projectId: driver.projectId, region: driver.region });
    const connection = await provider.connect();
    return { ...connection, release: () => provider.disconnect() };
  }

  const playwright = await loadPlaywrightCoreModule();
  const chromium = playwright.chromium ?? (playwright as { default?: typeof playwright }).default?.chromium;
  if (!chromium) throw new Error('playwright-core did not expose Chromium');

  if (driver.kind === 'cdp') {
    const browser = await chromium.connectOverCDP(driver.endpoint);
    const context = browser.contexts()[0] ?? await browser.newContext();
    log.info({ kind: driver.kind }, 'Browser driver connected');
    return { browser, context };
  }

  const browser = await chromium.launch({
    headless: driver.headless,
    executablePath: driver.executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await createContext(browser);
  log.info({ kind: driver.kind, headless: driver.headless }, 'Browser driver connected');
  return { browser, context };
}

async function createContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 1280, height: 720 } });
}
