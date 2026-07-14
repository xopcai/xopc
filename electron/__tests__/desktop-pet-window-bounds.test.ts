import { describe, expect, it } from "vitest";

import {
  clampDesktopPetAnchor,
  desktopPetDefaultAnchor,
  desktopPetWindowBoundsForAnchor,
} from "../desktop-pet/window-bounds.js";

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

describe("desktop pet anchor bounds", () => {
  it("puts the pet anchor flush with the usable display edge", () => {
    const anchor = desktopPetDefaultAnchor(workArea);

    expect(anchor).toEqual({ x: 1920, y: 1040 });
  });

  it("keeps the whole interactive pet region on the display while allowing it to touch every edge", () => {
    expect(
      clampDesktopPetAnchor({ x: -100, y: 9999 }, workArea, 138, 132),
    ).toEqual({ x: 138, y: 1040 });
    expect(
      clampDesktopPetAnchor({ x: 9999, y: -100 }, workArea, 138, 132),
    ).toEqual({ x: 1920, y: 132 });
  });

  it("grows the native window upward and leftward without moving the pet anchor", () => {
    const bounds = desktopPetWindowBoundsForAnchor(
      { x: 1500, y: 900 },
      { width: 334, height: 278 },
    );

    expect(bounds).toEqual({ x: 1166, y: 622, width: 334, height: 278 });
  });
});
