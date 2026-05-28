import type { Config } from '../config/schema.js';

import type { BrowserBackend } from './providers/types.js';

/**
 * Resolve browser backend from agent defaults.
 * Precedence: `backend: 'extension'` → `cloakbrowser` → `cdpUrl` (CDP) → `cloudProvider` (remote) → `local` (explicit) → extension (default).
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

  if (b?.backend === 'cloakbrowser') {
    const cb = b.cloakbrowser;
    return {
      mode: 'cloakbrowser',
      config: {
        headless,
        keepOpen: cb?.keepOpen,
        temporaryProfile: cb?.temporaryProfile,
        cacheDir: cb?.cacheDir,
        binaryPath: cb?.binaryPath,
        timezone: cb?.timezone,
        locale: cb?.locale,
        webrtcIp: cb?.webrtcIp,
        fingerprintPlatform: cb?.fingerprintPlatform,
        extraArgs: cb?.extraArgs,
        humanize: b.humanize ?? true,
        humanPreset: (b.humanPreset as 'default' | 'careful') ?? 'careful',
      },
    };
  }

  const cdpUrl = typeof b?.cdpUrl === 'string' ? b.cdpUrl.trim() : '';
  if (cdpUrl.length > 0) {
    return { mode: 'cdp', config: { wsEndpoint: cdpUrl } };
  }
  const cp = b?.cloudProvider;
  if (cp === 'browserbase' || cp === 'browser-use') {
    const cloud = b.cloud;
    const apiKey = typeof cloud?.apiKey === 'string' ? cloud.apiKey.trim() : undefined;
    const projectId = typeof cloud?.projectId === 'string' ? cloud.projectId.trim() : undefined;
    const region = typeof cloud?.region === 'string' ? cloud.region.trim() : undefined;
    return {
      mode: 'cloud',
      config: {
        type: cp,
        ...(apiKey ? { apiKey } : {}),
        ...(projectId ? { projectId } : {}),
        ...(region ? { region } : {}),
      },
    };
  }

  if (b?.backend === 'local') {
    return { mode: 'local', headless };
  }

  const ex = b?.extension;
  const cmdSec = b?.commandTimeout;
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
