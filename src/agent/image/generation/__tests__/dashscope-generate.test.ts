import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DASHSCOPE_IMAGE_ENDPOINTS,
  mapSizeToDashScopeFormat,
  mapSizeToWan27Format,
  resolveDashScopeImageGenerationUrl,
  resolveDashScopeImageRegion,
} from '../../../../../extensions/dashscope/src/image-generation-provider.js';

let savedBase: string | undefined;
let savedRegion: string | undefined;
let savedImageRegion: string | undefined;

beforeEach(() => {
  savedBase = process.env.DASHSCOPE_IMAGE_BASE_URL;
  savedRegion = process.env.DASHSCOPE_REGION;
  savedImageRegion = process.env.DASHSCOPE_IMAGE_REGION;
  delete process.env.DASHSCOPE_IMAGE_BASE_URL;
  delete process.env.DASHSCOPE_REGION;
  delete process.env.DASHSCOPE_IMAGE_REGION;
});

afterEach(() => {
  if (savedBase !== undefined) {
    process.env.DASHSCOPE_IMAGE_BASE_URL = savedBase;
  } else {
    delete process.env.DASHSCOPE_IMAGE_BASE_URL;
  }
  if (savedRegion !== undefined) {
    process.env.DASHSCOPE_REGION = savedRegion;
  } else {
    delete process.env.DASHSCOPE_REGION;
  }
  if (savedImageRegion !== undefined) {
    process.env.DASHSCOPE_IMAGE_REGION = savedImageRegion;
  } else {
    delete process.env.DASHSCOPE_IMAGE_REGION;
  }
});

describe('resolveDashScopeImageGenerationUrl', () => {
  it('defaults to Beijing', () => {
    expect(resolveDashScopeImageGenerationUrl()).toBe(DASHSCOPE_IMAGE_ENDPOINTS.beijing);
    expect(resolveDashScopeImageRegion()).toBe('beijing');
  });

  it('uses DASHSCOPE_IMAGE_BASE_URL when set', () => {
    process.env.DASHSCOPE_IMAGE_BASE_URL = 'https://example.com/api/';
    expect(resolveDashScopeImageGenerationUrl()).toBe('https://example.com/api');
  });

  it('maps international aliases to Singapore', () => {
    process.env.DASHSCOPE_REGION = 'intl';
    expect(resolveDashScopeImageRegion()).toBe('singapore');
    expect(resolveDashScopeImageGenerationUrl()).toBe(DASHSCOPE_IMAGE_ENDPOINTS.singapore);
  });

  it('maps us to Virginia endpoint', () => {
    process.env.DASHSCOPE_IMAGE_REGION = 'us-east-1';
    expect(resolveDashScopeImageRegion()).toBe('us');
    expect(resolveDashScopeImageGenerationUrl()).toBe(DASHSCOPE_IMAGE_ENDPOINTS.us);
  });

  it('honours cfg.providers.dashscope.imageBaseUrl over env', () => {
    process.env.DASHSCOPE_IMAGE_BASE_URL = 'https://env.example.com/api';
    const req = {
      provider: 'dashscope',
      model: 'wan2.6-t2i',
      prompt: 'p',
      cfg: { providers: { dashscope: { imageBaseUrl: 'https://cfg.example.com/api/' } } } as any,
    } as any;
    expect(resolveDashScopeImageGenerationUrl(req)).toBe('https://cfg.example.com/api');
  });

  it('honours cfg.providers.dashscope.region for endpoint mapping', () => {
    const req = {
      provider: 'dashscope',
      model: 'wan2.6-t2i',
      prompt: 'p',
      cfg: { providers: { dashscope: { region: 'singapore' } } } as any,
    } as any;
    expect(resolveDashScopeImageRegion(req)).toBe('singapore');
    expect(resolveDashScopeImageGenerationUrl(req)).toBe(DASHSCOPE_IMAGE_ENDPOINTS.singapore);
  });
});

describe('mapSizeToDashScopeFormat', () => {
  it('defaults to 1280*1280', () => {
    expect(mapSizeToDashScopeFormat()).toBe('1280*1280');
    expect(mapSizeToDashScopeFormat('')).toBe('1280*1280');
  });

  it('converts WxH to W*H', () => {
    expect(mapSizeToDashScopeFormat('1024x1024')).toBe('1024*1024');
    expect(mapSizeToDashScopeFormat('960 X 1696')).toBe('960*1696');
  });

  it('passes through star format', () => {
    expect(mapSizeToDashScopeFormat('1280*1280')).toBe('1280*1280');
  });
});

describe('mapSizeToWan27Format', () => {
  it('defaults to 2K for wan2.7-image-pro', () => {
    expect(mapSizeToWan27Format(undefined, 'wan2.7-image-pro')).toBe('2K');
    expect(mapSizeToWan27Format('', 'wan2.7-image-pro')).toBe('2K');
  });

  it('accepts 1K/2K/4K presets on pro', () => {
    expect(mapSizeToWan27Format('4k', 'wan2.7-image-pro')).toBe('4K');
    expect(mapSizeToWan27Format('1K', 'wan2.7-image-pro')).toBe('1K');
  });

  it('maps 4K to 2K on wan2.7-image (non-pro)', () => {
    expect(mapSizeToWan27Format('4K', 'wan2.7-image')).toBe('2K');
    expect(mapSizeToWan27Format('2K', 'wan2.7-image')).toBe('2K');
  });

  it('converts WxH to star pixels', () => {
    expect(mapSizeToWan27Format('1024x1024', 'wan2.7-image-pro')).toBe('1024*1024');
  });
});
