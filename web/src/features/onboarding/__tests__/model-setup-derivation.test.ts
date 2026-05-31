import { describe, expect, it } from 'vitest';

import { computeNeedsModelSetup, type ModelSetupDerivationInput } from '@/features/onboarding/model-setup-derivation';

const readyInput: ModelSetupDerivationInput = {
  enabled: true,
  ready: true,
  configError: undefined,
  modelsError: undefined,
  config: {
    agents: { defaults: { model: 'openai/gpt-4o' } },
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
        config: { agents: { defaults: { model: '' } }, providers: {} },
      }),
    ).toBe(true);
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
});
