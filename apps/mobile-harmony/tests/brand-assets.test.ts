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
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const isAiSegment = red < 100 && green < 110 && blue < 130;
      const isHumanSegment = blue > 150 && blue - red > 80 && blue - green > 30;
      if (data[offset + 3] < 128 || (!isAiSegment && !isHumanSegment)) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1, canvas: info.width };
}

describe('Harmony mobile brand assets', () => {
  it('keeps a calm optical safe area in the flat launcher icon', async () => {
    const harmony = await artworkBounds(read('../AppScope/resources/base/media/app_icon.png'));
    expect(harmony.canvas).toBe(1024);
    expect(harmony.width / harmony.canvas).toBeGreaterThan(0.65);
    expect(harmony.width / harmony.canvas).toBeLessThan(0.69);
    expect(harmony.height / harmony.canvas).toBeGreaterThan(0.65);
    expect(harmony.height / harmony.canvas).toBeLessThan(0.69);
    for (const padding of [harmony.left, harmony.top, 1023 - harmony.right, 1023 - harmony.bottom]) {
      expect(padding / harmony.canvas).toBeGreaterThan(0.14);
      expect(padding / harmony.canvas).toBeLessThan(0.19);
    }
    expect(existsSync(fileURLToPath(new URL('../AppScope/resources/base/media/app_icon.svg', import.meta.url))))
      .toBe(false);
  });

  it('keeps the restrained glass depth visible at launcher scale', async () => {
    const { data, info } = await sharp(read('../AppScope/resources/base/media/app_icon.png'))
      .resize(96, 96)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sample = (x: number, y: number): number[] => {
      const offset = (y * info.width + x) * info.channels;
      return Array.from(data.subarray(offset, offset + 3));
    };
    const brightness = (rgb: number[]): number => rgb.reduce((sum, channel) => sum + channel, 0) / 3;
    const colourDistance = (first: number[], second: number[]): number => first.reduce(
      (sum, channel, index) => sum + Math.abs(channel - second[index]),
      0,
    );

    expect(brightness(sample(40, 39)) - brightness(sample(48, 60))).toBeGreaterThan(14);
    expect(colourDistance(sample(6, 6), sample(90, 90))).toBeGreaterThan(60);
  });

  it.each([['light', 'base'], ['dark', 'dark']])('keeps the %s mark identical to the approved concept', (appearance, qualifier) => {
    expect(read(`../entry/src/main/resources/${qualifier}/media/brand_logo.svg`))
      .toEqual(read(`../../../assets/brand/concepts/xopc-human-ai-loop-role-${appearance}.svg`));
  });

  it('keeps the launcher icon opaque while the start window uses the appearance-aware transparent mark', async () => {
    const app = JSON.parse(read('../AppScope/app.json5').toString());
    const module = JSON.parse(read('../entry/src/main/module.json5').toString()).module;
    expect(app.app.icon).toBe('$media:app_icon');
    const entry = module.abilities.find((ability: { name: string }) => ability.name === 'EntryAbility');
    const push = module.abilities.find((ability: { name: string }) => ability.name === 'PushMessageAbility');
    expect(entry.icon).toBe('$media:app_icon');
    expect(entry.startWindowIcon).toBe('$media:launch_logo');
    expect(push.startWindowIcon).toBe('$media:launch_logo');

    const launcher = await sharp(read('../AppScope/resources/base/media/app_icon.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = launcher.data.filter((_value, index) => index % 4 === 3);
    expect(alpha.every(value => value === 255)).toBe(true);
    expect(read('../agc-locales/zh-CN/app-icon-1024.png'))
      .toEqual(read('../AppScope/resources/base/media/app_icon.png'));
    expect(read('../entry/src/main/resources/base/media/brand_logo.svg').toString()).not.toContain('<rect');
    expect(read('../entry/src/main/resources/base/media/launch_logo.svg').toString())
      .toContain('viewBox="-256 -256 1536 1536"');
    expect(read('../entry/src/main/resources/dark/media/launch_logo.svg').toString())
      .toContain('viewBox="-256 -256 1536 1536"');
  });
});
