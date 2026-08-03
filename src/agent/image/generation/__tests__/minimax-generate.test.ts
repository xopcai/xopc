import { describe, expect, it } from 'vitest';

import {
  buildMinimaxImageGenerationProvider,
  mapSizeToMinimaxAspectRatio,
  resolveMinimaxBaseUrl,
} from '../providers/minimax.js';

describe('MiniMax image provider', () => {
  it('uses the configured region', () => {
    expect(resolveMinimaxBaseUrl({
      provider: 'minimax', model: 'image-01', prompt: 'p',
      cfg: { providers: { minimax: { region: 'cn' } } } as any,
    })).toBe('https://api.minimaxi.com');
    expect(resolveMinimaxBaseUrl({
      provider: 'minimax', model: 'image-01', prompt: 'p',
      cfg: { providers: { minimax: { region: 'intl' } } } as any,
    })).toBe('https://api.minimax.io');
  });

  it('requires an explicit region', () => {
    expect(() => resolveMinimaxBaseUrl({
      provider: 'minimax', model: 'image-01', prompt: 'p', cfg: {} as any,
    })).toThrow(/requires providers\.minimax\.region/);
  });

  it('exposes one provider id', () => {
    expect(buildMinimaxImageGenerationProvider().id).toBe('minimax');
  });

  it('maps dimensions to the closest supported ratio', () => {
    expect(mapSizeToMinimaxAspectRatio('1920x1080')).toBe('16:9');
  });
});
