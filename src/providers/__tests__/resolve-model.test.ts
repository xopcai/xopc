import { describe, expect, it } from 'vitest';

import { getAllModels, resolveModel } from '../index.js';

describe('resolveModel', () => {
  it('throws a setup-oriented error for an empty model ref', () => {
    expect(() => resolveModel('')).toThrow(
      'No default model configured. Choose a model in onboarding',
    );
    expect(() => resolveModel('   ')).toThrow(
      'No default model configured. Choose a model in onboarding',
    );
  });

  it('corrects stale OpenAI context windows across runtime and picker metadata', () => {
    const expectedByModel = new Map([
      ['gpt-5.4', 1_050_000],
      ['gpt-5.4-mini', 400_000],
      ['gpt-5.5', 1_050_000],
      ['gpt-5.6-luna', 1_050_000],
      ['gpt-5.6-sol', 1_050_000],
      ['gpt-5.6-terra', 1_050_000],
    ]);

    for (const provider of ['openai', 'openai-codex']) {
      for (const [id, expected] of expectedByModel) {
        expect(resolveModel(`${provider}/${id}`).contextWindow).toBe(expected);
        expect(
          getAllModels().find(
            (model) => model.provider === provider && model.id === id,
          )?.contextWindow,
        ).toBe(expected);
      }
    }

    expect(resolveModel('openai/gpt-5.6').contextWindow).toBe(1_050_000);
    expect(
      getAllModels().find(
        (model) => model.provider === 'openai' && model.id === 'gpt-5.6',
      )?.contextWindow,
    ).toBe(1_050_000);
  });
});
