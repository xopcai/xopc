import { describe, expect, it } from 'vitest';

import { ConfigSchema, type Config } from '../../../config/schema.js';
import {
  isMemorySubsystemEnabled,
  shouldPlanUserContextThisTurn,
} from '../memory-config.js';
import { resolveCompactionPolicy } from '../compaction-policy.js';

function config(input: Record<string, unknown> = {}): Config {
  return ConfigSchema.parse(input);
}

describe('memory-config', () => {
  it('uses global and knowledge-memory enablement', () => {
    expect(isMemorySubsystemEnabled(undefined)).toBe(true);
    expect(isMemorySubsystemEnabled(config())).toBe(true);
    expect(isMemorySubsystemEnabled(config({ userContext: { enabled: false } }))).toBe(false);
    expect(isMemorySubsystemEnabled(config({
      userContext: { knowledgeMemory: { enabled: false } },
    }))).toBe(false);
  });

  it('plans execution context on every real turn', () => {
    expect([1, 2, 3, 4].map((turn) => shouldPlanUserContextThisTurn(config(), turn)))
      .toEqual([true, true, true, true]);
  });

  it('uses the strict context-planning compaction policy', () => {
    const parsed = config({
      userContext: {
        contextPlanning: {
          compaction: { triggerThreshold: 0.7, reserveTokens: 12_000 },
        },
      },
    });
    expect(resolveCompactionPolicy(parsed)).toMatchObject({
      triggerThreshold: 0.7,
      reserveTokens: 12_000,
      keepRecentTokens: 20_000,
    });
    expect(ConfigSchema.safeParse({ userContext: { contextPlanning: { compaction: true } } }).success)
      .toBe(false);
  });
});
