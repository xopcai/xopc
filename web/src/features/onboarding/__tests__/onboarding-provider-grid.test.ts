import { describe, expect, it } from 'vitest';

import { resolveRecommendedOnboardingProvider } from '@/features/onboarding/onboarding-provider-options';
import type { ProviderMeta } from '@/features/settings/providers-api';

const providers: ProviderMeta[] = [
  { id: 'deepseek', name: 'DeepSeek', category: 'common', supportsOAuth: false, supportsApiKey: true, configured: false, onboardingFeatured: true },
  { id: 'google', name: 'Google AI', category: 'common', supportsOAuth: false, supportsApiKey: true, configured: false, onboardingFeatured: true },
];

describe('resolveRecommendedOnboardingProvider', () => {
  it('replaces Google with XOPC Cloud in the Electron first-run flow', () => {
    const resolved = resolveRecommendedOnboardingProvider(providers, true);

    expect(resolved).toMatchObject({ id: 'xopc-cloud', supportsOAuth: true, supportsApiKey: false });
  });

  it('keeps the web onboarding provider list unchanged', () => {
    expect(resolveRecommendedOnboardingProvider(providers, false)?.id).toBe('deepseek');
  });

  it('uses the first ranked featured provider as the compact recommendation', () => {
    const manyProviders: ProviderMeta[] = [
      'deepseek',
      'openai',
      'anthropic',
      'google',
      'minimax',
      'kimi-coding',
    ].map((id) => ({
      id,
      name: id,
      category: 'common',
      supportsOAuth: false,
      supportsApiKey: true,
      configured: false,
      onboardingFeatured: true,
    }));

    expect(resolveRecommendedOnboardingProvider(manyProviders, false)?.id).toBe('deepseek');
  });
});
