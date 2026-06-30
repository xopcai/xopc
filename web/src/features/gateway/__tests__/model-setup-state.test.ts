import { describe, expect, it } from 'vitest';

import { needsModelOrProviders } from '@/features/gateway/model-setup-state';

function config(model: string, providers: Record<string, string>) {
  return {
    agents: {
      default: 'main',
      list: [
        {
          id: 'main',
          models: {
            defaultRole: 'deep',
            roles: { deep: { model } },
          },
        },
      ],
    },
    providers,
  };
}

describe('needsModelOrProviders', () => {
  it('is true for null or empty payload without throwing', () => {
    expect(needsModelOrProviders(null)).toBe(true);
    expect(needsModelOrProviders(undefined)).toBe(true);
    expect(needsModelOrProviders({})).toBe(true);
  });

  it('is true when no provider and no default model', () => {
    expect(
      needsModelOrProviders(config('', { openai: '' })),
    ).toBe(true);
  });

  it('is false when a provider is configured and default model is set', () => {
    expect(
      needsModelOrProviders(config('openai/gpt-4', { openai: '***', anthropic: '' })),
    ).toBe(false);
  });

  it('treats length-preserving bullet masks as configured providers', () => {
    expect(
      needsModelOrProviders(config('deepseek/deepseek-v4-flash', { deepseek: '••••••••••••••••••••••••••••••••', openai: '' })),
    ).toBe(false);
  });

  it('is true when provider ok but default model missing', () => {
    expect(
      needsModelOrProviders(config('', { openai: '***' })),
    ).toBe(true);
  });

  it('is true when default model is set but no provider is configured', () => {
    expect(
      needsModelOrProviders(config('openai/gpt-4', { openai: '' })),
    ).toBe(true);
  });
});
