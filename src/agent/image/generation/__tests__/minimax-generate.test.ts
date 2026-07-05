import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildMinimaxCnImageGenerationProvider,
  buildMinimaxImageGenerationProvider,
  mapSizeToMinimaxAspectRatio,
  resolveMinimaxBaseUrl,
} from '../../../../../extensions/minimax/src/image-generation-provider.js';

let savedBaseUrl: string | undefined;
let savedApiKey: string | undefined;
let savedIntlApiKey: string | undefined;

beforeEach(() => {
  savedBaseUrl = process.env.MINIMAX_BASE_URL;
  savedApiKey = process.env.MINIMAX_API_KEY;
  savedIntlApiKey = process.env.MINIMAX_INTL_API_KEY;
  delete process.env.MINIMAX_BASE_URL;
  delete process.env.MINIMAX_API_KEY;
  delete process.env.MINIMAX_INTL_API_KEY;
});

afterEach(() => {
  if (savedBaseUrl !== undefined) {
    process.env.MINIMAX_BASE_URL = savedBaseUrl;
  } else {
    delete process.env.MINIMAX_BASE_URL;
  }
  if (savedApiKey !== undefined) {
    process.env.MINIMAX_API_KEY = savedApiKey;
  } else {
    delete process.env.MINIMAX_API_KEY;
  }
  if (savedIntlApiKey !== undefined) {
    process.env.MINIMAX_INTL_API_KEY = savedIntlApiKey;
  } else {
    delete process.env.MINIMAX_INTL_API_KEY;
  }
});

describe('resolveMinimaxBaseUrl', () => {
  it('defaults minimax-cn to the China endpoint', () => {
    const provider = buildMinimaxCnImageGenerationProvider();
    expect(provider.id).toBe('minimax-cn');
    expect(
      resolveMinimaxBaseUrl(
        { provider: 'minimax-cn', model: 'image-01', prompt: 'p' } as any,
        'https://api.minimaxi.com',
      ),
    ).toBe('https://api.minimaxi.com');
  });

  it('defaults minimax to the international endpoint', () => {
    process.env.MINIMAX_INTL_API_KEY = 'intl-key';

    const provider = buildMinimaxImageGenerationProvider();
    expect(provider.id).toBe('minimax');
    expect(resolveMinimaxBaseUrl({ provider: 'minimax', model: 'image-01', prompt: 'p' } as any)).toBe(
      'https://api.minimax.io',
    );
  });

  it('does not read config from a different provider id', () => {
    const req = {
      provider: 'minimax-cn',
      model: 'image-01',
      prompt: 'p',
      cfg: {
        providers: {
          minimax: { baseUrl: 'https://intl.example.com' },
        },
      } as any,
    } as any;

    expect(resolveMinimaxBaseUrl(req)).toBe('https://api.minimaxi.com');
  });
});

describe('mapSizeToMinimaxAspectRatio', () => {
  it('defaults to 1:1', () => {
    expect(mapSizeToMinimaxAspectRatio()).toBe('1:1');
    expect(mapSizeToMinimaxAspectRatio('')).toBe('1:1');
  });

  it('maps common sizes', () => {
    expect(mapSizeToMinimaxAspectRatio('1024x1024')).toBe('1:1');
    expect(mapSizeToMinimaxAspectRatio('1920x1080')).toBe('16:9');
    expect(mapSizeToMinimaxAspectRatio('1080x1920')).toBe('9:16');
    expect(mapSizeToMinimaxAspectRatio('1024x768')).toBe('4:3');
    expect(mapSizeToMinimaxAspectRatio('768x1024')).toBe('3:4');
  });
});
