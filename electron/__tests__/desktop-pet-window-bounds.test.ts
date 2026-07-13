import { describe, expect, it } from 'vitest';

import { clampDesktopPetBounds, desktopPetDefaultBounds } from '../desktop-pet/window-bounds.js';

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

describe('desktop pet window bounds', () => {
  it('keeps the default window above the bottom safety area', () => {
    const bounds = desktopPetDefaultBounds(workArea, 1);

    expect(bounds.y + bounds.height).toBe(968);
    expect(workArea.height - (bounds.y + bounds.height)).toBeGreaterThanOrEqual(72);
  });

  it('pulls a saved or dragged window back from the bottom display edge', () => {
    const bounds = clampDesktopPetBounds({ x: 1600, y: 790, width: 320, height: 250 }, workArea);

    expect(bounds).toMatchObject({ x: 1576, y: 718, width: 320, height: 250 });
  });

  it('keeps small displays usable instead of creating invalid bounds', () => {
    const bounds = clampDesktopPetBounds(
      { x: -100, y: 999, width: 360, height: 250 },
      { x: 0, y: 0, width: 200, height: 150 },
    );

    expect(bounds).toEqual({ x: 10, y: 5, width: 180, height: 140 });
  });
});
