import { describe, expect, it } from 'vitest';

import { ConfigSchema, type Config } from '../../../config/schema.js';
import type { UserContextConfig } from '../../../user-context/config.js';
import { resolveBackgroundReviewSettings } from '../settings.js';

function config(memory: UserContextConfig['memory'], understanding?: Partial<UserContextConfig['understanding']>): Config {
  const base = ConfigSchema.parse({});
  return ConfigSchema.parse({
    ...base,
    userContext: { ...base.userContext, memory, understanding: { ...base.userContext.understanding, ...understanding } },
  });
}

describe('resolveBackgroundReviewSettings', () => {
  it('stays disabled without a resolvable agent manifest', () => {
    expect(resolveBackgroundReviewSettings(undefined)).toMatchObject({
      enabled: false,
      reviewIntervalTurns: 10,
    });
  });

  it('enables low-frequency understanding reviews independently of generic memory writes', () => {
    expect(resolveBackgroundReviewSettings(config({
      mode: 'confirmWrite',
      sources: ['session'],
    }))).toEqual({
      enabled: true,
      adaptiveCadence: true,
      reviewIntervalTurns: 10,
      maxHistoryMessages: 80,
      maxDurationMs: 120_000,
    });
  });

  it('respects understanding overrides without coupling to generic memory access mode', () => {
    const overridden = resolveBackgroundReviewSettings(config({
      mode: 'auto',
      sources: ['session'],
    }, { enabled: true, adaptiveCadence: false, reviewIntervalTurns: 3, maxHistoryMessages: 40, maxDurationMs: 45_000 }));
    expect(overridden).toMatchObject({
      enabled: true,
      adaptiveCadence: false,
      reviewIntervalTurns: 3,
      maxHistoryMessages: 40,
      maxDurationMs: 45_000,
    });
    expect(resolveBackgroundReviewSettings(config({
      mode: 'readOnly',
      sources: ['session'],
    })).enabled).toBe(true);
    expect(resolveBackgroundReviewSettings(config({
      mode: 'confirmWrite',
      sources: ['session'],
    }, { enabled: false })).enabled).toBe(false);
  });
});
