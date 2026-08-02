import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchJson, revalidateGatewayConfig } = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  revalidateGatewayConfig: vi.fn(),
}));

vi.mock('@/lib/fetch', () => ({ fetchJson }));
vi.mock('@/features/gateway/gateway-config-swr', () => ({ revalidateGatewayConfig }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));

import {
  getRecommendedSharePolicy,
  normalizeSharePolicyFromConfig,
  patchSharePolicy,
  validateSharePolicy,
} from '../share-policy-api';

beforeEach(() => {
  fetchJson.mockReset();
  revalidateGatewayConfig.mockReset();
});

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
          directory: {
            maxFolderSize: 1_073_741_824,
            maxFileCount: 2_500,
          },
        },
        siteShare: {
          enabled: false,
          defaultTtlMs: 43_200_000,
          maxTtlMs: 1_209_600_000,
          maxActiveSites: 12,
          static: {
            maxRootDirSize: 805_306_368,
            maxFileCount: 15_000,
          },
        },
      },
    });
    expect(state.enabled).toBe(false);
    expect(state.defaultTtlHours).toBe(2);
    expect(state.maxTtlDays).toBe(3);
    expect(state.maxActiveShares).toBe(25);
    expect(state.maxFileSizeMb).toBe(50);
    expect(state.directoryMaxFolderSizeMb).toBe(1_024);
    expect(state.directoryMaxFileCount).toBe(2_500);
    expect(state.inlinePreviewMimes).toEqual(['application/pdf']);
    expect(state.siteEnabled).toBe(false);
    expect(state.siteDefaultTtlHours).toBe(12);
    expect(state.siteMaxTtlDays).toBe(14);
    expect(state.maxActiveSites).toBe(12);
    expect(state.siteMaxRootDirSizeMb).toBe(768);
    expect(state.siteMaxFileCount).toBe(15_000);
  });

  it('uses the recommended defaults when share config is absent', () => {
    const state = normalizeSharePolicyFromConfig({});
    expect(state).toEqual(getRecommendedSharePolicy());
  });

  it('keeps explicit active share limits', () => {
    const state = normalizeSharePolicyFromConfig({
      gateway: {
        share: {
          maxActiveShares: 100,
        },
      },
    });
    expect(state.maxActiveShares).toBe(100);
    expect(state.maxActiveSites).toBe(50);
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

  it('validates site TTL independently from file TTL', () => {
    const state = normalizeSharePolicyFromConfig({});
    state.siteDefaultTtlHours = 48;
    state.siteMaxTtlDays = 1;
    expect(validateSharePolicy(state)).toMatch(/Default site TTL/i);
  });
});

describe('patchSharePolicy', () => {
  it('writes independent file, directory, and site policy values', async () => {
    fetchJson.mockResolvedValue({ ok: true });

    await patchSharePolicy(getRecommendedSharePolicy());

    const init = fetchJson.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      gateway: {
        share: {
          defaultTtlMs: 86_400_000,
          maxTtlMs: 2_592_000_000,
          maxActiveShares: 500,
          maxFileSize: 524_288_000,
          directory: {
            maxFolderSize: 2_147_483_648,
            maxFileCount: 10_000,
          },
        },
        siteShare: {
          enabled: true,
          defaultTtlMs: 86_400_000,
          maxTtlMs: 2_592_000_000,
          maxActiveSites: 50,
          static: {
            maxRootDirSize: 1_073_741_824,
            maxFileCount: 20_000,
          },
        },
      },
    });
    expect(revalidateGatewayConfig).toHaveBeenCalledOnce();
  });
});
