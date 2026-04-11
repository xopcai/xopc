import { describe, expect, it } from 'vitest';

import {
  isCuratedMemoryInPrompt,
  isMemorySubsystemEnabled,
  resolveBuiltinMemoryStoreConfig,
  shouldInjectMemoryPrefetchThisTurn,
} from '../memory-config.js';
import type { Config } from '../../../config/schema.js';

function cfg(overrides: Config['agents']): Config {
  return { agents: overrides };
}

describe('memory-config', () => {
  it('isMemorySubsystemEnabled defaults true', () => {
    expect(isMemorySubsystemEnabled(undefined)).toBe(true);
    expect(isMemorySubsystemEnabled(cfg({ defaults: {} }))).toBe(true);
  });

  it('isMemorySubsystemEnabled respects enabled: false', () => {
    expect(
      isMemorySubsystemEnabled(
        cfg({ defaults: { memory: { enabled: false } } }),
      ),
    ).toBe(false);
  });

  it('isCuratedMemoryInPrompt false when enabled or useEnhancedSystem off', () => {
    expect(isCuratedMemoryInPrompt(undefined)).toBe(true);
    expect(
      isCuratedMemoryInPrompt(cfg({ defaults: { memory: { enabled: false } } })),
    ).toBe(false);
    expect(
      isCuratedMemoryInPrompt(
        cfg({ defaults: { memory: { useEnhancedSystem: false } } }),
      ),
    ).toBe(false);
  });

  it('resolveBuiltinMemoryStoreConfig applies limits and userProfileEnabled', () => {
    const base = resolveBuiltinMemoryStoreConfig('/w', undefined);
    expect(base.memoriesDir).toBe('/w/.xopcbot/memories');
    expect(base.memoryCharLimit).toBe(2200);
    expect(base.userCharLimit).toBe(1375);
    expect(base.userProfileEnabled).toBe(true);

    const custom = resolveBuiltinMemoryStoreConfig(
      '/w',
      cfg({
        defaults: {
          memory: {
            memoryCharLimit: 100,
            userCharLimit: 50,
            userProfileEnabled: false,
          },
        },
      }),
    );
    expect(custom.memoryCharLimit).toBe(100);
    expect(custom.userCharLimit).toBe(50);
    expect(custom.userProfileEnabled).toBe(false);
  });

  it('shouldInjectMemoryPrefetchThisTurn: every-turn with cadence', () => {
    const c = cfg({
      defaults: { memory: { injectionFrequency: 'every-turn', contextCadence: 3 } },
    });
    expect(shouldInjectMemoryPrefetchThisTurn(c, 1)).toBe(true);
    expect(shouldInjectMemoryPrefetchThisTurn(c, 2)).toBe(false);
    expect(shouldInjectMemoryPrefetchThisTurn(c, 3)).toBe(false);
    expect(shouldInjectMemoryPrefetchThisTurn(c, 4)).toBe(true);
  });

  it('shouldInjectMemoryPrefetchThisTurn: first-turn only', () => {
    const c = cfg({ defaults: { memory: { injectionFrequency: 'first-turn' } } });
    expect(shouldInjectMemoryPrefetchThisTurn(c, 1)).toBe(true);
    expect(shouldInjectMemoryPrefetchThisTurn(c, 2)).toBe(false);
  });
});
