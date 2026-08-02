import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import { mergeShareConfigPatch, resolveShareConfig } from '../share-config.js';
import { SHARE_CONFIG_DEFAULTS } from '../share-types.js';

describe('resolveShareConfig', () => {
  it('merges partial gateway.share with defaults', () => {
    const cfg = resolveShareConfig({ enabled: false, maxFileSize: 5_242_880 });
    expect(cfg.enabled).toBe(false);
    expect(cfg.maxFileSize).toBe(5_242_880);
    expect(cfg.defaultTtlMs).toBe(SHARE_CONFIG_DEFAULTS.defaultTtlMs);
    expect(cfg.maxTtlMs).toBe(2_592_000_000);
    expect(cfg.maxActiveShares).toBe(500);
    expect(cfg.directory.maxFolderSize).toBe(2_147_483_648);
    expect(cfg.directory.maxFileCount).toBe(10_000);
  });
});

describe('mergeShareConfigPatch', () => {
  it('writes gateway.share on config', () => {
    const config = {} as Config;
    const result = mergeShareConfigPatch(config, {
      enabled: true,
      defaultTtlMs: 3_600_000,
      maxTtlMs: 86_400_000,
      maxActiveShares: 50,
      maxFileSize: 52_428_800,
      inlinePreviewMimes: ['image/png'],
    });
    expect(result.ok).toBe(true);
    expect(config.gateway?.share?.defaultTtlMs).toBe(3_600_000);
    expect(config.gateway?.share?.inlinePreviewMimes).toEqual(['image/png']);
  });

  it('rejects defaultTtlMs greater than maxTtlMs', () => {
    const config = {} as Config;
    const result = mergeShareConfigPatch(config, {
      defaultTtlMs: 604_800_000,
      maxTtlMs: 86_400_000,
    });
    expect(result.ok).toBe(false);
  });
});
