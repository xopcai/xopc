import { describe, expect, it } from 'vitest';

import {
  buildDashScopeImageGenerationProvider,
  DASHSCOPE_IMAGE_ENDPOINTS,
  mapSizeToDashScopeFormat,
  mapSizeToWan27Format,
  resolveDashScopeImageGenerationUrl,
} from '../providers/dashscope.js';

describe('DashScope image provider', () => {
  it('uses the configured region', () => {
    expect(resolveDashScopeImageGenerationUrl({
      provider: 'dashscope', model: 'wan2.7-image-pro', prompt: 'p',
      cfg: { providers: { dashscope: { region: 'cn' } } } as any,
    })).toBe(DASHSCOPE_IMAGE_ENDPOINTS.beijing);
    expect(resolveDashScopeImageGenerationUrl({
      provider: 'dashscope', model: 'wan2.7-image-pro', prompt: 'p',
      cfg: { providers: { dashscope: { region: 'intl' } } } as any,
    })).toBe(DASHSCOPE_IMAGE_ENDPOINTS.singapore);
  });

  it('requires an explicit region', () => {
    expect(() => resolveDashScopeImageGenerationUrl({
      provider: 'dashscope', model: 'wan2.7-image-pro', prompt: 'p', cfg: {} as any,
    })).toThrow(/requires providers\.dashscope\.region/);
  });

  it('honours an explicit base URL', () => {
    expect(resolveDashScopeImageGenerationUrl({
      provider: 'dashscope', model: 'wan2.7-image-pro', prompt: 'p',
      cfg: { providers: { dashscope: { region: 'cn', baseUrl: 'https://example.com/api/' } } } as any,
    })).toBe('https://example.com/api');
  });

  it('exposes a single provider id', () => {
    expect(buildDashScopeImageGenerationProvider().id).toBe('dashscope');
  });
});

describe('DashScope size mapping', () => {
  it('maps pixel separators', () => {
    expect(mapSizeToDashScopeFormat('1024x1536')).toBe('1024*1536');
  });

  it('caps wan2.7-image at 2K', () => {
    expect(mapSizeToWan27Format('4K', 'wan2.7-image')).toBe('2K');
  });
});
