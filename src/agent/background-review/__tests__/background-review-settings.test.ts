import { describe, expect, it } from 'vitest';

import { ConfigSchema, type Config } from '../../../config/schema.js';
import type { UserContextConfig } from '../../../user-context/config.js';
import { resolveBackgroundReviewSettings } from '../settings.js';

function config(userModel?: Partial<UserContextConfig['userModel']>): Config {
  const base = ConfigSchema.parse({});
  return ConfigSchema.parse({
    ...base,
    userContext: {
      ...base.userContext,
      userModel: {
        ...base.userContext.userModel,
        ...userModel,
        extraction: { ...base.userContext.userModel.extraction, ...userModel?.extraction },
      },
    },
  });
}

describe('resolveBackgroundReviewSettings', () => {
  it('stays disabled without a resolvable agent configuration', () => {
    expect(resolveBackgroundReviewSettings(undefined)).toMatchObject({
      enabled: false,
      reviewIntervalTurns: 10,
    });
  });

  it('enables low-frequency user-model reviews', () => {
    expect(resolveBackgroundReviewSettings(config())).toEqual({
      enabled: true,
      reviewIntervalTurns: 10,
      maxHistoryMessages: 80,
      maxDurationMs: 120_000,
    });
  });

  it('respects user-model extraction overrides', () => {
    const overridden = resolveBackgroundReviewSettings(config({
      enabled: true,
      extraction: { reviewIntervalTurns: 3, maxHistoryMessages: 40, maxDurationMs: 45_000 },
    }));
    expect(overridden).toMatchObject({
      enabled: true,
      reviewIntervalTurns: 3,
      maxHistoryMessages: 40,
      maxDurationMs: 45_000,
    });
    expect(resolveBackgroundReviewSettings(config({ writePolicy: 'deny' })).enabled).toBe(true);
    expect(resolveBackgroundReviewSettings(config({ enabled: false })).enabled).toBe(false);
  });
});
