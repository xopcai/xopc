import { describe, expect, it } from 'vitest';

import { mergeWithDefaults } from '../site-share-config.js';

describe('mergeWithDefaults', () => {
  it('uses the recommended site share defaults', () => {
    const config = mergeWithDefaults(undefined);

    expect(config.defaultTtlMs).toBe(86_400_000);
    expect(config.maxTtlMs).toBe(2_592_000_000);
    expect(config.maxActiveSites).toBe(50);
    expect(config.static.maxRootDirSize).toBe(1_073_741_824);
    expect(config.static.maxFileCount).toBe(20_000);
    expect(config.proxy.bodySizeLimit).toBe(52_428_800);
  });

  it('keeps explicit values while filling missing fields', () => {
    const config = mergeWithDefaults({
      maxActiveSites: 12,
      static: { maxFileCount: 5_000 },
    });

    expect(config.maxActiveSites).toBe(12);
    expect(config.static.maxFileCount).toBe(5_000);
    expect(config.static.maxRootDirSize).toBe(1_073_741_824);
  });
});
