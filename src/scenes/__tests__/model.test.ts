import { describe, expect, it } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { resolveSceneModelRef } from '../model.js';

describe('scene model routing', () => {
  it('uses the effective reasoning intent for the default agent', () => {
    initializeTestAgentCatalog({
      defaults: {
        models: {
          chat: { primary: 'openai/chat', fallbacks: [] },
          intents: { reasoning: { primary: 'anthropic/reasoning', fallbacks: [] } },
        },
        skills: { mode: 'all-enabled', exclude: [] },
        tools: {}, workflows: {}, runtime: {},
      },
    });
    const config = ConfigSchema.parse({});

    expect(resolveSceneModelRef(config)).toBe('anthropic/reasoning');
  });

  it('falls back to the effective chat model without a reasoning override', () => {
    initializeTestAgentCatalog({
      defaults: {
        models: { chat: { primary: 'openai/chat', fallbacks: [] }, intents: {} },
        skills: { mode: 'all-enabled', exclude: [] },
        tools: {}, workflows: {}, runtime: {},
      },
      agents: [{ id: 'main', enabled: true, models: { chat: { primary: 'google/chat', fallbacks: [] } } }],
    });
    const config = ConfigSchema.parse({});

    expect(resolveSceneModelRef(config)).toBe('google/chat');
  });
});
