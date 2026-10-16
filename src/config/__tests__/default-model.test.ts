import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import { DEFAULT_MODEL_REF } from '../default-model.js';
import { withModelUsageOrigin } from '../../providers/model-usage.js';
import {
  getAgentDefaultImageGenerationModelConfig,
  getAgentDefaultImageModelConfig,
  getAgentDefaultModelRef,
} from '../schema.js';

describe('default model config', () => {
  beforeEach(() => initializeTestAgentCatalog());
  afterEach(() => closeXopcDatabase());

  it('uses XOPC Cloud Auto as the built-in default model', () => {
    const catalog = initializeTestAgentCatalog().getSettings();

    expect(catalog.defaults.models.chat).toEqual({ primary: DEFAULT_MODEL_REF, fallbacks: [] });
    expect(catalog.defaults.skills).toEqual({ mode: 'all-enabled', exclude: [] });
    expect(getAgentDefaultModelRef()).toBe(DEFAULT_MODEL_REF);
  });

  it('uses a background route only within a trusted background call, preserving startup and user defaults', () => {
    const repository = initializeTestAgentCatalog();
    const settings = repository.getSettings();
    repository.updateDefaults({ ...settings.defaults, models: { ...settings.defaults.models,
      chat: { primary: 'qwen-token-plan-cn/qwen3.8-flash', fallbacks: [] },
      background: { primary: 'xopc-cloud/auto', fallbacks: [] },
    } }, settings.revision);
    expect(getAgentDefaultModelRef()).toBe('qwen-token-plan-cn/qwen3.8-flash');
    expect(withModelUsageOrigin('interactive', () => getAgentDefaultModelRef())).toBe('qwen-token-plan-cn/qwen3.8-flash');
    expect(withModelUsageOrigin('background', () => getAgentDefaultModelRef())).toBe('xopc-cloud/auto');
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
