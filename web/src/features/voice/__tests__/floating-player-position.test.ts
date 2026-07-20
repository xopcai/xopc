import { describe, expect, it } from 'vitest';

import { clampFloatingPlayerPosition } from '../floating-player-position';

describe('clampFloatingPlayerPosition', () => {
  it('keeps a dragged player inside the viewport margin', () => {
    expect(clampFloatingPlayerPosition(
      { x: -50, y: 900 },
      { width: 400, height: 64 },
      { width: 1000, height: 700 },
    )).toEqual({ x: 12, y: 624 });
  });

  it('keeps the minimum margin when the player is wider than the viewport', () => {
    expect(clampFloatingPlayerPosition(
      { x: 100, y: 100 },
      { width: 500, height: 80 },
      { width: 320, height: 240 },
    )).toEqual({ x: 12, y: 100 });
  });
});
