import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import { resolveBrowserBackendFromConfig } from '../backend-from-config.js';
import { resolveBrowserCommandTimeoutMs } from '../browser-command-timeout.js';

describe('resolveBrowserBackendFromConfig', () => {
  it('prefers cdpUrl over cloudProvider', () => {
    const cfg = {
      agents: {
        defaults: {
          browser: {
            cloudProvider: 'browserbase' as const,
            cdpUrl: 'ws://127.0.0.1:9222/devtools/browser/x',
          },
        },
      },
    } as unknown as Config;
    const b = resolveBrowserBackendFromConfig(cfg);
    expect(b.mode).toBe('cdp');
    if (b.mode === 'cdp') {
      expect(b.config.wsEndpoint).toContain('9222');
    }
  });

  it('uses cloud when no cdpUrl', () => {
    const cfg = {
      agents: { defaults: { browser: { cloudProvider: 'browser-use' as const } } },
    } as unknown as Config;
    const b = resolveBrowserBackendFromConfig(cfg);
    expect(b.mode).toBe('cloud');
    if (b.mode === 'cloud') {
      expect(b.config.type).toBe('browser-use');
    }
  });

  it('uses extension when backend is extension', () => {
    const cfg = {
      agents: {
        defaults: {
          browser: {
            backend: 'extension' as const,
            extension: { port: 19999, host: '127.0.0.1', connectionTimeout: 5000 },
            commandTimeout: 45,
          },
        },
      },
    } as unknown as Config;
    const b = resolveBrowserBackendFromConfig(cfg);
    expect(b.mode).toBe('extension');
    if (b.mode === 'extension') {
      expect(b.config?.port).toBe(19999);
      expect(b.config?.host).toBe('127.0.0.1');
      expect(b.config?.connectionTimeout).toBe(5000);
      expect(b.config?.commandTimeout).toBe(45_000);
    }
  });

  it('prefers extension backend over cdpUrl when both set', () => {
    const cfg = {
      agents: {
        defaults: {
          browser: {
            backend: 'extension' as const,
            cdpUrl: 'ws://127.0.0.1:9222/devtools/browser/x',
          },
        },
      },
    } as unknown as Config;
    expect(resolveBrowserBackendFromConfig(cfg).mode).toBe('extension');
  });

  it('defaults to extension', () => {
    expect(resolveBrowserBackendFromConfig(undefined).mode).toBe('extension');
  });

  it('uses local only when backend is explicitly local', () => {
    const cfg = { agents: { defaults: { browser: { backend: 'local' as const } } } } as unknown as Config;
    const b = resolveBrowserBackendFromConfig(cfg);
    expect(b.mode).toBe('local');
    if (b.mode === 'local') expect(b.headless).toBe(false);
  });

  it('local headless only when explicitly local and headless true', () => {
    const cfg = {
      agents: { defaults: { browser: { backend: 'local' as const, headless: true } } },
    } as unknown as Config;
    const b = resolveBrowserBackendFromConfig(cfg);
    expect(b.mode).toBe('local');
    if (b.mode === 'local') expect(b.headless).toBe(true);
  });

  it('headless without backend still defaults to extension', () => {
    const cfg = { agents: { defaults: { browser: { headless: true } } } } as unknown as Config;
    expect(resolveBrowserBackendFromConfig(cfg).mode).toBe('extension');
  });

  it('uses cloakbrowser when backend is cloakbrowser', () => {
    const cfg = {
      agents: {
        defaults: {
          browser: {
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
          },
        },
      },
    } as unknown as Config;
    const b = resolveBrowserBackendFromConfig(cfg);
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
    const cfg = {
      agents: {
        defaults: {
          browser: {
            backend: 'cloakbrowser' as const,
          },
        },
      },
    } as unknown as Config;
    const b = resolveBrowserBackendFromConfig(cfg);
    expect(b.mode).toBe('cloakbrowser');
    if (b.mode === 'cloakbrowser') {
      expect(b.config?.humanize).toBe(true);
      expect(b.config?.humanPreset).toBe('careful');
    }
  });

  it('prefers cloakbrowser backend over cdpUrl when both set', () => {
    const cfg = {
      agents: {
        defaults: {
          browser: {
            backend: 'cloakbrowser' as const,
            cdpUrl: 'ws://127.0.0.1:9222/devtools/browser/x',
          },
        },
      },
    } as unknown as Config;
    expect(resolveBrowserBackendFromConfig(cfg).mode).toBe('cloakbrowser');
  });
});

describe('resolveBrowserCommandTimeoutMs', () => {
  it('defaults to 30s', () => {
    expect(resolveBrowserCommandTimeoutMs(undefined)).toBe(30_000);
  });

  it('respects configured seconds', () => {
    const cfg = { agents: { defaults: { browser: { commandTimeout: 60 } } } } as unknown as Config;
    expect(resolveBrowserCommandTimeoutMs(cfg)).toBe(60_000);
  });
});
