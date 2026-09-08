import { access } from 'node:fs/promises';

import type { Config } from '../config/schema.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('BrowserReadiness');

export type BrowserDriverKind = Config['browser']['driver']['kind'];
export type BrowserNotReadyReason =
  | 'extension_not_installed'
  | 'extension_not_connected'
  | 'chromium_missing'
  | 'cdp_unreachable'
  | 'remote_api_key_missing';

export interface BrowserSetupHint {
  driver: BrowserDriverKind;
  reason: BrowserNotReadyReason;
  detail?: string;
  deepLink: string;
}

export class BrowserNotReadyError extends Error {
  constructor(public readonly hint: BrowserSetupHint) {
    super(`Browser driver "${hint.driver}" is not ready: ${hint.reason}`);
    this.name = 'BrowserNotReadyError';
  }
}

export function buildBrowserSetupDeepLink(driver: BrowserDriverKind): string {
  return `/settings/agent-browser?driver=${driver}`;
}

export async function checkBrowserReadiness(cfg: Config | undefined): Promise<BrowserNotReadyError | null> {
  if (!cfg?.browser.enabled) return null;
  const driver = cfg.browser.driver;
  let detail: string | null = null;
  let reason: BrowserNotReadyReason | null = null;
  try {
    if (driver.kind === 'extension') {
      const { browserExtDoctor } = await import('./providers/browser-ext-install.js');
      const doctor = await browserExtDoctor();
      if (!doctor.installed) {
        reason = 'extension_not_installed';
        detail = 'Chrome extension artifacts are not installed.';
      }
    } else if (driver.kind === 'playwright') {
      if (driver.executablePath) {
        await access(driver.executablePath);
      } else {
        const { playwrightChromiumDoctor } = await import('./providers/playwright-doctor.js');
        const doctor = await playwrightChromiumDoctor();
        if (!doctor.installed) {
          reason = 'chromium_missing';
          detail = doctor.reason ?? 'Chromium binary was not found.';
        }
      }
    } else if (driver.kind === 'cdp') {
      const probe = new URL(driver.endpoint);
      probe.protocol = probe.protocol === 'wss:' ? 'https:' : 'http:';
      probe.pathname = '/json/version';
      probe.search = '';
      probe.hash = '';
      const response = await fetch(probe, { signal: AbortSignal.timeout(2_000) });
      if (!response.ok) {
        reason = 'cdp_unreachable';
        detail = `CDP endpoint returned HTTP ${response.status}.`;
      }
    } else {
      const envKey = driver.provider === 'browserbase'
        ? process.env.BROWSERBASE_API_KEY
        : process.env.BROWSER_USE_API_KEY;
      if (!driver.apiKey?.trim() && !envKey?.trim()) {
        reason = 'remote_api_key_missing';
        detail = `No API key is configured for ${driver.provider}.`;
      }
    }
  } catch (error) {
    log.debug({ err: error, driver: driver.kind }, 'Browser readiness probe failed');
    reason = driver.kind === 'cdp' ? 'cdp_unreachable'
      : driver.kind === 'extension' ? 'extension_not_connected'
      : 'chromium_missing';
    detail = error instanceof Error ? error.message : String(error);
  }

  if (!reason) return null;
  return new BrowserNotReadyError({
    driver: driver.kind,
    reason,
    detail: detail ?? undefined,
    deepLink: buildBrowserSetupDeepLink(driver.kind),
  });
}
