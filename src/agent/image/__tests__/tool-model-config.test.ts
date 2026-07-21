import { describe, expect, it, beforeEach, vi } from 'vitest';

import type { Config } from '../../../config/schema.js';

const mocks = vi.hoisted(() => ({
  configuredProviders: new Set<string>(),
  models: new Map<string, { provider: string; id: string; input: Array<'text' | 'image'> }>(),
}));

vi.mock('../../../providers/index.js', () => ({
  getDefaultModelSync: () => '',
  getModelsByProvider: (provider: string) =>
    [...mocks.models.values()].filter((model) => model.provider === provider),
  isProviderConfiguredSync: (provider: string) => mocks.configuredProviders.has(provider),
  resolveModel: (ref: string) => {
    const [provider, id] = ref.split('/');
    const model = mocks.models.get(ref);
    if (!provider || !id || !model) {
      throw new Error(`Model not found: ${ref}`);
    }
    return model;
  },
}));

import { resolveEffectiveImageModelConfig } from '../tool-model-config.js';

function addModel(provider: string, id: string, input: Array<'text' | 'image'> = ['text']): void {
  mocks.models.set(`${provider}/${id}`, { provider, id, input });
}

function baseConfig(models: NonNullable<Config['agents']['capabilityPresets'][string]['models']>): Config {
  return {
    agents: {
      default: 'main',
      defaultPreset: 'default',
      capabilityPresets: {
        default: {
          id: 'default',
          name: 'Global defaults',
          version: 1,
          models,
        },
      },
      list: [
        {
          id: 'main',
          enabled: true,
          identity: { name: 'Main', role: 'assistant' },
          responsibilities: { primary: ['Assist'] },
          workspace: { root: '/tmp' },
          tools: { builtin: {} },
          skills: { mode: 'all' },
          workflows: {},
          boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
        },
      ],
    },
  } as Config;
}

describe('resolveEffectiveImageModelConfig', () => {
  beforeEach(() => {
    mocks.configuredProviders.clear();
    mocks.models.clear();
  });

  it('keeps explicit imageModel ahead of automatic role selection', () => {
    addModel('text', 'default');
    addModel('vision', 'role-model', ['text', 'image']);
    mocks.configuredProviders.add('vision');

    const result = resolveEffectiveImageModelConfig({
      cfg: baseConfig({
        defaultRole: 'deep',
        roles: {
          deep: { model: 'text/default' },
          vision: { model: 'vision/role-model' },
        },
        imageModel: { primary: 'manual/model', fallbacks: ['manual/fallback'] },
      }),
    });

    expect(result).toEqual({
      primary: 'manual/model',
      fallbacks: ['manual/fallback'],
      source: 'explicit',
    });
  });

  it('auto-selects the first configured image-capable role model', () => {
    addModel('text', 'default');
    addModel('vision', 'role-model', ['text', 'image']);
    mocks.configuredProviders.add('vision');

    const result = resolveEffectiveImageModelConfig({
      cfg: baseConfig({
        defaultRole: 'deep',
        roles: {
          deep: { model: 'text/default' },
          vision: { model: 'vision/role-model', description: 'Vision role' },
        },
      }),
    });

    expect(result).toEqual({
      primary: 'vision/role-model',
      source: 'auto-role',
      roleId: 'vision',
      roleDescription: 'Vision role',
    });
  });

  it('uses image-capable role fallbacks when the role primary is text-only', () => {
    addModel('text', 'default');
    addModel('vision', 'fallback-model', ['text', 'image']);
    mocks.configuredProviders.add('vision');

    const result = resolveEffectiveImageModelConfig({
      cfg: baseConfig({
        defaultRole: 'deep',
        roles: {
          deep: { model: 'text/default' },
          small: { model: 'text/default', fallbacks: ['vision/fallback-model'] },
        },
      }),
    });

    expect(result).toEqual({
      primary: 'vision/fallback-model',
      source: 'auto-role',
      roleId: 'small',
    });
  });

  it('skips image-capable role models whose provider is not configured', () => {
    addModel('vision', 'role-model', ['text', 'image']);

    const result = resolveEffectiveImageModelConfig({
      cfg: baseConfig({
        defaultRole: 'vision',
        roles: {
          vision: { model: 'vision/role-model' },
        },
      }),
    });

    expect(result).toBeNull();
  });

  it('falls back to configured provider catalog when no role image model is available', () => {
    addModel('openai', 'text-model');
    addModel('openai', 'vision-model', ['text', 'image']);
    mocks.configuredProviders.add('openai');

    const result = resolveEffectiveImageModelConfig({
      cfg: baseConfig({
        defaultRole: 'deep',
        roles: {
          deep: { model: 'openai/text-model' },
        },
      }),
    });

    expect(result).toEqual({
      primary: 'openai/vision-model',
      source: 'auto-provider',
    });
  });
});
