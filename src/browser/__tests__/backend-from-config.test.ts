import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  cloakBrowserConfigFromAgentDefaults,
  resolveBrowserBackendFromConfig,
  shouldRunExtensionBridgeServer,
} from '../backend-from-config.js';
import { resolveBrowserCommandTimeoutMs } from '../browser-command-timeout.js';

function cfg(browser: Record<string, unknown>): Config {
  return { browser } as unknown as Config;
}

describe('resolveBrowserBackendFromConfig', () => {
  it('prefers cdpUrl over cloudProvider', () => {
    const b = resolveBrowserBackendFromConfig(
      cfg({ backend: 'cdp', cloudProvider: 'browserbase' as const, cdpUrl: 'ws://127.0.0.1:9222/devtools/browser/x' }),
    );
    expect(b.mode).toBe('cdp');
    if (b.mode === 'cdp') {
      expect(b.config.wsEndpoint).toContain('9222');
    }
  });

  it('uses cloud when no cdpUrl', () => {
    const b = resolveBrowserBackendFromConfig(cfg({ backend: 'cloud', cloudProvider: 'browser-use' as const }));
    expect(b.mode).toBe('cloud');
    if (b.mode === 'cloud') {
      expect(b.config.type).toBe('browser-use');
    }
  });

  it('uses extension when backend is extension', () => {
    const b = resolveBrowserBackendFromConfig(
      cfg({
        backend: 'extension' as const,
        extension: { port: 19999, host: '127.0.0.1', connectionTimeout: 5000 },
        commandTimeout: 45,
      }),
    );
    expect(b.mode).toBe('extension');
    if (b.mode === 'extension') {
      expect(b.config?.port).toBe(19999);
      expect(b.config?.host).toBe('127.0.0.1');
      expect(b.config?.connectionTimeout).toBe(5000);
      expect(b.config?.commandTimeout).toBe(45_000);
    }
  });

  it('prefers extension backend over cdpUrl when both set', () => {
    expect(
      resolveBrowserBackendFromConfig(
        cfg({ backend: 'extension' as const, cdpUrl: 'ws://127.0.0.1:9222/devtools/browser/x' }),
      ).mode,
    ).toBe('extension');
  });

  it('defaults to extension', () => {
    expect(resolveBrowserBackendFromConfig(undefined).mode).toBe('extension');
  });

  it('uses local only when backend is explicitly local', () => {
    const b = resolveBrowserBackendFromConfig(cfg({ backend: 'local' as const }));
    expect(b.mode).toBe('local');
    if (b.mode === 'local') expect(b.headless).toBe(false);
  });

  it('local headless only when explicitly local and headless true', () => {
    const b = resolveBrowserBackendFromConfig(cfg({ backend: 'local' as const, headless: true }));
    expect(b.mode).toBe('local');
    if (b.mode === 'local') expect(b.headless).toBe(true);
  });

  it('headless without backend still defaults to extension', () => {
    expect(resolveBrowserBackendFromConfig(cfg({ headless: true })).mode).toBe('extension');
  });

  it('uses cloakbrowser when backend is cloakbrowser', () => {
    const b = resolveBrowserBackendFromConfig(
      cfg({
        backend: 'cloakbrowser' as const,
        humanize: true,
        humanPreset: 'careful' as const,
        cloakbrowser: {
          keepOpen: true,
          temporaryProfile: false,
          timezone: 'America/New_York',
          locale: 'en-US',
          webrtcIp: '1.2.3.4',
        },
      }),
    );
    expect(b.mode).toBe('cloakbrowser');
    if (b.mode === 'cloakbrowser') {
      expect(b.config?.keepOpen).toBe(true);
      expect(b.config?.temporaryProfile).toBe(false);
      expect(b.config?.timezone).toBe('America/New_York');
      expect(b.config?.locale).toBe('en-US');
      expect(b.config?.webrtcIp).toBe('1.2.3.4');
      expect(b.config?.humanize).toBe(true);
      expect(b.config?.humanPreset).toBe('careful');
    }
  });

  it('cloakbrowser defaults humanize to true when not specified', () => {
    const b = resolveBrowserBackendFromConfig(cfg({ backend: 'cloakbrowser' as const }));
    expect(b.mode).toBe('cloakbrowser');
    if (b.mode === 'cloakbrowser') {
      expect(b.config?.humanize).toBe(true);
      expect(b.config?.humanPreset).toBe('careful');
    }
  });

  it('prefers cloakbrowser backend over cdpUrl when both set', () => {
    expect(
      resolveBrowserBackendFromConfig(
        cfg({ backend: 'cloakbrowser' as const, cdpUrl: 'ws://127.0.0.1:9222/devtools/browser/x' }),
      ).mode,
    ).toBe('cloakbrowser');
  });
});

describe('cloakBrowserConfigFromAgentDefaults', () => {
  it('builds headed launch config from saved cloakbrowser settings', () => {
    expect(
      cloakBrowserConfigFromAgentDefaults(
        cfg({
          backend: 'cloakbrowser' as const,
          headless: true,
          cloakbrowser: {
            keepOpen: true,
            temporaryProfile: false,
            cacheDir: '/Users/me/.xopc/bin/cloakbrowser',
            timezone: 'America/New_York',
            extraArgs: ['--disable-dev-shm-usage'],
          },
        }),
      ),
    ).toEqual({
      headless: false,
      keepOpen: true,
      temporaryProfile: false,
      cacheDir: '/Users/me/.xopc/bin/cloakbrowser',
      timezone: 'America/New_York',
      extraArgs: ['--disable-dev-shm-usage'],
      humanize: true,
      humanPreset: 'careful',
      reuseExisting: true,
    });
  });
});

describe('shouldRunExtensionBridgeServer', () => {
  it('starts for default extension backend (null backend)', () => {
    expect(shouldRunExtensionBridgeServer(cfg({ enabled: true }))).toBe(true);
  });

  it('starts when backend is explicitly extension', () => {
    expect(shouldRunExtensionBridgeServer(cfg({ backend: 'extension' as const }))).toBe(true);
  });

  it('does not start when browser is disabled', () => {
    expect(shouldRunExtensionBridgeServer(cfg({ enabled: false, backend: 'extension' as const }))).toBe(false);
  });

  it('does not start for local backend', () => {
    expect(shouldRunExtensionBridgeServer(cfg({ backend: 'local' as const }))).toBe(false);
  });

  it('does not start when cdpUrl selects CDP backend', () => {
    expect(
      shouldRunExtensionBridgeServer(cfg({ backend: 'cdp', cdpUrl: 'ws://127.0.0.1:9222/devtools/browser/x' })),
    ).toBe(false);
  });
});

describe('resolveBrowserCommandTimeoutMs', () => {
  it('defaults to 30s', () => {
    expect(resolveBrowserCommandTimeoutMs(undefined)).toBe(30_000);
  });

  it('respects configured seconds', () => {
    expect(resolveBrowserCommandTimeoutMs(cfg({ commandTimeout: 60 }))).toBe(60_000);
  });
});
