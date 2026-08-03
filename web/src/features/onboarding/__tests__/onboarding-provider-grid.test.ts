import { describe, expect, it } from 'vitest';

import { resolveOnboardingProviders } from '@/features/onboarding/onboarding-provider-grid';
import type { ProviderMeta } from '@/features/settings/providers-api';

const providers: ProviderMeta[] = [
  { id: 'deepseek', name: 'DeepSeek', category: 'common', supportsOAuth: false, supportsApiKey: true, configured: false, onboardingFeatured: true },
  { id: 'google', name: 'Google AI', category: 'common', supportsOAuth: false, supportsApiKey: true, configured: false, onboardingFeatured: true },
];

describe('resolveOnboardingProviders', () => {
  it('replaces Google with XOPC Cloud in the Electron first-run flow', () => {
    const resolved = resolveOnboardingProviders(providers, true);

    expect(resolved.map((provider) => provider.id)).toEqual(['xopc-cloud', 'deepseek']);
    expect(resolved[0]).toMatchObject({ supportsOAuth: true, supportsApiKey: false });
  });

  it('keeps the web onboarding provider list unchanged', () => {
    expect(resolveOnboardingProviders(providers, false).map((provider) => provider.id)).toEqual([
      'deepseek',
      'google',
    ]);
  });
});
