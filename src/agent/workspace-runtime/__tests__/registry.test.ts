import { describe, expect, it } from 'vitest';

import type { AgentEntry } from '../../../agent-config/index.js';
import { ConfigSchema } from '../../../config/schema.js';
import { WorkspaceRuntimeRegistry } from '../registry.js';

function agent(id: string): AgentEntry {
  return {
    id,
    enabled: true,
    profile: { name: id },
    workspace: '/shared',
  };
}

describe('WorkspaceRuntimeRegistry', () => {
  it('shares one user context runtime when agents share a workspace', async () => {
    const config = ConfigSchema.parse({
      agents: {
        default: 'main',
        list: [
          agent('main'),
          agent('research'),
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
