import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { resolveSceneModelRef } from '../model.js';

describe('scene model routing', () => {
  it('uses the effective reasoning intent for the default agent', () => {
    const config = ConfigSchema.parse({
      agents: {
        default: 'main',
        defaults: {
          models: {
            chat: { primary: 'openai/chat', fallbacks: [] },
            intents: { reasoning: { primary: 'anthropic/reasoning', fallbacks: [] } },
          },
        },
        list: [{ id: 'main' }],
      },
    });

    expect(resolveSceneModelRef(config)).toBe('anthropic/reasoning');
  });

  it('falls back to the effective chat model without a reasoning override', () => {
    const config = ConfigSchema.parse({
      agents: {
        default: 'main',
        defaults: { models: { chat: { primary: 'openai/chat', fallbacks: [] }, intents: {} } },
        list: [{ id: 'main', models: { chat: { primary: 'google/chat', fallbacks: [] } } }],
      },
    });

    expect(resolveSceneModelRef(config)).toBe('google/chat');
  });
});
