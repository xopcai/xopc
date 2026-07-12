import { describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';
import type { MessageBus } from '../../../infra/bus/index.js';
import { AgentToolsFactory } from '../factory.js';

describe('AgentToolsFactory', () => {
  it('does not register browser_use when browser runtime is disabled', () => {
    const factory = new AgentToolsFactory({
      workspace: '/tmp/xopc-tools-factory-test',
      bus: {} as MessageBus,
      getCurrentContext: () => null,
      getConfig: () =>
        ({
          browser: { enabled: false, backend: 'extension' },
          agents: {
            default: 'main',
            defaultPreset: 'default',
            capabilityPresets: {
              default: {
                id: 'default',
                name: 'Global defaults',
                models: { defaultRole: 'deep', roles: { deep: { model: 'anthropic/claude-sonnet-4-5' } } },
              },
            },
            list: [
              {
                id: 'main',
                enabled: true,
                identity: { name: 'Main', role: 'General assistant' },
                responsibilities: { primary: ['Help the user complete tasks'] },
                workspace: { root: '/tmp/xopc-tools-factory-test' },
                tools: { builtin: {} },
                skills: { mode: 'all' },
                memory: { mode: 'confirmWrite', sources: ['session'] },
                workflows: {},
                boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
              },
            ],
          },
        }) as Config,
    });

    expect(factory.createCoreTools().map((tool) => tool.name)).not.toContain('browser_use');
  });

  it('does not register desktop pet creation as a core tool', () => {
    const factory = new AgentToolsFactory({
      workspace: '/tmp/xopc-tools-factory-test',
      bus: {} as MessageBus,
      getCurrentContext: () => null,
    });

    expect(factory.createCoreTools().map((tool) => tool.name)).not.toContain('create_desktop_pet');
    expect(factory.createCapabilityTools(['desktop-pet-authoring']).map((tool) => tool.name)).toEqual([
      'create_desktop_pet',
    ]);
  });
});
