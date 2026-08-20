import { describe, expect, it } from 'vitest';

import { ConfigSchema, type Config } from '../../../config/schema.js';
import type { UserContextConfig } from '../../../user-context/config.js';
import {
  isMemorySubsystemEnabled,
  shouldPlanUserContextThisTurn,
} from '../memory-config.js';
import { resolveCompactionPolicy } from '../compaction-policy.js';

function cfg(memory: UserContextConfig['memory'], enabled = true): Config {
  const base = ConfigSchema.parse({});
  return ConfigSchema.parse({ ...base, userContext: { ...base.userContext, enabled, memory } });
}

describe('memory-config', () => {
  it('uses the global user context enablement and mode', () => {
    expect(isMemorySubsystemEnabled(undefined)).toBe(true);
    expect(isMemorySubsystemEnabled(cfg({ mode: 'confirmWrite', sources: ['session'] }))).toBe(true);
    expect(isMemorySubsystemEnabled(cfg({ mode: 'off', sources: ['session'] }))).toBe(false);
    expect(isMemorySubsystemEnabled(cfg({ mode: 'auto', sources: ['session'] }, false))).toBe(false);
  });

  it('plans user context on every turn', () => {
    const config = cfg({ mode: 'confirmWrite', sources: ['session'] });
    expect([1, 2, 3, 4].map((turn) => shouldPlanUserContextThisTurn(config, turn))).toEqual([true, true, true, true]);
  });

  it('uses the single structured compaction policy and rejects the legacy boolean', () => {
    const parsed = ConfigSchema.parse({
      userContext: {
        memory: {
          mode: 'confirmWrite',
          sources: ['session'],
          retention: {
            compaction: {
              triggerThreshold: 0.7,
              reserveTokens: 12_000,
            },
          },
        },
      },
    });
    expect(resolveCompactionPolicy(parsed)).toMatchObject({
      triggerThreshold: 0.7,
      reserveTokens: 12_000,
      keepRecentTokens: 20_000,
    });
    expect(ConfigSchema.safeParse({
      userContext: {
        memory: {
          mode: 'confirmWrite',
          sources: ['session'],
          retention: { compaction: true },
        },
      },
    }).success).toBe(false);
  });
});
