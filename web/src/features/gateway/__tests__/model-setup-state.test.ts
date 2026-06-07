import { describe, expect, it } from 'vitest';

import { needsModelOrProviders } from '@/features/gateway/model-setup-state';

describe('needsModelOrProviders', () => {
  it('is true for null or empty payload without throwing', () => {
    expect(needsModelOrProviders(null)).toBe(true);
    expect(needsModelOrProviders(undefined)).toBe(true);
    expect(needsModelOrProviders({})).toBe(true);
  });

  it('is true when no provider and no default model', () => {
    expect(
      needsModelOrProviders({
        agents: { defaults: { model: '' } },
        providers: { openai: '' },
      }),
    ).toBe(true);
  });

  it('is false when a provider is configured and default model is set', () => {
    expect(
      needsModelOrProviders({
        agents: { defaults: { model: 'openai/gpt-4' } },
        providers: { openai: '***', anthropic: '' },
      }),
    ).toBe(false);
  });

  it('treats length-preserving bullet masks as configured providers', () => {
    expect(
      needsModelOrProviders({
        agents: { defaults: { model: 'deepseek/deepseek-v4-flash' } },
        providers: { deepseek: '••••••••••••••••••••••••••••••••', openai: '' },
      }),
    ).toBe(false);
  });

  it('is true when provider ok but default model missing', () => {
    expect(
      needsModelOrProviders({
        agents: { defaults: { model: '' } },
        providers: { openai: '***' },
      }),
    ).toBe(true);
  });

  it('is true when default model is set but no provider is configured', () => {
    expect(
      needsModelOrProviders({
        agents: { defaults: { model: 'openai/gpt-4' } },
        providers: { openai: '' },
      }),
    ).toBe(true);
  });
});
