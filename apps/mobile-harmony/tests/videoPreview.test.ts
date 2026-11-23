import { describe, expect, it } from 'vitest';
import { clampVideoTime, fittedVideoFrame, parseVideoAspectRatio } from '../entry/src/main/ets/common/videoPreview.ets';

describe('video preview layout and playback helpers', () => {
  it('parses valid aspect ratios and ignores invalid inputs', () => {
    expect(parseVideoAspectRatio('16:9')).toBeCloseTo(16 / 9);
    expect(parseVideoAspectRatio('9:16')).toBeCloseTo(9 / 16);
    expect(parseVideoAspectRatio('1:1')).toBe(1);
    expect(parseVideoAspectRatio(' 4:3 ')).toBeCloseTo(4 / 3);
    expect(parseVideoAspectRatio(undefined)).toBe(0);
    expect(parseVideoAspectRatio('')).toBe(0);
    expect(parseVideoAspectRatio('16:0')).toBe(0);
    expect(parseVideoAspectRatio('wide')).toBe(0);
  });

  it('fits landscape, portrait, and square videos inside the stage without overflow', () => {
    const landscape = fittedVideoFrame(360, 520, 16 / 9);
    expect(landscape?.width).toBeCloseTo(360);
    expect(landscape?.height).toBeCloseTo(202.5);

    const portrait = fittedVideoFrame(360, 520, 9 / 16);
    expect(portrait?.width).toBeCloseTo(292.5);
    expect(portrait?.height).toBeCloseTo(520);

    const square = fittedVideoFrame(360, 300, 1);
    expect(square?.width).toBeCloseTo(300);
    expect(square?.height).toBeCloseTo(300);

    expect(fittedVideoFrame(0, 520, 16 / 9)).toBeUndefined();
    expect(fittedVideoFrame(360, 520, 0)).toBeUndefined();
  });

  it('clamps playback timestamps within valid bounds', () => {
    expect(clampVideoTime(-3, 5)).toBe(0);
    expect(clampVideoTime(2.5, 5)).toBe(2.5);
    expect(clampVideoTime(8, 5)).toBe(5);
    expect(clampVideoTime(4, 0)).toBe(4);
    expect(clampVideoTime(Number.NaN, 5)).toBe(0);
  });
});
