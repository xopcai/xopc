import { describe, expect, it } from 'vitest';

import {
  coverImageSize,
  cropRectForTransform,
  fitCropFrame,
  translationBounds,
} from '../image-editor-math';

describe('image editor crop math', () => {
  it('fits the crop frame inside its container', () => {
    expect(fitCropFrame({ width: 400, height: 300 }, 1)).toEqual({ width: 268, height: 268 });
    expect(fitCropFrame({ width: 400, height: 300 }, 16 / 9)).toEqual({ width: 368, height: 207 });
  });

  it('covers the crop frame and derives translation bounds', () => {
    const base = coverImageSize({ width: 400, height: 200 }, { width: 200, height: 200 });
    expect(base).toEqual({ width: 400, height: 200 });
    expect(translationBounds(base, { width: 200, height: 200 }, 1)).toEqual({ width: 100, height: 0 });
  });

  it('returns the centered source rectangle at minimum zoom', () => {
    expect(cropRectForTransform(
      { width: 400, height: 200 },
      { width: 200, height: 200 },
      { zoom: 1, offsetX: 0, offsetY: 0 },
    )).toEqual({ originX: 100, originY: 0, width: 200, height: 200 });
  });

  it('maps zoom and translation into bounded source coordinates', () => {
    expect(cropRectForTransform(
      { width: 400, height: 200 },
      { width: 200, height: 200 },
      { zoom: 2, offsetX: 100, offsetY: -50 },
    )).toEqual({ originX: 100, originY: 75, width: 100, height: 100 });
  });
});
