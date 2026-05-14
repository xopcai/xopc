import type { Config } from '../../../config/schema.js';

import type { BrowserBackend } from './providers/types.js';

/**
 * Resolve Playwright browser backend from agent defaults.
 * Precedence: `cdpUrl` (direct CDP) → `cloudProvider` (remote session) → local Chromium.
 */
export function resolveBrowserBackendFromConfig(cfg: Config | undefined): BrowserBackend {
  const b = cfg?.agents?.defaults?.browser;
  const headless = b?.headless !== false;
  const cdpUrl = typeof b?.cdpUrl === 'string' ? b.cdpUrl.trim() : '';
  if (cdpUrl.length > 0) {
    return { mode: 'cdp', config: { wsEndpoint: cdpUrl } };
  }
  const cp = b?.cloudProvider;
  if (cp === 'browserbase' || cp === 'browser-use') {
    return { mode: 'cloud', config: { type: cp, apiKey: '' } };
  }
  return { mode: 'local', headless };
}
