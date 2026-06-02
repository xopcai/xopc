/**
 * Backend readiness preflight for the `browser_use` tool.
 *
 * Reuses the same doctor functions that power the Settings → Browser page so
 * the agent never tries to launch a backend that the UI already knows is
 * broken. Produces a structured signal the chat surface can render as a
 * "Setup browser" card instead of a bare error string.
 */

import type { Config } from '../config/schema.js';

import { resolveBrowserBackendFromConfig } from './backend-from-config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('browser-readiness');

export type BrowserBackendKind =
  | 'extension'
  | 'local'
  | 'cloakbrowser'
  | 'cdp'
  | 'cloud';

export type BrowserNotReadyReason =
  | 'extension_not_installed'
  | 'extension_bridge_offline'
  | 'extension_not_connected'
  | 'local_chromium_missing'
  | 'cloakbrowser_not_installed'
  | 'cdp_unreachable'
  | 'cloud_api_key_missing';

export interface BrowserSetupHint {
  backend: BrowserBackendKind;
  reason: BrowserNotReadyReason;
  /** Raw probe diagnostic; surfaced behind a disclosure for debugging. */
  detail?: string;
  /** Deep link into Settings → Browser focused on the right backend tab. */
  deepLink: string;
}

export class BrowserNotReadyError extends Error {
  constructor(public readonly hint: BrowserSetupHint) {
    super(`Browser backend "${hint.backend}" not ready: ${hint.reason}`);
    this.name = 'BrowserNotReadyError';
  }
}

/** Map backend → settings tab id (matches `BROWSER_BACKEND_TABS` on the web side). */
export function buildBrowserSetupDeepLink(backend: BrowserBackendKind): string {
  return `/settings/agent-browser?tab=${backend}`;
}

function hint(
  backend: BrowserBackendKind,
  reason: BrowserNotReadyReason,
  detail?: string,
): BrowserSetupHint {
  return { backend, reason, detail, deepLink: buildBrowserSetupDeepLink(backend) };
}

async function checkExtension(cfg: Config | undefined): Promise<BrowserSetupHint | null> {
  try {
    const { browserExtDoctor } = await import('./providers/browser-ext-install.js');
    const doctor = await browserExtDoctor();
    if (!doctor.installed) {
      return hint('extension', 'extension_not_installed', 'extension artifacts not on disk');
    }
  } catch (e) {
    return hint('extension', 'extension_not_installed', e instanceof Error ? e.message : String(e));
  }

  const ext = cfg?.agents?.defaults?.browser?.extension;
  const host = (typeof ext?.host === 'string' && ext.host.trim()) ? ext.host.trim() : '127.0.0.1';
  const port = (typeof ext?.port === 'number' && ext.port >= 1024 && ext.port <= 65535)
    ? Math.floor(ext.port)
    : 19820;

  try {
    const { getExtensionBrowserServerSnapshot } = await import(
      './providers/extension-ws-acquire.js'
    );
    const snapshot = getExtensionBrowserServerSnapshot();
    if (snapshot.active) {
      // Probe the HTTP `/` health endpoint to read `.connected`.
      try {
        const res = await fetch(`http://${host}:${port}/`, {
          signal: AbortSignal.timeout(2000),
        });
        const data = (await res.json().catch(() => null)) as { connected?: boolean } | null;
        if (data?.connected) return null;
        return hint(
          'extension',
          'extension_not_connected',
          'WS bridge is listening but no Chrome Extension client connected yet',
        );
      } catch {
        // Bridge claims active but health probe failed — treat as offline.
        return hint('extension', 'extension_bridge_offline', `health probe failed on ${host}:${port}`);
      }
    }
    return hint('extension', 'extension_bridge_offline', `bridge not started on ${host}:${port}`);
  } catch (e) {
    return hint(
      'extension',
      'extension_bridge_offline',
      e instanceof Error ? e.message : String(e),
    );
  }
}

async function checkLocal(): Promise<BrowserSetupHint | null> {
  try {
    const { playwrightChromiumDoctor } = await import('./providers/playwright-doctor.js');
    const doctor = await playwrightChromiumDoctor();
    if (!doctor.installed) {
      return hint(
        'local',
        'local_chromium_missing',
        doctor.reason ?? 'Chromium binary not found on disk',
      );
    }
    return null;
  } catch (e) {
    return hint('local', 'local_chromium_missing', e instanceof Error ? e.message : String(e));
  }
}

async function checkCloak(cfg: Config | undefined): Promise<BrowserSetupHint | null> {
  const cb = cfg?.agents?.defaults?.browser?.cloakbrowser;
  try {
    const { cloakBrowserDoctor } = await import('./providers/cloakbrowser.js');
    const doctor = await cloakBrowserDoctor({
      cacheDir: cb?.cacheDir,
      binaryPath: cb?.binaryPath,
    });
    if (!doctor.installed) {
      return hint(
        'cloakbrowser',
        'cloakbrowser_not_installed',
        `CloakBrowser binary not found (cacheDir=${doctor.cacheDir})`,
      );
    }
    return null;
  } catch (e) {
    return hint(
      'cloakbrowser',
      'cloakbrowser_not_installed',
      e instanceof Error ? e.message : String(e),
    );
  }
}

async function checkCdp(cdpUrl: string): Promise<BrowserSetupHint | null> {
  let httpBase: URL;
  try {
    httpBase = new URL(cdpUrl);
    httpBase.protocol = httpBase.protocol === 'wss:' ? 'https:' : 'http:';
    httpBase.pathname = '/json/version';
    httpBase.search = '';
    httpBase.hash = '';
  } catch (e) {
    return hint('cdp', 'cdp_unreachable', `invalid cdpUrl: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const res = await fetch(httpBase.toString(), { signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      return hint('cdp', 'cdp_unreachable', `HTTP ${res.status} from ${httpBase.toString()}`);
    }
    return null;
  } catch (e) {
    return hint('cdp', 'cdp_unreachable', e instanceof Error ? e.message : String(e));
  }
}

function checkCloud(cfg: Config | undefined, providerType: 'browserbase' | 'browser-use'): BrowserSetupHint | null {
  const cloud = cfg?.agents?.defaults?.browser?.cloud;
  const cfgKey = typeof cloud?.apiKey === 'string' ? cloud.apiKey.trim() : '';
  if (cfgKey) return null;
  const envKey =
    providerType === 'browserbase'
      ? process.env.BROWSERBASE_API_KEY?.trim()
      : process.env.BROWSER_USE_API_KEY?.trim();
  if (envKey) return null;
  return hint(
    'cloud',
    'cloud_api_key_missing',
    `no API key configured for ${providerType}`,
  );
}

/**
 * Probe the currently-configured browser backend. Returns `null` when ready.
 *
 * Probe budget is small (filesystem stats + loopback fetches with a 2s timeout)
 * so it's safe to call before every `browser_use` invocation — but callers
 * typically cache the result for a few seconds to handle bursts.
 */
export async function checkBrowserReadiness(
  cfg: Config | undefined,
): Promise<BrowserNotReadyError | null> {
  const backend = resolveBrowserBackendFromConfig(cfg);
  let probe: BrowserSetupHint | null = null;
  try {
    switch (backend.mode) {
      case 'extension':
        probe = await checkExtension(cfg);
        break;
      case 'local':
        probe = await checkLocal();
        break;
      case 'cloakbrowser':
        probe = await checkCloak(cfg);
        break;
      case 'cdp':
        probe = await checkCdp(backend.config.wsEndpoint);
        break;
      case 'cloud':
        probe = checkCloud(cfg, backend.config.type);
        break;
    }
  } catch (e) {
    log.warn({ err: e, backend: backend.mode }, 'Readiness probe threw unexpectedly');
    return null;
  }
  return probe ? new BrowserNotReadyError(probe) : null;
}
