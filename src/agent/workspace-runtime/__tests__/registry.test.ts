import { describe, expect, it } from 'vitest';

import type { AgentManifest } from '../../../agent-manifest/index.js';
import { ConfigSchema } from '../../../config/schema.js';
import { WorkspaceRuntimeRegistry } from '../registry.js';

function manifest(id: string): AgentManifest {
  return {
    id,
    enabled: true,
    identity: { name: id, role: 'Agent', language: 'en', tone: 'direct' },
    responsibilities: { primary: ['Help'] },
    workspace: { root: '/shared' },
    models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4.1' } } },
    tools: { builtin: {} },
    skills: { mode: 'all' },
    workflows: {},
    boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
  };
}

describe('WorkspaceRuntimeRegistry', () => {
  it('shares one user context runtime when agents share a workspace', async () => {
    const config = ConfigSchema.parse({
      agents: {
        default: 'main',
        capabilityPresets: {},
        list: [
          manifest('main'),
          manifest('research'),
        ],
      },
    });
    const registry = new WorkspaceRuntimeRegistry({
      getConfig: () => config,
      bundledSkillsDir: '/tmp/xopc-test-bundled-skills',
    });

    try {
      const main = registry.getOrCreate('/shared', 'main');
      const research = registry.getOrCreate('/shared', 'research');

      expect(main).not.toBe(research);
      expect(registry.getOrCreate('/shared', 'main')).toBe(main);
      expect(main.memoryManager).toBe(research.memoryManager);
    } finally {
      await registry.clearAll();
    }
  });
});
