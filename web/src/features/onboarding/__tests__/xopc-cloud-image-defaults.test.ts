import { describe, expect, it } from 'vitest';

import { resolveXopcCloudImageDefaults } from '@/features/onboarding/onboarding-card';
import type { ConfiguredModel } from '@/features/chat/api/registry-api';
import type { ImageProvider } from '@/features/settings/image-generation-api';

const imageProvider = (overrides: Partial<ImageProvider> = {}): ImageProvider => ({
  id: 'xopc-cloud',
  label: 'XOPC Cloud',
  source: 'builtin',
  credentialMode: 'oauth',
  configFields: [],
  config: {},
  defaultModel: 'image-01',
  models: ['image-01'],
  capabilities: {},
  configured: true,
  ...overrides,
});

describe('resolveXopcCloudImageDefaults', () => {
  it('selects returned XOPC Cloud vision and image-generation models', () => {
    const models: ConfiguredModel[] = [
      { id: 'xopc-cloud/chat', name: 'Chat', provider: 'xopc-cloud' },
      { id: 'xopc-cloud/vision', name: 'Vision', provider: 'xopc-cloud', vision: true },
    ];

    expect(resolveXopcCloudImageDefaults(models, [imageProvider()])).toEqual({
      imageModel: { primary: 'xopc-cloud/vision' },
      imageGenerationModel: { primary: 'xopc-cloud/image-01' },
    });
  });

  it('only returns capabilities that XOPC Cloud currently exposes', () => {
    expect(resolveXopcCloudImageDefaults([], [imageProvider({ configured: false })])).toEqual({});
  });

  it('falls back to the first returned generation model when the declared default is absent', () => {
    expect(resolveXopcCloudImageDefaults([], [imageProvider({
      defaultModel: 'retired',
      models: ['image-current'],
    })])).toEqual({
      imageGenerationModel: { primary: 'xopc-cloud/image-current' },
    });
  });
});
