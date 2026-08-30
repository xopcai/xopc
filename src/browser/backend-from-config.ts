import type { Config } from '../config/schema.js';

import type { BrowserBackend, CloakBrowserConfig } from './providers/types.js';

const DEFAULT_EXTENSION_HOST = '127.0.0.1';
const DEFAULT_EXTENSION_PORT = 19820;

export interface ExtensionBridgeServerConfig {
  host: string;
  port: number;
  connectionTimeout?: number;
  commandTimeout?: number;
}

/**
 * Whether the gateway should keep the Chrome extension WebSocket bridge listening.
 * True when browser tools are enabled and the resolved backend is extension (including default).
 */
export function shouldRunExtensionBridgeServer(cfg: Config | undefined): boolean {
  return cfg?.browser?.enabled !== false && resolveBrowserBackendFromConfig(cfg).mode === 'extension';
}

/** Resolve the extension bridge listener config, or null when that backend is inactive. */
export function resolveExtensionBridgeServerConfig(
  cfg: Config | undefined,
): ExtensionBridgeServerConfig | null {
  if (!shouldRunExtensionBridgeServer(cfg)) return null;

  const backend = resolveBrowserBackendFromConfig(cfg);
  if (backend.mode !== 'extension') return null;
  const config = backend.config;
  return {
    host: config?.host ?? DEFAULT_EXTENSION_HOST,
    port: config?.port ?? DEFAULT_EXTENSION_PORT,
    ...(config?.connectionTimeout !== undefined
      ? { connectionTimeout: config.connectionTimeout }
      : {}),
    ...(config?.commandTimeout !== undefined ? { commandTimeout: config.commandTimeout } : {}),
  };
}

/**
 * Resolve browser backend from root browser runtime config.
 * Precedence: `backend: 'extension'` → `cloakbrowser` → `cdpUrl` (CDP) → `cloudProvider` (remote) → `local` (explicit) → extension (default).
 */
export function resolveBrowserBackendFromConfig(cfg: Config | undefined): BrowserBackend {
  const browser = cfg?.browser;
  if (browser?.enabled === false) {
    return { mode: 'extension', config: {} };
  }
  const commandTimeout = resolveCommandTimeoutMs(browser?.commandTimeout);
  const backend = browser?.backend ?? 'extension';
  if (backend === 'extension') {
    const ext = browser?.extension;
    return {
      mode: 'extension',
      config: {
        ...(ext?.port !== undefined ? { port: ext.port } : {}),
        ...(ext?.host ? { host: ext.host } : {}),
        ...(ext?.connectionTimeout !== undefined ? { connectionTimeout: ext.connectionTimeout } : {}),
        commandTimeout,
      },
    };
  }
  if (backend === 'cloakbrowser') {
    return {
      mode: 'cloakbrowser',
      config: cloakBrowserConfigFromAgentDefaults(cfg),
    };
  }
  if (backend === 'cdp' && browser?.cdpUrl?.trim()) {
    return { mode: 'cdp', config: { wsEndpoint: browser.cdpUrl.trim() } };
  }
  if (backend === 'cloud') {
    const provider = browser?.cloudProvider === 'browserbase' || browser?.cloudProvider === 'browser-use'
      ? browser.cloudProvider
      : 'browserbase';
    return {
      mode: 'cloud',
      config: {
        type: provider,
        ...(browser?.cloud?.apiKey ? { apiKey: browser.cloud.apiKey } : {}),
        ...(browser?.cloud?.projectId ? { projectId: browser.cloud.projectId } : {}),
        ...(browser?.cloud?.region ? { region: browser.cloud.region } : {}),
      },
    };
  }
  if (backend === 'local') {
    return { mode: 'local', headless: browser?.headless === true };
  }
  return { mode: 'extension', config: { commandTimeout } };
}

/** CloakBrowser launch options aligned with saved agent defaults (headed for manual use). */
export function cloakBrowserConfigFromAgentDefaults(cfg: Config | undefined): CloakBrowserConfig {
  const browser = cfg?.browser;
  const cloak = browser?.cloakbrowser;
  return {
    headless: false,
    ...(cloak?.keepOpen !== undefined ? { keepOpen: cloak.keepOpen } : {}),
    ...(cloak?.temporaryProfile !== undefined ? { temporaryProfile: cloak.temporaryProfile } : {}),
    ...(cloak?.cacheDir ? { cacheDir: cloak.cacheDir } : {}),
    ...(cloak?.binaryPath ? { binaryPath: cloak.binaryPath } : {}),
    ...(cloak?.timezone ? { timezone: cloak.timezone } : {}),
    ...(cloak?.locale ? { locale: cloak.locale } : {}),
    ...(cloak?.webrtcIp ? { webrtcIp: cloak.webrtcIp } : {}),
    ...(cloak?.fingerprintPlatform ? { fingerprintPlatform: cloak.fingerprintPlatform } : {}),
    ...(cloak?.extraArgs ? { extraArgs: cloak.extraArgs } : {}),
    humanize: browser?.humanize ?? true,
    humanPreset: browser?.humanPreset ?? 'careful',
    reuseExisting: true,
  };
}

function resolveCommandTimeoutMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 30_000;
  return Math.min(900, Math.max(5, Math.floor(value))) * 1000;
}
