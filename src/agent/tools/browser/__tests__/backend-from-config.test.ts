import { describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';
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

  it('defaults to local', () => {
    expect(resolveBrowserBackendFromConfig(undefined).mode).toBe('local');
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
