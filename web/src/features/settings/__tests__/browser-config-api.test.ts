import { describe, expect, it } from 'vitest';

import {
  buildBrowserConfig,
  parseBrowserSettings,
  validateBrowserSettings,
} from '../config-api';

describe('browser config API', () => {
  it('provides a usable CDP endpoint when no browser config exists', () => {
    const state = parseBrowserSettings({});

    expect(state.driverKind).toBe('extension');
    expect(state.cdpEndpoint).toBe('http://127.0.0.1:9222');
    expect(validateBrowserSettings(state)).toBeNull();
  });

  it('builds only the Browser Control v2 configuration shape', () => {
    const state = parseBrowserSettings({
      browser: {
        enabled: true,
        driver: { kind: 'cdp', endpoint: 'http://127.0.0.1:9333' },
        observation: { maxNodes: 240, maxCharacters: 16_000, visualFallback: false },
        limits: { actionTimeoutMs: 20_000, sessionTimeoutMs: 600_000, maxSequenceLength: 4 },
        security: {
          allowedPrivateHosts: ['localhost'],
          crossDomainNavigation: 'ask',
          uploads: 'deny',
          consequentialActions: 'allow',
        },
      },
    });

    expect(buildBrowserConfig(state)).toEqual({
      enabled: true,
      driver: { kind: 'cdp', endpoint: 'http://127.0.0.1:9333' },
      observation: { maxNodes: 240, maxCharacters: 16_000, visualFallback: false },
      limits: { actionTimeoutMs: 20_000, sessionTimeoutMs: 600_000, maxSequenceLength: 4 },
      security: {
        privateNetworks: 'deny',
        allowedPrivateHosts: ['localhost'],
        crossDomainNavigation: 'ask',
        uploads: 'deny',
        consequentialActions: 'allow',
      },
    });
  });

  it('rejects invalid URLs and out-of-range observation limits before autosave', () => {
    const state = parseBrowserSettings({});
    expect(validateBrowserSettings({ ...state, driverKind: 'cdp', cdpEndpoint: 'not a URL' })).toMatch(/valid CDP/i);
    expect(validateBrowserSettings({ ...state, maxNodes: 501 })).toMatch(/Max nodes/i);
  });
});
