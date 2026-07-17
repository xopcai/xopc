import { describe, expect, it } from 'vitest';

import type { AgentManifest } from '../../../agent-manifest/index.js';
import type { Config } from '../../../config/schema.js';
import { WorkspaceRuntimeRegistry } from '../registry.js';

function manifest(id: string, memory: AgentManifest['memory']): AgentManifest {
  return {
    id,
    enabled: true,
    identity: { name: id, role: 'Agent', language: 'en', tone: 'direct' },
    responsibilities: { primary: ['Help'] },
    workspace: { root: '/shared' },
    models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4.1' } } },
    tools: { builtin: {} },
    skills: { mode: 'all' },
    memory,
    workflows: {},
    boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
  };
}

describe('WorkspaceRuntimeRegistry', () => {
  it('isolates memory runtimes by agent id when agents share a workspace', async () => {
    const config = {
      agents: {
        default: 'main',
        capabilityPresets: {},
        list: [
          manifest('main', { mode: 'confirmWrite', sources: ['session'], retention: { maxChars: 800 } }),
          manifest('research', { mode: 'auto', sources: ['session', 'userProfile'], retention: { maxChars: 1600 } }),
        ],
      },
    } as Config;
    const registry = new WorkspaceRuntimeRegistry({
      getConfig: () => config,
      bundledSkillsDir: '/tmp/xopc-test-bundled-skills',
    });

    try {
      const main = registry.getOrCreate('/shared', 'main');
      const research = registry.getOrCreate('/shared', 'research');

      expect(main).not.toBe(research);
      expect(registry.getOrCreate('/shared', 'main')).toBe(main);
      expect(main.builtinMemoryStore.memoriesDir.replace(/\\/g, '/')).toContain('/agents/main/memories');
      expect(research.builtinMemoryStore.memoriesDir.replace(/\\/g, '/')).toContain('/agents/research/memories');
    } finally {
      await registry.clearAll();
    }
  });
});
