import { describe, expect, it } from 'vitest';

import { normalizeCronGlobalsFromConfig } from '@/features/cron/cron-globals-api';
import { normalizeGoalsConfigFromConfig } from '@/features/settings/goals-config-api';
import { normalizeGatewayFromConfig } from '@/features/settings/gateway-config-api';
import { normalizeSessionConfigFromConfig } from '@/features/settings/session-config-api';
import { normalizeWebSearchSettingsFromConfig } from '@/features/settings/web-search-config-api';
import { normalizeSkillsMarketplaceFromConfig } from '@/features/skills/skills-marketplace-config-api';

describe('Phase D config API normalizers', () => {
  it('normalizeWebSearchSettingsFromConfig maps blocklist', () => {
    const state = normalizeWebSearchSettingsFromConfig({
      tools: {
        web: {
          blocklist: { enabled: true, domains: ['evil.com', 'ads.net'] },
        },
      },
    });
    expect(state.blocklistEnabled).toBe(true);
    expect(state.blocklistDomains).toEqual(['evil.com', 'ads.net']);
  });

  it('normalizeGatewayFromConfig maps update auto fields', () => {
    const state = normalizeGatewayFromConfig({
      update: {
        channel: 'beta',
        checkOnStart: false,
        auto: {
          enabled: true,
          stableDelayHours: 12,
          stableJitterHours: 6,
          betaCheckIntervalHours: 2,
        },
      },
    });
    expect(state.updateChannel).toBe('beta');
    expect(state.updateCheckOnStart).toBe(false);
    expect(state.updateAutoEnabled).toBe(true);
    expect(state.updateAutoStableDelayHours).toBe(12);
    expect(state.updateAutoStableJitterHours).toBe(6);
    expect(state.updateAutoBetaCheckIntervalHours).toBe(2);
  });

  it('normalizeCronGlobalsFromConfig maps cron fields', () => {
    const state = normalizeCronGlobalsFromConfig({
      cron: {
        enabled: false,
        maxConcurrentJobs: 8,
        defaultTimezone: 'Asia/Shanghai',
        historyRetentionDays: 14,
        enableMetrics: false,
      },
    });
    expect(state).toEqual({
      enabled: false,
      maxConcurrentJobs: 8,
      defaultTimezone: 'Asia/Shanghai',
      historyRetentionDays: 14,
      enableMetrics: false,
    });
  });

  it('normalizeGoalsConfigFromConfig maps judge timeout to seconds', () => {
    const state = normalizeGoalsConfigFromConfig({
      goals: { judgeTimeoutMs: 90_000, maxTurns: 25 },
    });
    expect(state.judgeTimeoutSec).toBe(90);
    expect(state.maxTurns).toBe(25);
  });

  it('normalizeSessionConfigFromConfig maps storage', () => {
    const state = normalizeSessionConfigFromConfig({
      session: {
        dmScope: 'per-account-channel-peer',
        storage: { pruneAfterMs: 86_400_000, maxEntries: 200 },
      },
    });
    expect(state.dmScope).toBe('per-account-channel-peer');
    expect(state.pruneAfterDays).toBe(1);
    expect(state.maxEntries).toBe(200);
  });

  it('normalizeSkillsMarketplaceFromConfig maps gateway fields', () => {
    const state = normalizeSkillsMarketplaceFromConfig({
      gateway: {
        skillsMarketplaceProvider: 'store',
        skillsStoreBaseUrl: 'https://custom.store/',
      },
    });
    expect(state.provider).toBe('store');
    expect(state.storeBaseUrl).toBe('https://custom.store');
  });
});
