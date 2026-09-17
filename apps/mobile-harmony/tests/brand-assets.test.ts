import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

const read = (path: string): Buffer => readFileSync(fileURLToPath(new URL(path, import.meta.url)));

async function artworkBounds(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * 4;
      if (data[offset + 3] < 128 || (data[offset] > 245 && data[offset + 1] > 245 && data[offset + 2] > 245)) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1, canvas: info.width };
}

describe('Harmony mobile brand assets', () => {
  it('matches the Android adaptive viewport without baking its outer padding into the flat icon', async () => {
    const harmony = await artworkBounds(read('../AppScope/resources/base/media/app_icon.png'));
    const android = await artworkBounds(read('../../mobile-expo/assets/adaptive-icon.png'));
    expect(harmony.canvas).toBe(1024);
    expect(harmony.width / harmony.canvas).toBeCloseTo(android.width / android.canvas * 108 / 72, 2);
    expect(harmony.height / harmony.canvas).toBeCloseTo(android.height / android.canvas * 108 / 72, 2);
    for (const padding of [harmony.left, harmony.top, 1023 - harmony.right, 1023 - harmony.bottom]) {
      expect(padding / harmony.canvas).toBeGreaterThan(0.07);
      expect(padding / harmony.canvas).toBeLessThan(0.10);
    }
    expect(existsSync(fileURLToPath(new URL('../AppScope/resources/base/media/app_icon.svg', import.meta.url))))
      .toBe(false);
  });

  it.each([['light', 'base'], ['dark', 'dark']])('keeps the %s mark identical to the approved concept', (appearance, qualifier) => {
    expect(read(`../entry/src/main/resources/${qualifier}/media/brand_logo.svg`))
      .toEqual(read(`../../../assets/brand/concepts/xopc-human-ai-loop-role-${appearance}.svg`));
  });

  it('binds launcher and start-window icons to the branded resource', () => {
    const app = JSON.parse(read('../AppScope/app.json5').toString());
    const module = JSON.parse(read('../entry/src/main/module.json5').toString()).module;
    expect(app.app.icon).toBe('$media:app_icon');
    const entry = module.abilities.find((ability: { name: string }) => ability.name === 'EntryAbility');
    expect(entry.icon).toBe('$media:app_icon');
    expect(entry.startWindowIcon).toBe('$media:app_icon');
  });
});
