import { describe, expect, it } from 'vitest';

import {
  isCuratedMemoryInPrompt,
  isMemorySubsystemEnabled,
  resolveBuiltinMemoryStoreConfig,
  shouldInjectMemoryPrefetchThisTurn,
} from '../memory-config.js';
import type { Config } from '../../../config/schema.js';
import type { AgentManifest } from '../../../agent-manifest/index.js';

function manifest(memory: AgentManifest['memory']): AgentManifest {
  return {
    id: 'main',
    enabled: true,
    identity: { name: 'main', role: 'Agent', language: 'en', tone: 'direct' },
    responsibilities: { primary: ['Help'] },
    workspace: { root: '/w' },
    models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4.1' } } },
    tools: { builtin: {} },
    skills: { mode: 'all' },
    memory,
    workflows: {},
    boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
  };
}

function cfg(memory: AgentManifest['memory']): Config {
  return {
    agents: {
      default: 'main',
      capabilityPresets: {},
      list: [manifest(memory)],
    },
  } as Config;
}

describe('memory-config', () => {
  it('isMemorySubsystemEnabled defaults true', () => {
    expect(isMemorySubsystemEnabled(undefined)).toBe(true);
    expect(isMemorySubsystemEnabled(cfg({ mode: 'confirmWrite', sources: ['session'] }))).toBe(true);
  });

  it('isMemorySubsystemEnabled respects enabled: false', () => {
    expect(
      isMemorySubsystemEnabled(cfg({ mode: 'off', sources: ['session'] })),
    ).toBe(false);
  });

  it('isCuratedMemoryInPrompt false when enabled or useEnhancedSystem off', () => {
    expect(isCuratedMemoryInPrompt(undefined)).toBe(true);
    expect(
      isCuratedMemoryInPrompt(cfg({ mode: 'off', sources: ['session'] })),
    ).toBe(false);
    expect(
      isCuratedMemoryInPrompt(cfg({ mode: 'confirmWrite', sources: ['session'] })),
    ).toBe(false);
  });

  it('resolveBuiltinMemoryStoreConfig applies limits and userProfileEnabled', () => {
    const base = resolveBuiltinMemoryStoreConfig('/w', undefined);
    expect(base.memoriesDir).toBe('/w/memories');
    expect(base.memoryCharLimit).toBe(2200);
    expect(base.userCharLimit).toBe(1375);
    expect(base.userProfileEnabled).toBe(true);

    const custom = resolveBuiltinMemoryStoreConfig(
      '/w',
      cfg({ mode: 'confirmWrite', sources: ['session'], retention: { compaction: true, maxItems: 100 } }),
    );
    expect(custom.memoryCharLimit).toBe(100);
    expect(custom.userProfileEnabled).toBe(false);
  });

  it('shouldInjectMemoryPrefetchThisTurn injects on every turn', () => {
    const c = cfg({ mode: 'confirmWrite', sources: ['session'] });
    expect(shouldInjectMemoryPrefetchThisTurn(c, 1)).toBe(true);
    expect(shouldInjectMemoryPrefetchThisTurn(c, 2)).toBe(true);
    expect(shouldInjectMemoryPrefetchThisTurn(c, 3)).toBe(true);
    expect(shouldInjectMemoryPrefetchThisTurn(c, 4)).toBe(true);
  });
});
