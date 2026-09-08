import { describe, expect, it } from 'vitest';

import type { Config } from '../../../../../config/schema.js';
import { applyMiscPatch } from '../misc.js';

describe('applyMiscPatch browser', () => {
  it('applies top-level browser config patches', async () => {
    const config = {
      browser: { enabled: true, driver: { kind: 'extension' } },
      gateway: { port: 18790, corsOrigins: [] },
      agents: { default: 'main', list: [] },
      channels: {},
    } as unknown as Config;

    const result = await applyMiscPatch(config, {
      browser: {
        enabled: true,
        driver: { kind: 'cdp', endpoint: 'ws://127.0.0.1:9222/devtools/browser/test' },
      },
    });

    expect(result.ok).toBe(true);
    expect(config.browser).toMatchObject({
      enabled: true,
      driver: { kind: 'cdp', endpoint: 'ws://127.0.0.1:9222/devtools/browser/test' },
    });
  });

  it('preserves a stored remote API key when the UI submits its mask', async () => {
    const config = {
      browser: {
        enabled: true,
        driver: { kind: 'remote', provider: 'browserbase', apiKey: 'stored-secret' },
      },
      gateway: { port: 18790, corsOrigins: [] },
      agents: { default: 'main', list: [] },
      channels: {},
    } as unknown as Config;

    const result = await applyMiscPatch(config, {
      browser: {
        enabled: true,
        driver: { kind: 'remote', provider: 'browserbase', apiKey: '••••••••••••' },
      },
    });

    expect(result.ok).toBe(true);
    expect(config.browser.driver).toMatchObject({ apiKey: 'stored-secret' });
  });

  it('rejects removed browser configuration fields', async () => {
    const config = {
      browser: { enabled: true, driver: { kind: 'extension' } },
      gateway: { port: 18790, corsOrigins: [] },
      agents: { default: 'main', list: [] },
      channels: {},
    } as unknown as Config;

    const result = await applyMiscPatch(config, {
      browser: { enabled: true, backend: 'extension' },
    });

    expect(result.ok).toBe(false);
  });
});
