import { describe, expect, it } from 'vitest';

import { desktopPetPointerTarget } from '../pointer.js';

describe('desktop pet cursor attention', () => {
  const center = { x: 600, y: 400 };
  it('looks toward nearby cursors in either direction and settles for distant cursors', () => {
    expect(desktopPetPointerTarget(center, center, 132)).toEqual({ x: 0, y: 0 });
    const right = desktopPetPointerTarget({ x: 690, y: 440 }, center, 132);
    const left = desktopPetPointerTarget({ x: 510, y: 360 }, center, 132);
    expect(right.x).toBeGreaterThan(.5);
    expect(right.y).toBeGreaterThan(0);
    expect(left).toEqual({ x: -right.x, y: -right.y });
    expect(desktopPetPointerTarget({ x: 2000, y: 2000 }, center, 132)).toEqual({ x: 0, y: 0 });
  });
  it('keeps the movement bounded across pet sizes and negative monitor coordinates', () => {
    for (const size of [92, 132, 185]) {
      const target = desktopPetPointerTarget({ x: -200, y: -160 }, { x: -300, y: -200 }, size);
      expect(target.x).toBeGreaterThan(0);
      expect(target.x).toBeLessThanOrEqual(1);
      expect(target.y).toBeLessThanOrEqual(1);
    }
  });
});
