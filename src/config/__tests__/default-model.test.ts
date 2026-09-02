import { describe, expect, it } from 'vitest';

import { DEFAULT_MODEL_REF } from '../default-model.js';
import {
  ConfigSchema,
  getAgentDefaultImageGenerationModelConfig,
  getAgentDefaultImageModelConfig,
  getAgentDefaultModelRef,
} from '../schema.js';

describe('default model config', () => {
  it('uses DeepSeek V4 Flash as the built-in default model', () => {
    const config = ConfigSchema.parse({});

    expect(config.agents.defaults.models.chat).toEqual({ primary: DEFAULT_MODEL_REF, fallbacks: [] });
    expect(getAgentDefaultModelRef(config)).toBe(DEFAULT_MODEL_REF);
  });

  it('resolves default image model settings from global defaults', () => {
    const config = ConfigSchema.parse({});
    config.agents.defaults.models = {
      ...config.agents.defaults.models,
      imageUnderstanding: {
        primary: 'openai/gpt-4.1-mini',
        fallbacks: ['google/gemini-2.5-flash'],
      },
      imageGeneration: {
        primary: 'openai/gpt-image-2',
        fallbacks: ['google/gemini-3.1-flash-image'],
        timeoutMs: 120_000,
        autoProviderFallback: true,
      },
    };

    expect(getAgentDefaultImageModelConfig(config)).toEqual({
      primary: 'openai/gpt-4.1-mini',
      fallbacks: ['google/gemini-2.5-flash'],
    });
    expect(getAgentDefaultImageGenerationModelConfig(config, 'main')).toEqual({
      primary: 'openai/gpt-image-2',
      fallbacks: ['google/gemini-3.1-flash-image'],
      timeoutMs: 120_000,
      autoProviderFallback: true,
    });
  });

  it('lets an agent explicitly clear inherited image routes', () => {
    const config = ConfigSchema.parse({
      agents: {
        defaults: {
          models: {
            chat: { primary: DEFAULT_MODEL_REF, fallbacks: [] },
            intents: {},
            imageUnderstanding: { primary: 'openai/vision', fallbacks: [] },
            imageGeneration: {
              primary: 'openai/image',
              fallbacks: [],
              autoProviderFallback: false,
            },
          },
        },
        list: [{
          id: 'main',
          models: { imageUnderstanding: null, imageGeneration: null },
        }],
      },
    });

    expect(getAgentDefaultImageModelConfig(config)).toBeUndefined();
    expect(getAgentDefaultImageGenerationModelConfig(config, 'main')).toBeUndefined();
  });
});
