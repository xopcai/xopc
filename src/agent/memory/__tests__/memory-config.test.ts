import { describe, expect, it } from 'vitest';

import {
  isCuratedMemoryInPrompt,
  isMemorySubsystemEnabled,
  resolveBuiltinMemoryStoreConfig,
  shouldPlanUserContextThisTurn,
} from '../memory-config.js';
import type { Config } from '../../../config/schema.js';
import type { AgentManifest } from '../../../agent-manifest/index.js';

function manifest(
  memory: AgentManifest['memory'],
  id = 'main',
  workspaceRoot = '/w',
): AgentManifest {
  return {
    id,
    enabled: true,
    identity: { name: id, role: 'Agent', language: 'en', tone: 'direct' },
    responsibilities: { primary: ['Help'] },
    workspace: { root: workspaceRoot },
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
    expect(base.memoriesDir.replace(/\\/g, '/')).toBe('/w/memories');
    expect(base.userMemoryPath.replace(/\\/g, '/')).toBe('/w/user/MEMORY.md');
    expect(base.memoryCharLimit).toBe(2200);
    expect(base.userCharLimit).toBe(1375);
    expect(base.userProfileEnabled).toBe(true);

    const custom = resolveBuiltinMemoryStoreConfig(
      '/w',
      cfg({ mode: 'confirmWrite', sources: ['session'], retention: { compaction: true, maxItems: 100, maxChars: 900 } }),
    );
    expect(custom.memoryCharLimit).toBe(900);
    expect(custom.userProfileEnabled).toBe(false);
  });

  it('resolves memory configuration by explicit agent id for a shared workspace', () => {
    const config = {
      agents: {
        default: 'main',
        capabilityPresets: {},
        list: [
          manifest({ mode: 'confirmWrite', sources: ['session'], retention: { maxChars: 800 } }, 'main', '/shared'),
          manifest({ mode: 'auto', sources: ['session', 'userProfile'], retention: { maxChars: 1600 } }, 'research', '/shared'),
        ],
      },
    } as Config;

    const main = resolveBuiltinMemoryStoreConfig('/shared', config, 'main');
    const research = resolveBuiltinMemoryStoreConfig('/shared', config, 'research');

    expect(main.memoriesDir.replace(/\\/g, '/')).toContain('/agents/main/memories');
    expect(research.memoriesDir.replace(/\\/g, '/')).toContain('/agents/research/memories');
    expect(main.memoryCharLimit).toBe(800);
    expect(research.memoryCharLimit).toBe(1600);
    expect(main.userProfileEnabled).toBe(false);
    expect(research.userProfileEnabled).toBe(true);
  });

  it('shouldPlanUserContextThisTurn plans on every turn', () => {
    const c = cfg({ mode: 'confirmWrite', sources: ['session'] });
    expect(shouldPlanUserContextThisTurn(c, 1)).toBe(true);
    expect(shouldPlanUserContextThisTurn(c, 2)).toBe(true);
    expect(shouldPlanUserContextThisTurn(c, 3)).toBe(true);
    expect(shouldPlanUserContextThisTurn(c, 4)).toBe(true);
  });
});
