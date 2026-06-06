import { describe, expect, it } from 'vitest';

import { buildSafeProvidersConfigForWeb } from '../safe-providers-config.js';

describe('buildSafeProvidersConfigForWeb', () => {
  it('masks apiKey and keeps non-secret fields', () => {
    const safe = buildSafeProvidersConfigForWeb({
      dashscope: {
        apiKey: 'secret-key',
        region: 'beijing',
        imageBaseUrl: 'https://dashscope.aliyuncs.com/api/v1/',
      },
      fal: { apiKey: 'fal_xxx', baseUrl: 'https://fal.run' },
    });
    expect(safe.dashscope).toEqual({
      apiKey: '••••••••••',
      region: 'beijing',
      imageBaseUrl: 'https://dashscope.aliyuncs.com/api/v1/',
    });
    expect(safe.fal).toEqual({ apiKey: '•••••••', baseUrl: 'https://fal.run' });
  });

  it('returns empty apiKey when missing', () => {
    const safe = buildSafeProvidersConfigForWeb({ openai: {} });
    expect(safe.openai).toEqual({ apiKey: '' });
  });

  it('handles undefined providers', () => {
    expect(buildSafeProvidersConfigForWeb(undefined)).toEqual({});
  });
});
