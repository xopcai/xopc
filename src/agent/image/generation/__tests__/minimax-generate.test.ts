import { describe, expect, it } from 'vitest';

import { mapSizeToMinimaxAspectRatio } from '../../../../../extensions/minimax/src/image-generation-provider.js';

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
