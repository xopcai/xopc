import { describe, expect, it } from 'vitest';

import { bundledImageGenerationProviderBuilders } from '../../../../generated/bundled-image-generation-providers.js';

describe('bundledImageGenerationProviderBuilders', () => {
  it('registers explicit regional image providers', () => {
    const ids = bundledImageGenerationProviderBuilders.map((build) => build().id);

    expect(ids).toContain('dashscope-cn');
    expect(ids).toContain('dashscope-intl');
    expect(ids).not.toContain('dashscope');
    expect(ids).toContain('minimax-cn');
    expect(ids).toContain('minimax');
  });
});
