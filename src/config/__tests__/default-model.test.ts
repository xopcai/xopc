import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import { DEFAULT_MODEL_REF } from '../default-model.js';
import {
  getAgentDefaultImageGenerationModelConfig,
  getAgentDefaultImageModelConfig,
  getAgentDefaultModelRef,
} from '../schema.js';
import { DEFAULT_CORE_SKILLS } from '../../agent-config/schema.js';

describe('default model config', () => {
  beforeEach(() => initializeTestAgentCatalog());
  afterEach(() => closeXopcDatabase());

  it('uses DeepSeek V4 Flash as the built-in default model', () => {
    const catalog = initializeTestAgentCatalog().getSettings();

    expect(catalog.defaults.models.chat).toEqual({ primary: DEFAULT_MODEL_REF, fallbacks: [] });
    expect(catalog.defaults.skills).toEqual({ mode: 'selected', include: [...DEFAULT_CORE_SKILLS] });
    expect(getAgentDefaultModelRef()).toBe(DEFAULT_MODEL_REF);
  });

  it('resolves default image model settings from global defaults', () => {
    const repository = initializeTestAgentCatalog();
    const settings = repository.getSettings();
    repository.updateDefaults({
      ...settings.defaults,
      models: {
        ...settings.defaults.models,
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
      },
    }, settings.revision);

    expect(getAgentDefaultImageModelConfig()).toEqual({
      primary: 'openai/gpt-4.1-mini',
      fallbacks: ['google/gemini-2.5-flash'],
    });
    expect(getAgentDefaultImageGenerationModelConfig('main')).toEqual({
      primary: 'openai/gpt-image-2',
      fallbacks: ['google/gemini-3.1-flash-image'],
      timeoutMs: 120_000,
      autoProviderFallback: true,
    });
  });

  it('lets an agent explicitly clear inherited image routes', () => {
    initializeTestAgentCatalog({
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
      agents: [{
          id: 'main',
          models: { imageUnderstanding: null, imageGeneration: null },
      }],
    });

    expect(getAgentDefaultImageModelConfig()).toBeUndefined();
    expect(getAgentDefaultImageGenerationModelConfig('main')).toBeUndefined();
  });
});
