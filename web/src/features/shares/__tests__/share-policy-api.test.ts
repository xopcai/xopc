import { describe, expect, it } from 'vitest';

import {
  normalizeSharePolicyFromConfig,
  validateSharePolicy,
} from '../share-policy-api';

describe('normalizeSharePolicyFromConfig', () => {
  it('maps gateway.share fields', () => {
    const state = normalizeSharePolicyFromConfig({
      gateway: {
        share: {
          enabled: false,
          defaultTtlMs: 7_200_000,
          maxTtlMs: 259_200_000,
          maxActiveShares: 25,
          maxFileSize: 52_428_800,
          inlinePreviewMimes: ['application/pdf'],
        },
        siteShare: {
          maxActiveSites: 12,
        },
      },
    });
    expect(state.enabled).toBe(false);
    expect(state.defaultTtlHours).toBe(2);
    expect(state.maxTtlDays).toBe(3);
    expect(state.maxActiveShares).toBe(25);
    expect(state.maxActiveSites).toBe(12);
    expect(state.maxFileSizeMb).toBe(50);
    expect(state.inlinePreviewMimes).toEqual(['application/pdf']);
  });

  it('uses the default active site share limit when gateway.siteShare is absent', () => {
    const state = normalizeSharePolicyFromConfig({
      gateway: {
        share: {
          maxActiveShares: 100,
        },
      },
    });
    expect(state.maxActiveShares).toBe(100);
    expect(state.maxActiveSites).toBe(5);
  });
});

describe('validateSharePolicy', () => {
  it('rejects default TTL above max TTL', () => {
    const state = normalizeSharePolicyFromConfig({
      gateway: { share: { defaultTtlMs: 604_800_000, maxTtlMs: 86_400_000 } },
    });
    expect(validateSharePolicy(state)).toMatch(/Default TTL/i);
  });

  it('rejects active site share limits outside the backend range', () => {
    const state = normalizeSharePolicyFromConfig({});
    state.maxActiveSites = 1_001;
    expect(validateSharePolicy(state)).toMatch(/active site shares/i);
  });
});
