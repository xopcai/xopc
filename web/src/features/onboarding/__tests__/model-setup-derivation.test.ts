import { describe, expect, it } from 'vitest';

import { computeNeedsModelSetup, type ModelSetupDerivationInput } from '@/features/onboarding/model-setup-derivation';

function configWithGlobalModel(model: string) {
  return {
    agents: {
      defaultPreset: 'default',
      capabilityPresets: {
        default: {
          models: {
            defaultRole: 'deep',
            roles: model ? { deep: { model } } : {},
          },
        },
      },
    },
  };
}

const readyInput: ModelSetupDerivationInput = {
  enabled: true,
  ready: true,
  configError: undefined,
  modelsError: undefined,
  config: {
    ...configWithGlobalModel('openai/gpt-4o'),
    providers: { openai: '***' },
  },
  modelsData: [{ id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' }],
};

describe('computeNeedsModelSetup', () => {
  it('returns false while disabled or not ready', () => {
    expect(computeNeedsModelSetup({ ...readyInput, enabled: false })).toBe(false);
    expect(computeNeedsModelSetup({ ...readyInput, ready: false })).toBe(false);
  });

  it('returns false on fetch errors (gateway boot / network)', () => {
    expect(
      computeNeedsModelSetup({
        ...readyInput,
        modelsError: new Error('Models: HTTP 503'),
      }),
    ).toBe(false);
    expect(
      computeNeedsModelSetup({
        ...readyInput,
        configError: new Error('Failed to fetch'),
      }),
    ).toBe(false);
  });

  it('returns true when config is missing providers or default model', () => {
    expect(
      computeNeedsModelSetup({
        ...readyInput,
        config: { ...configWithGlobalModel(''), providers: {} },
      }),
    ).toBe(true);
  });

  it('returns true for the first-run default preset shape with no role model', () => {
    expect(
      computeNeedsModelSetup({
        ...readyInput,
        config: {
          agents: {
            default: 'main',
            defaultPreset: 'default',
            capabilityPresets: {
              default: {
                id: 'default',
                name: 'Global defaults',
                models: {
                  defaultRole: 'deep',
                  roles: {},
                },
              },
            },
            list: [
              {
                id: 'main',
                enabled: true,
              },
            ],
          },
          providers: { custom: '***' },
        },
      }),
    ).toBe(true);
  });

  it('uses the default agent model when the global default preset is intentionally empty', () => {
    expect(
      computeNeedsModelSetup({
        ...readyInput,
        config: {
          agents: {
            default: 'coder',
            defaultPreset: 'default',
            capabilityPresets: {
              default: {
                id: 'default',
                name: 'Global defaults',
                models: {
                  defaultRole: 'deep',
                  roles: {},
                },
              },
            },
            list: [
              {
                id: 'coder',
                enabled: true,
                models: {
                  defaultRole: 'deep',
                  roles: {
                    deep: { model: 'openai/gpt-4o' },
                  },
                },
              },
            ],
          },
          providers: { openai: '***' },
        },
      }),
    ).toBe(false);
  });

  it('returns true when config is ok but no usable models', () => {
    expect(
      computeNeedsModelSetup({
        ...readyInput,
        modelsData: [],
      }),
    ).toBe(true);
  });

  it('returns false when config and models are usable', () => {
    expect(computeNeedsModelSetup(readyInput)).toBe(false);
  });

  it('returns false when gateway masks provider keys with bullet placeholders', () => {
    expect(
      computeNeedsModelSetup({
        ...readyInput,
        config: {
          ...configWithGlobalModel('deepseek/deepseek-v4-flash'),
          providers: { deepseek: '••••••••••••••••••••••••••••••••', openai: '' },
        },
        modelsData: [{ id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek' }],
      }),
    ).toBe(false);
  });
});
