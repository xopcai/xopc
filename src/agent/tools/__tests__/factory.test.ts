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
            list: [
              {
                id: 'main',
                enabled: true,
                models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4.1' } } },
              },
            ],
          },
        }) as Config,
    });

    expect(factory.createCoreTools().map((tool) => tool.name)).not.toContain('browser_use');
  });
});
