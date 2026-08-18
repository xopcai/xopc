import { describe, expect, it } from 'vitest';

import type { Config } from '../schema.js';
import {
  mergeGatewaySkillsMarketplacePatch,
  mergeSessionConfigPatch,
  mergeUpdateConfigPatch,
  resolveSessionConfigForWeb,
  resolveUpdateConfigForWeb,
} from '../web-patch.js';

describe('web-patch merges', () => {
  it('merges session storage patch', () => {
    const config = { session: { dmScope: 'main' } } as Config;
    const result = mergeSessionConfigPatch(config, {
      dmScope: 'per-peer',
      storage: { pruneAfterMs: 86_400_000, maxEntries: 500 },
    });
    expect(result).toEqual({ ok: true });
    expect(config.session?.dmScope).toBe('per-peer');
    expect(config.session?.storage?.pruneAfterMs).toBe(86_400_000);
    expect(config.session?.storage?.maxEntries).toBe(500);
  });

  it('clears session storage fields when patch sends null', () => {
    const config = {
      session: {
        dmScope: 'main',
        storage: { pruneAfterMs: 86_400_000, maxEntries: 500 },
      },
    } as Config;
    const result = mergeSessionConfigPatch(config, {
      storage: { pruneAfterMs: null, maxEntries: null },
    });
    expect(result).toEqual({ ok: true });
    expect(config.session?.storage).toBeUndefined();
  });

  it('merges update auto nested fields', () => {
    const config = {
      update: { channel: 'stable', checkOnStart: true, auto: { enabled: false } },
    } as Config;
    const result = mergeUpdateConfigPatch(config, {
      checkOnStart: false,
      auto: { enabled: true, stableDelayHours: 8 },
    });
    expect(result).toEqual({ ok: true });
    expect(config.update?.checkOnStart).toBe(false);
    expect(config.update?.auto?.enabled).toBe(true);
    expect(config.update?.auto?.stableDelayHours).toBe(8);
  });

  it('merges gateway skills marketplace fields', () => {
    const config = {} as Config;
    const result = mergeGatewaySkillsMarketplacePatch(config, {
      skillsMarketplaceProvider: 'clawhub',
      skillsStoreBaseUrl: 'https://store.example.com/',
    });
    expect(result).toEqual({ ok: true });
    expect(config.gateway?.skillsMarketplaceProvider).toBe('clawhub');
    expect(config.gateway?.skillsStoreBaseUrl).toBe('https://store.example.com');
  });
});

describe('web-patch resolve helpers', () => {
  it('resolveSessionConfigForWeb converts pruneAfterMs to days', () => {
    expect(
      resolveSessionConfigForWeb({
        session: { dmScope: 'per-channel-peer', storage: { pruneAfterMs: 172_800_000, maxEntries: 100 } },
      } as Config),
    ).toEqual({
      dmScope: 'per-channel-peer',
      storage: { pruneAfterDays: 2, maxEntries: 100 },
    });
  });

  it('resolveUpdateConfigForWeb maps auto fields', () => {
    expect(
      resolveUpdateConfigForWeb({
        update: {
          checkOnStart: false,
          channel: 'beta',
          auto: { enabled: true, stableDelayHours: 4, betaCheckIntervalHours: 2 },
        },
      } as Config),
    ).toMatchObject({
      checkOnStart: false,
      channel: 'beta',
      auto: { enabled: true, stableDelayHours: 4, betaCheckIntervalHours: 2 },
    });
  });

});
