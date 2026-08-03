import { describe, expect, it } from 'vitest';

import { buildSafeProvidersConfigForWeb } from '../safe-providers-config.js';

describe('buildSafeProvidersConfigForWeb', () => {
  it('keeps only supported non-secret fields', () => {
    const safe = buildSafeProvidersConfigForWeb({
      dashscope: {
        region: 'cn',
      },
      fal: { baseUrl: 'https://fal.run' },
    } as const);
    expect(safe.dashscope).toEqual({ region: 'cn' });
    expect(safe.fal).toEqual({ baseUrl: 'https://fal.run' });
  });

  it('handles undefined providers', () => {
    expect(buildSafeProvidersConfigForWeb(undefined)).toEqual({});
  });
});
