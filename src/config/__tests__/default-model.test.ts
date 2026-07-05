import { describe, expect, it } from 'vitest';

import { DEFAULT_MODEL_REF, DEFAULT_MODEL_ROLE } from '../default-model.js';
import {
  ConfigSchema,
  getAgentDefaultImageGenerationModelConfig,
  getAgentDefaultImageModelConfig,
  getAgentDefaultModelRef,
} from '../schema.js';

describe('default model config', () => {
  it('uses DeepSeek V4 Flash as the built-in default model', () => {
    const config = ConfigSchema.parse({});

    expect(config.agents.capabilityPresets.default?.models).toMatchObject({
      defaultRole: DEFAULT_MODEL_ROLE,
      roles: {
        [DEFAULT_MODEL_ROLE]: {
          model: DEFAULT_MODEL_REF,
        },
      },
    });
    expect(getAgentDefaultModelRef(config)).toBe(DEFAULT_MODEL_REF);
  });

  it('resolves default image model settings from the global preset', () => {
    const config = ConfigSchema.parse({});
    config.agents.capabilityPresets.default = {
      ...config.agents.capabilityPresets.default!,
      models: {
        defaultRole: DEFAULT_MODEL_ROLE,
        roles: {
          [DEFAULT_MODEL_ROLE]: { model: DEFAULT_MODEL_REF },
        },
        imageModel: {
          primary: 'openai/gpt-4.1-mini',
          fallbacks: ['google/gemini-2.5-flash'],
        },
        imageGenerationModel: {
          primary: 'openai/gpt-image-1',
          fallbacks: ['google/gemini-2.5-flash-image-preview'],
          timeoutMs: 120_000,
          autoProviderFallback: true,
        },
      },
    };

    expect(getAgentDefaultImageModelConfig(config)).toEqual({
      primary: 'openai/gpt-4.1-mini',
      fallbacks: ['google/gemini-2.5-flash'],
    });
    expect(getAgentDefaultImageGenerationModelConfig(config)).toEqual({
      primary: 'openai/gpt-image-1',
      fallbacks: ['google/gemini-2.5-flash-image-preview'],
      timeoutMs: 120_000,
      autoProviderFallback: true,
    });
  });
});
