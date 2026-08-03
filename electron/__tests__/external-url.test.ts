import { describe, expect, it } from 'vitest';

import { normalizeExternalHttpUrl } from '../external-url.js';

describe('normalizeExternalHttpUrl', () => {
  it('accepts browser authorization URLs', () => {
    expect(normalizeExternalHttpUrl('https://console.xopc.ai/connect/models?request=test'))
      .toBe('https://console.xopc.ai/connect/models?request=test');
  });

  it.each([
    'xopc://cloud/model-connected',
    'file:///tmp/secret',
    'javascript:alert(1)',
    'https://user:password@console.xopc.ai/connect/models',
  ])('rejects unsafe external URL %s', (url) => {
    expect(() => normalizeExternalHttpUrl(url)).toThrow();
  });
});
