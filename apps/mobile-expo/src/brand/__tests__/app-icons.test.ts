import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const read = (path: string): Buffer => readFileSync(fileURLToPath(new URL(path, import.meta.url)));

async function raw(path: string) {
  return sharp(read(path)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

describe('mobile launcher brand assets', () => {
  it.each([
    '../../../assets/icon-light.png',
    '../../../assets/icon-dark.png',
    '../../../assets/icon-tinted.png',
    '../../../assets/adaptive-icon-background.png',
  ])('keeps %s fully opaque', async path => {
    const { data } = await raw(path);
    let isOpaque = true;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] !== 255) {
        isOpaque = false;
        break;
      }
    }
    expect(isOpaque).toBe(true);
  });

  it('provides a genuinely grayscale iOS tinted appearance', async () => {
    const { data } = await raw('../../../assets/icon-tinted.png');
    let isGrayscale = true;
    for (let index = 0; index < data.length; index += 4) {
      if (
        Math.abs(data[index] - data[index + 1]) > 1
        || Math.abs(data[index + 1] - data[index + 2]) > 1
      ) {
        isGrayscale = false;
        break;
      }
    }
    expect(isGrayscale).toBe(true);
  });

  it('keeps the Android foreground inside the adaptive safe zone', async () => {
    const { data, info } = await raw('../../../assets/adaptive-icon.png');
    let left = info.width;
    let top = info.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const alpha = data[(y * info.width + x) * 4 + 3];
        if (alpha < 128) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    expect((right - left + 1) / info.width).toBeGreaterThan(0.58);
    expect((right - left + 1) / info.width).toBeLessThan(0.61);
    expect((bottom - top + 1) / info.height).toBeGreaterThan(0.58);
    expect((bottom - top + 1) / info.height).toBeLessThan(0.61);
  });

  it('binds Android to separate foreground, background, and monochrome layers', () => {
    const config = JSON.parse(read('../../../app.json').toString());
    expect(config.expo.android.adaptiveIcon).toEqual({
      foregroundImage: './assets/adaptive-icon.png',
      monochromeImage: './assets/adaptive-icon-monochrome.png',
      backgroundImage: './assets/adaptive-icon-background.png',
      backgroundColor: '#EEF1F8',
    });
  });
});
