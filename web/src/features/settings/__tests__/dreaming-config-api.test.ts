import { describe, expect, it } from 'vitest';

import { normalizeDreamingFromConfig } from '../dreaming-config-api';

describe('normalizeDreamingFromConfig', () => {
  it('reads resolved /api/dreaming config payloads', () => {
    const normalized = normalizeDreamingFromConfig({
      enabled: true,
      frequency: '0 3 * * *',
      timezone: 'Asia/Shanghai',
      phases: {
        light: { enabled: true, cron: '0 */6 * * *', lookbackDays: 2, limit: 100, dedupeSimilarity: 0.9 },
        deep: {
          enabled: true,
          cron: '30 2 * * *',
          minScore: 0.75,
          minRecallCount: 4,
          minUniqueQueries: 5,
          limit: 12,
          recencyHalfLifeDays: 10,
          maxAgeDays: 20,
        },
        rem: { enabled: false, cron: '0 5 * * 0', lookbackDays: 7, limit: 10, minPatternStrength: 0.75 },
      },
    });

    expect(normalized.enabled).toBe(true);
    expect(normalized.timezone).toBe('Asia/Shanghai');
    expect(normalized.deep.cron).toBe('30 2 * * *');
    expect(normalized.deep.minUniqueQueries).toBe(5);
    expect(normalized.rem.enabled).toBe(false);
  });
});
