import { describe, expect, it } from 'vitest';

import type { Config } from '../../../../../config/schema.js';
import { applyAgentsPatch } from '../agents.js';

function minimalConfig(): Config {
  return {
    gateway: { port: 18790, corsOrigins: [] },
    agents: {
      defaults: {
        workspace: '/tmp/ws',
        maxTokens: 8192,
        temperature: 0.7,
        maxToolIterations: 20,
        maxRequestsPerTurn: 50,
        maxToolFailuresPerTurn: 3,
        thinkingDefault: 'medium',
        reasoningDefault: 'stream',
        verboseDefault: 'full',
      },
      list: [],
    },
    channels: {},
  } as Config;
}

describe('applyAgentsPatch typed models', () => {
  it('sets and clears agents.defaults.models', () => {
    const cfg = minimalConfig();
    applyAgentsPatch(cfg, {
      agents: {
        defaults: {
          models: {
            roles: {
              small: { model: 'deepseek/flash' },
              large: { model: 'anthropic/claude', description: 'Big' },
            },
          },
        },
      },
    });
    expect(cfg.agents?.defaults?.models).toEqual({
      roles: {
        small: { model: 'deepseek/flash' },
        large: { model: 'anthropic/claude', description: 'Big' },
      },
    });

    applyAgentsPatch(cfg, { agents: { defaults: { models: null } } });
    expect(cfg.agents?.defaults?.models).toBeUndefined();
  });
});
