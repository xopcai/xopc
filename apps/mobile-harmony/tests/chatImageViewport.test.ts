import { describe, expect, it } from 'vitest';
import { imageZoomOffset, boundedImageOffset } from '../entry/src/main/ets/common/chatImageViewport.ets';

describe('image preview focal point', () => {
  it('keeps an off-center image point under the fingers through repeated pinches', () => {
    const focal = 80;
    const firstOffset = imageZoomOffset(focal, 0, 1, 2);
    expect(firstOffset).toBe(-80);
    expect((focal - firstOffset) / 2).toBe(80);
    const secondOffset = imageZoomOffset(focal, firstOffset, 2, 3);
    expect(secondOffset).toBe(-160);
    expect((focal - secondOffset) / 3).toBe(80);
    expect(imageZoomOffset(focal, secondOffset, 3, 1)).toBe(0);
  });

  it('centers letterboxed axes and prevents dragging an image outside the viewport', () => {
    expect(boundedImageOffset(100, 200, 400, 1)).toBe(0);
    expect(boundedImageOffset(100, 200, 400, 2)).toBe(0);
    expect(boundedImageOffset(500, 400, 400, 2)).toBe(200);
    expect(boundedImageOffset(-500, 400, 400, 2)).toBe(-200);
    expect(boundedImageOffset(35, 400, 400, 2)).toBe(35);
  });
});
