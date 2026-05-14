import type { Config } from '../config/schema.js';

import type { BrowserBackend } from './providers/types.js';

/**
 * Resolve browser backend from agent defaults.
 * Precedence: `backend: 'extension'` → `cdpUrl` (CDP) → `cloudProvider` (remote) → local Playwright Chromium.
 */
export function resolveBrowserBackendFromConfig(cfg: Config | undefined): BrowserBackend {
  const b = cfg?.agents?.defaults?.browser;
  const headless = b?.headless === true;

  if (b?.backend === 'extension') {
    const ex = b.extension;
    const cmdSec = b.commandTimeout;
    return {
      mode: 'extension',
      config: {
        port: ex?.port,
        host: ex?.host,
        connectionTimeout: ex?.connectionTimeout,
        commandTimeout:
          typeof cmdSec === 'number' && Number.isFinite(cmdSec) && cmdSec > 0
            ? Math.floor(cmdSec * 1000)
            : undefined,
      },
    };
  }

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
