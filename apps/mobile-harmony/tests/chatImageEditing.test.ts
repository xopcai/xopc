import { describe, expect, it } from 'vitest';
import { centeredImageCrop, imageEditAspect, rotatedImageSize } from '../entry/src/main/ets/common/chatImageEditing.ets';

describe('Harmony chat image editing math', () => {
  it('swaps dimensions for quarter turns', () => {
    expect(rotatedImageSize({ width: 1200, height: 800 }, 90)).toEqual({ width: 800, height: 1200 });
    expect(rotatedImageSize({ width: 1200, height: 800 }, 180)).toEqual({ width: 1200, height: 800 });
  });
  it('produces centered, bounded crops for portrait and landscape sources', () => {
    expect(centeredImageCrop({ width: 1200, height: 800 }, 1)).toEqual({ x: 200, y: 0, width: 800, height: 800 });
    expect(centeredImageCrop({ width: 800, height: 1200 }, 4 / 3)).toEqual({ x: 0, y: 300, width: 800, height: 600 });
  });
  it('maps supported crop presets and keeps original uncropped', () => {
    expect(imageEditAspect('square')).toBe(1);
    expect(imageEditAspect('16:9')).toBeCloseTo(16 / 9);
    expect(imageEditAspect('original')).toBe(0);
  });
});
