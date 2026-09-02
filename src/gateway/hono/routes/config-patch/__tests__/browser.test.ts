import { describe, expect, it } from 'vitest';

import type { Config } from '../../../../../config/schema.js';
import { applyMiscPatch } from '../misc.js';

describe('applyMiscPatch browser', () => {
  it('applies top-level browser config patches', async () => {
    const config = {
      browser: { enabled: true, backend: 'extension' },
      gateway: { port: 18790, corsOrigins: [] },
      agents: { default: 'main', list: [] },
      channels: {},
    } as unknown as Config;

    const result = await applyMiscPatch(config, {
      browser: {
        enabled: true,
        backend: 'cdp',
        cdpUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
      },
    });

    expect(result.ok).toBe(true);
    expect(config.browser).toMatchObject({
      enabled: true,
      backend: 'cdp',
      cdpUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
    });
  });
});
